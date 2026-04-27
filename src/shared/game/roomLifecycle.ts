import { createDeck } from "../cards/deck.ts";
import { shuffleDeck } from "../cards/shuffle.ts";
import type { Card, Rng } from "../cards/cardTypes.ts";
import { normalizeDisplayName, validatePlayerPin } from "./identity.ts";
import type { GameState, PlayerCredential, PlayerState } from "./gameTypes.ts";
import type { ServerErrorCode } from "./errors.ts";
import { DEFAULT_TURN_DURATION_MS } from "./roomReducer.ts";
import { determineNextRoundStarter } from "./seatOrder.ts";

export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 10;

export type RoomIdentityProvider = {
  createPlayerId(): string;
  createReconnectToken(): string;
  createPinVerifier(pin: string, playerId: string): string;
  verifyPin(pin: string, verifier: string, playerId: string): boolean;
  hashReconnectToken(token: string, playerId: string): string;
};

export type LifecycleResult =
  | {
      ok: true;
      state: GameState;
      playerId?: string;
      reconnectToken?: string;
      reclaimed?: boolean;
    }
  | {
      ok: false;
      code: ServerErrorCode;
      latestStateRevision: number;
    };

export type CreateRoomInput = {
  roomId: string;
  code: string;
  hostName: string;
  pin: string;
  now: number;
  identity: RoomIdentityProvider;
  turnDurationMs?: number;
};

export type JoinRoomInput = {
  name: string;
  pin: string;
  now: number;
  identity: RoomIdentityProvider;
};

export type AddBotInput = {
  hostPlayerId: string;
  name?: string;
  now: number;
  identity: RoomIdentityProvider;
};

export type RemovePlayerInput = {
  hostPlayerId: string;
  targetPlayerId: string;
  now: number;
};

export type StartGameInput = {
  hostPlayerId: string;
  now: number;
  rng: Rng;
};

export type ConnectPlayerInput = {
  playerId: string;
  reconnectToken: string;
  now: number;
  identity: RoomIdentityProvider;
};

export type DisconnectPlayerInput = {
  playerId: string;
  now: number;
};

export type AdvanceNextRoundInput = {
  now: number;
  rng: Rng;
};

function lifecycleError(
  state: GameState | undefined,
  code: ServerErrorCode,
): LifecycleResult {
  return {
    ok: false,
    code,
    latestStateRevision: state?.stateRevision ?? 0,
  };
}

function createPlayer(params: {
  id: string;
  name: string;
  normalizedName: string;
  seatIndex: number;
  isBot?: boolean;
}): PlayerState {
  return {
    id: params.id,
    name: params.name,
    normalizedName: params.normalizedName,
    seatIndex: params.seatIndex,
    avatarKey: `avatar-${params.seatIndex}`,
    cardCount: 1,
    eliminated: false,
    connected: true,
    isBot: params.isBot ?? false,
    roundCards: [],
  };
}

function createCredential(
  identity: RoomIdentityProvider,
  playerId: string,
  normalizedName: string,
  pin: string,
): { credential: PlayerCredential; reconnectToken: string } {
  const reconnectToken = identity.createReconnectToken();
  return {
    reconnectToken,
    credential: {
      playerId,
      normalizedName,
      pinVerifier: identity.createPinVerifier(pin, playerId),
      reconnectTokenHash: identity.hashReconnectToken(reconnectToken, playerId),
    },
  };
}

function credentials(state: GameState): PlayerCredential[] {
  return state.playerCredentials ?? [];
}

function playerCredential(
  state: GameState,
  playerId: string,
): PlayerCredential | undefined {
  return credentials(state).find(
    (credential) => credential.playerId === playerId,
  );
}

function nextSeatIndex(players: readonly PlayerState[]): number {
  if (players.length === 0) return 0;
  return Math.max(...players.map((player) => player.seatIndex)) + 1;
}

function activePlayers(players: readonly PlayerState[]): PlayerState[] {
  return players.filter(
    (player) => !player.eliminated && player.leftAt === undefined,
  );
}

function nextDefaultBotName(players: readonly PlayerState[]): string {
  const names = new Set(players.map((player) => player.normalizedName));
  for (let index = 1; index <= MAX_PLAYERS; index += 1) {
    const name = `Bot ${index}`;
    if (!names.has(normalizeDisplayName(name))) {
      return name;
    }
  }
  return `Bot ${players.length + 1}`;
}

function winnerPlayerId(players: readonly PlayerState[]): string | undefined {
  const active = activePlayers(players);
  return active.length === 1 ? active[0].id : undefined;
}

function dealRoundCards(
  players: readonly PlayerState[],
  deck: readonly Card[],
): PlayerState[] {
  let cursor = 0;

  return players.map((player) => {
    if (player.eliminated || player.leftAt !== undefined) {
      return { ...player, roundCards: [] };
    }

    const nextCursor = cursor + player.cardCount;
    const roundCards = deck.slice(cursor, nextCursor);
    if (roundCards.length !== player.cardCount) {
      throw new Error("Deck did not contain enough cards for the round");
    }
    cursor = nextCursor;

    return {
      ...player,
      roundCards,
    };
  });
}

function turnId(
  roomId: string,
  roundNumber: number,
  playerId: string,
  sequence: number,
): string {
  return `${roomId}:round:${roundNumber}:turn:${playerId}:${sequence}`;
}

export function createRoomWithHost(input: CreateRoomInput): LifecycleResult {
  if (!validatePlayerPin(input.pin)) {
    return lifecycleError(undefined, "INVALID_PIN_FORMAT");
  }

  const normalizedName = normalizeDisplayName(input.hostName);
  if (!normalizedName) {
    return lifecycleError(undefined, "NAME_TAKEN");
  }

  const playerId = input.identity.createPlayerId();
  const { credential, reconnectToken } = createCredential(
    input.identity,
    playerId,
    normalizedName,
    input.pin,
  );
  const hostPlayer = createPlayer({
    id: playerId,
    name: input.hostName.trim(),
    normalizedName,
    seatIndex: 0,
  });

  const state: GameState = {
    roomId: input.roomId,
    code: input.code,
    phase: "Lobby",
    stateRevision: 1,
    hostPlayerId: playerId,
    players: [hostPlayer],
    playerCredentials: [credential],
    roundNumber: 0,
    claimHistory: [],
    turnDurationMs: input.turnDurationMs ?? DEFAULT_TURN_DURATION_MS,
  };

  return {
    ok: true,
    state,
    playerId,
    reconnectToken,
    reclaimed: false,
  };
}

export function joinRoom(
  state: GameState,
  input: JoinRoomInput,
): LifecycleResult {
  if (state.phase === "Closed") {
    return lifecycleError(state, "ROOM_CLOSED");
  }
  if (!validatePlayerPin(input.pin)) {
    return lifecycleError(state, "INVALID_PIN_FORMAT");
  }

  const normalizedName = normalizeDisplayName(input.name);
  if (!normalizedName) {
    return lifecycleError(state, "NAME_TAKEN");
  }

  const existingPlayer = state.players.find(
    (player) => player.normalizedName === normalizedName,
  );
  if (existingPlayer) {
    const credential = credentials(state).find(
      (candidate) => candidate.playerId === existingPlayer.id,
    );
    if (
      !credential ||
      !input.identity.verifyPin(
        input.pin,
        credential.pinVerifier,
        existingPlayer.id,
      )
    ) {
      return lifecycleError(state, "PIN_MISMATCH");
    }

    const reconnectToken = input.identity.createReconnectToken();
    const updatedCredential = {
      ...credential,
      reconnectTokenHash: input.identity.hashReconnectToken(
        reconnectToken,
        existingPlayer.id,
      ),
    };
    const updatedState: GameState = {
      ...state,
      stateRevision: state.stateRevision + 1,
      players: state.players.map((player) =>
        player.id === existingPlayer.id
          ? { ...player, connected: true, leftAt: undefined }
          : player,
      ),
      playerCredentials: credentials(state).map((candidate) =>
        candidate.playerId === existingPlayer.id
          ? updatedCredential
          : candidate,
      ),
    };

    return {
      ok: true,
      state: updatedState,
      playerId: existingPlayer.id,
      reconnectToken,
      reclaimed: true,
    };
  }

  if (state.phase !== "Lobby") {
    return lifecycleError(state, "GAME_ALREADY_STARTED");
  }

  if (state.players.length >= MAX_PLAYERS) {
    return lifecycleError(state, "ROOM_FULL");
  }

  const playerId = input.identity.createPlayerId();
  const { credential, reconnectToken } = createCredential(
    input.identity,
    playerId,
    normalizedName,
    input.pin,
  );
  const newPlayer = createPlayer({
    id: playerId,
    name: input.name.trim(),
    normalizedName,
    seatIndex: nextSeatIndex(state.players),
  });

  const updatedState: GameState = {
    ...state,
    stateRevision: state.stateRevision + 1,
    players: [...state.players, newPlayer],
    playerCredentials: [...credentials(state), credential],
  };

  return {
    ok: true,
    state: updatedState,
    playerId,
    reconnectToken,
    reclaimed: false,
  };
}

export function addBotToRoom(
  state: GameState,
  input: AddBotInput,
): LifecycleResult {
  if (state.phase !== "Lobby") {
    return lifecycleError(state, "GAME_ALREADY_STARTED");
  }
  if (state.hostPlayerId !== input.hostPlayerId) {
    return lifecycleError(state, "NOT_HOST");
  }
  if (state.players.length >= MAX_PLAYERS) {
    return lifecycleError(state, "ROOM_FULL");
  }

  const botName = input.name?.trim() || nextDefaultBotName(state.players);
  const normalizedName = normalizeDisplayName(botName);
  if (
    !normalizedName ||
    state.players.some((player) => player.normalizedName === normalizedName)
  ) {
    return lifecycleError(state, "NAME_TAKEN");
  }

  const bot = createPlayer({
    id: input.identity.createPlayerId(),
    name: botName,
    normalizedName,
    seatIndex: nextSeatIndex(state.players),
    isBot: true,
  });

  return {
    ok: true,
    state: {
      ...state,
      stateRevision: state.stateRevision + 1,
      players: [...state.players, bot],
    },
  };
}

export function removePlayerFromRoom(
  state: GameState,
  input: RemovePlayerInput,
): LifecycleResult {
  if (state.phase !== "Lobby") {
    return lifecycleError(state, "GAME_ALREADY_STARTED");
  }
  if (state.hostPlayerId !== input.hostPlayerId) {
    return lifecycleError(state, "NOT_HOST");
  }

  if (state.hostPlayerId === input.targetPlayerId) {
    return lifecycleError(state, "CANNOT_REMOVE_HOST");
  }

  const target = state.players.find(
    (player) => player.id === input.targetPlayerId,
  );
  if (!target) {
    return lifecycleError(state, "PLAYER_NOT_FOUND");
  }

  return {
    ok: true,
    state: {
      ...state,
      stateRevision: state.stateRevision + 1,
      players: state.players.filter(
        (player) => player.id !== input.targetPlayerId,
      ),
      playerCredentials: credentials(state).filter(
        (credential) => credential.playerId !== input.targetPlayerId,
      ),
    },
  };
}

export function removeBotFromRoom(
  state: GameState,
  input: { hostPlayerId: string; botPlayerId: string; now: number },
): LifecycleResult {
  const bot = state.players.find(
    (player) => player.id === input.botPlayerId && player.isBot,
  );
  if (!bot) {
    return lifecycleError(state, "BOT_NOT_FOUND");
  }
  return removePlayerFromRoom(state, {
    hostPlayerId: input.hostPlayerId,
    targetPlayerId: input.botPlayerId,
    now: input.now,
  });
}

export function startGame(
  state: GameState,
  input: StartGameInput,
): LifecycleResult {
  if (state.phase !== "Lobby") {
    return lifecycleError(state, "GAME_ALREADY_STARTED");
  }
  if (state.hostPlayerId !== input.hostPlayerId) {
    return lifecycleError(state, "NOT_HOST");
  }

  const active = activePlayers(state.players);
  if (active.length < MIN_PLAYERS_TO_START) {
    return lifecycleError(state, "NOT_ENOUGH_PLAYERS");
  }

  const startingPlayer = [...active].sort(
    (left, right) => left.seatIndex - right.seatIndex,
  )[0];
  const deck = shuffleDeck(createDeck(), input.rng);
  const players = dealRoundCards(
    state.players.map((player) => ({
      ...player,
      cardCount: 1,
      eliminated: false,
      roundCards: [],
    })),
    deck,
  );

  const roundNumber = 1;
  const updatedState: GameState = {
    ...state,
    phase: "RoundActive",
    stateRevision: state.stateRevision + 1,
    players,
    roundNumber,
    startingPlayerId: startingPlayer.id,
    currentTurnPlayerId: startingPlayer.id,
    currentTurnId: turnId(state.roomId, roundNumber, startingPlayer.id, 0),
    currentClaim: undefined,
    activeClaimWindow: undefined,
    claimHistory: [],
    turnStartedAt: input.now,
    turnExpiresAt: undefined,
    lastRoundResult: undefined,
    winnerPlayerId: undefined,
  };

  return {
    ok: true,
    state: updatedState,
  };
}

export function connectPlayer(
  state: GameState,
  input: ConnectPlayerInput,
): LifecycleResult {
  if (state.phase === "Closed") {
    return lifecycleError(state, "ROOM_CLOSED");
  }

  const player = state.players.find(
    (candidate) => candidate.id === input.playerId,
  );
  if (!player) {
    return lifecycleError(state, "ROOM_NOT_FOUND");
  }

  const credential = playerCredential(state, input.playerId);
  if (
    !credential ||
    credential.reconnectTokenHash !==
      input.identity.hashReconnectToken(input.reconnectToken, input.playerId)
  ) {
    return lifecycleError(state, "RECONNECT_TOKEN_INVALID");
  }

  if (player.connected) {
    return {
      ok: true,
      state,
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      stateRevision: state.stateRevision + 1,
      players: state.players.map((candidate) =>
        candidate.id === input.playerId
          ? { ...candidate, connected: true }
          : candidate,
      ),
    },
  };
}

export function disconnectPlayer(
  state: GameState,
  input: DisconnectPlayerInput,
): LifecycleResult {
  if (state.phase === "Closed") {
    return lifecycleError(state, "ROOM_CLOSED");
  }

  const player = state.players.find(
    (candidate) => candidate.id === input.playerId,
  );
  if (!player) {
    return lifecycleError(state, "ROOM_NOT_FOUND");
  }

  if (!player.connected) {
    return {
      ok: true,
      state,
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      stateRevision: state.stateRevision + 1,
      players: state.players.map((candidate) =>
        candidate.id === input.playerId
          ? { ...candidate, connected: false }
          : candidate,
      ),
    },
  };
}

export function advanceToNextRound(
  state: GameState,
  input: AdvanceNextRoundInput,
): LifecycleResult {
  if (state.phase !== "ResolvingRound") {
    return lifecycleError(state, "ROUND_NOT_RESOLVED");
  }
  if (!state.startingPlayerId) {
    return lifecycleError(state, "INTERNAL_ERROR");
  }

  const nextStartingPlayerId = determineNextRoundStarter(
    state.players,
    state.startingPlayerId,
  );
  if (!nextStartingPlayerId) {
    return {
      ok: true,
      state: {
        ...state,
        phase: "GameOver",
        stateRevision: state.stateRevision + 1,
        winnerPlayerId: winnerPlayerId(state.players),
        currentTurnPlayerId: undefined,
        currentTurnId: undefined,
        currentClaim: undefined,
        activeClaimWindow: undefined,
        turnStartedAt: undefined,
        turnExpiresAt: undefined,
      },
    };
  }

  let players: PlayerState[];
  try {
    players = dealRoundCards(
      state.players.map((player) => ({
        ...player,
        roundCards: [],
      })),
      shuffleDeck(createDeck(), input.rng),
    );
  } catch {
    return lifecycleError(state, "INTERNAL_ERROR");
  }

  const roundNumber = state.roundNumber + 1;

  return {
    ok: true,
    state: {
      ...state,
      phase: "RoundActive",
      stateRevision: state.stateRevision + 1,
      players,
      roundNumber,
      startingPlayerId: nextStartingPlayerId,
      currentTurnPlayerId: nextStartingPlayerId,
      currentTurnId: turnId(state.roomId, roundNumber, nextStartingPlayerId, 0),
      currentClaim: undefined,
      activeClaimWindow: undefined,
      claimHistory: [],
      turnStartedAt: input.now,
      turnExpiresAt: undefined,
      winnerPlayerId: undefined,
    },
  };
}
