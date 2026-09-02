import { createDeck } from "../cards/deck.ts";
import { shuffleDeck } from "../cards/shuffle.ts";
import type { Card, Rng } from "../cards/cardTypes.ts";
import { normalizeDisplayName, validatePlayerPin } from "./identity.ts";
import {
  REACTION_KINDS,
  type GameState,
  type PlayerCredential,
  type PlayerState,
  type ReactionKind,
} from "./gameTypes.ts";
import type { ServerErrorCode } from "./errors.ts";
import { DEFAULT_TURN_DURATION_MS } from "./roomReducer.ts";
import {
  advanceToNextActivePlayer,
  determineNextRoundStarter,
} from "./seatOrder.ts";

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
  enforceReady?: boolean;
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

export type LeaveGameInput = {
  playerId: string;
  requestId: string;
  matchId: string;
  now: number;
};

export type SetReadyInput = {
  playerId: string;
  ready: boolean;
};

export type EndGameInput = {
  playerId: string;
  requestId: string;
  matchId: string;
  now: number;
};

export type StartRematchInput = {
  playerId: string;
  requestId: string;
  matchId: string;
  now: number;
};

export type SendReactionInput = {
  playerId: string;
  requestId: string;
  kind: ReactionKind;
  now: number;
};

const MAX_LEAVE_RECEIPTS = 64;

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
    ready: params.isBot ?? false,
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

function seatedPlayers(players: readonly PlayerState[]): PlayerState[] {
  return players.filter((player) => player.leftAt === undefined);
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
    socialRevision: 1,
    matchId: `${input.roomId}:match:1`,
    matchNumber: 1,
    hostPlayerId: playerId,
    players: [hostPlayer],
    playerCredentials: [credential],
    roundNumber: 0,
    roundParticipantIds: [],
    claimHistory: [],
    leaveReceipts: [],
    reactions: [],
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

    const matchId = state.matchId ?? `${state.roomId}:match:1`;
    if (
      existingPlayer.departure?.matchId === matchId ||
      existingPlayer.leftAt !== undefined
    ) {
      return lifecycleError(state, "PLAYER_LEFT_MATCH");
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
          ? { ...player, connected: true }
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

  if (seatedPlayers(state.players).length >= MAX_PLAYERS) {
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
  if (seatedPlayers(state.players).length >= MAX_PLAYERS) {
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
  if (!active.some((player) => player.id === input.hostPlayerId)) {
    return lifecycleError(state, "PLAYER_LEFT_MATCH");
  }
  if (
    input.enforceReady &&
    active.some(
      (player) => !player.isBot && (!player.connected || !player.ready),
    )
  ) {
    return lifecycleError(state, "NOT_READY");
  }

  const startingPlayer = [...active].sort(
    (left, right) => left.seatIndex - right.seatIndex,
  )[0];
  const enteringPlayerIds = new Set(active.map((player) => player.id));
  const deck = shuffleDeck(createDeck(), input.rng);
  const players = dealRoundCards(
    active.map((player) => ({
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
    playerCredentials: credentials(state).filter((credential) =>
      enteringPlayerIds.has(credential.playerId),
    ),
    roundNumber,
    roundParticipantIds: players.map((player) => player.id),
    startingPlayerId: startingPlayer.id,
    finalDecisionPlayerId: startingPlayer.id,
    currentTurnPlayerId: startingPlayer.id,
    currentTurnId: turnId(state.roomId, roundNumber, startingPlayer.id, 0),
    currentClaim: undefined,
    activeClaimWindow: undefined,
    claimHistory: [],
    turnStartedAt: input.now,
    turnExpiresAt: undefined,
    lastRoundResult: undefined,
    winnerPlayerId: undefined,
    matchEndedReason: undefined,
    endedAt: undefined,
    reactions: (state.reactions ?? []).filter((reaction) =>
      enteringPlayerIds.has(reaction.playerId),
    ),
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

  const matchId = state.matchId ?? `${state.roomId}:match:1`;
  if (player.departure?.matchId === matchId || player.leftAt !== undefined) {
    return lifecycleError(state, "PLAYER_LEFT_MATCH");
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
      roundParticipantIds: players
        .filter((player) => !player.eliminated && player.leftAt === undefined)
        .map((player) => player.id),
      startingPlayerId: nextStartingPlayerId,
      finalDecisionPlayerId: nextStartingPlayerId,
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

function humansStillInMatch(players: readonly PlayerState[]): PlayerState[] {
  return players.filter(
    (player) => !player.isBot && player.leftAt === undefined,
  );
}

function nextHumanHost(
  players: readonly PlayerState[],
  leavingPlayerId: string,
): string | undefined {
  const leaving = players.find((player) => player.id === leavingPlayerId);
  if (!leaving) return undefined;

  const candidates = players
    .filter(
      (player) =>
        !player.isBot &&
        player.id !== leavingPlayerId &&
        player.leftAt === undefined,
    )
    .sort((left, right) => left.seatIndex - right.seatIndex);
  if (candidates.length === 0) return undefined;

  const clockwise = candidates.filter(
    (player) => player.seatIndex > leaving.seatIndex,
  );
  const ordered = [
    ...clockwise,
    ...candidates.filter((player) => player.seatIndex <= leaving.seatIndex),
  ];
  return ordered.find((player) => player.connected)?.id ?? ordered[0]?.id;
}

function appendLeaveReceipt(
  state: GameState,
  input: LeaveGameInput,
  resultingStateRevision: number,
) {
  return [
    ...(state.leaveReceipts ?? []),
    {
      requestId: input.requestId,
      playerId: input.playerId,
      matchId: input.matchId,
      acceptedAt: input.now,
      resultingStateRevision,
    },
  ].slice(-MAX_LEAVE_RECEIPTS);
}

export function leaveGame(
  state: GameState,
  input: LeaveGameInput,
): LifecycleResult {
  const matchId = state.matchId ?? `${state.roomId}:match:1`;
  if (input.matchId !== matchId) {
    return lifecycleError(state, "MATCH_CHANGED");
  }

  const priorReceipt = (state.leaveReceipts ?? []).find(
    (receipt) => receipt.requestId === input.requestId,
  );
  if (priorReceipt) {
    if (
      priorReceipt.playerId !== input.playerId ||
      priorReceipt.matchId !== input.matchId
    ) {
      return lifecycleError(state, "REQUEST_ID_REUSED");
    }
    return { ok: true, state };
  }

  const player = state.players.find(
    (candidate) => candidate.id === input.playerId,
  );
  if (!player || player.isBot) {
    return lifecycleError(state, "PLAYER_NOT_FOUND");
  }

  if (player.departure?.matchId === matchId || player.leftAt !== undefined) {
    return { ok: true, state };
  }

  const nextRevision = state.stateRevision + 1;
  const players = state.players.map((candidate) =>
    candidate.id === input.playerId
      ? {
          ...candidate,
          connected: false,
          ready: false,
          leftAt: input.now,
          departure: {
            matchId,
            requestId: input.requestId,
            leftAt: input.now,
            reason: "VOLUNTARY" as const,
          },
        }
      : candidate,
  );
  const remainingHumans = humansStillInMatch(players);
  const remainingActive = activePlayers(players);
  const roomAbandoned = remainingHumans.length === 0;
  const matchWasActive =
    state.phase === "Starting" ||
    state.phase === "RoundActive" ||
    state.phase === "ResolvingRound";
  const winner =
    !roomAbandoned && matchWasActive && remainingActive.length === 1
      ? remainingActive[0].id
      : undefined;
  const hostPlayerId =
    state.hostPlayerId === input.playerId
      ? (nextHumanHost(players, input.playerId) ?? state.hostPlayerId)
      : state.hostPlayerId;

  let currentTurnPlayerId = state.currentTurnPlayerId;
  let currentTurnId = state.currentTurnId;
  let finalDecisionPlayerId =
    state.finalDecisionPlayerId ?? state.startingPlayerId;

  if (!roomAbandoned && !winner && state.phase === "RoundActive") {
    if (currentTurnPlayerId === input.playerId) {
      currentTurnPlayerId =
        advanceToNextActivePlayer(players, input.playerId) ?? undefined;
      currentTurnId = currentTurnPlayerId
        ? turnId(
            state.roomId,
            state.roundNumber,
            currentTurnPlayerId,
            state.claimHistory.length,
          )
        : undefined;
    }
    if (finalDecisionPlayerId === input.playerId) {
      finalDecisionPlayerId =
        advanceToNextActivePlayer(players, input.playerId) ?? undefined;
    }
  }

  const phase = roomAbandoned ? "Abandoned" : winner ? "GameOver" : state.phase;
  const terminal = phase === "Abandoned" || phase === "GameOver";
  const becameTerminal = terminal && phase !== state.phase;
  const nextState: GameState = {
    ...state,
    phase,
    stateRevision: nextRevision,
    matchId,
    hostPlayerId,
    players,
    currentTurnPlayerId: terminal ? undefined : currentTurnPlayerId,
    currentTurnId: terminal ? undefined : currentTurnId,
    currentClaim: terminal ? undefined : state.currentClaim,
    activeClaimWindow: terminal ? undefined : state.activeClaimWindow,
    finalDecisionPlayerId: terminal ? undefined : finalDecisionPlayerId,
    turnStartedAt: terminal ? undefined : state.turnStartedAt,
    turnExpiresAt: terminal ? undefined : state.turnExpiresAt,
    winnerPlayerId: winner ?? state.winnerPlayerId,
    matchEndedReason: roomAbandoned
      ? "ABANDONED"
      : winner
        ? "LAST_PLAYER_STANDING"
        : state.matchEndedReason,
    endedAt: becameTerminal ? input.now : state.endedAt,
    leaveReceipts: appendLeaveReceipt(state, input, nextRevision),
  };

  return { ok: true, state: nextState };
}

export function setPlayerReady(
  state: GameState,
  input: SetReadyInput,
): LifecycleResult {
  if (state.phase !== "Lobby") {
    return lifecycleError(state, "GAME_ALREADY_STARTED");
  }
  const player = state.players.find(
    (candidate) => candidate.id === input.playerId,
  );
  if (!player || player.isBot || player.leftAt !== undefined) {
    return lifecycleError(state, "PLAYER_NOT_FOUND");
  }
  if (player.ready === input.ready) {
    return { ok: true, state };
  }
  return {
    ok: true,
    state: {
      ...state,
      socialRevision: (state.socialRevision ?? 0) + 1,
      players: state.players.map((candidate) =>
        candidate.id === input.playerId
          ? { ...candidate, ready: input.ready }
          : candidate,
      ),
    },
  };
}

export function endGame(
  state: GameState,
  input: EndGameInput,
): LifecycleResult {
  const matchId = state.matchId ?? `${state.roomId}:match:1`;
  if (input.matchId !== matchId) {
    return lifecycleError(state, "MATCH_CHANGED");
  }
  if (state.hostPlayerId !== input.playerId) {
    return lifecycleError(state, "NOT_HOST");
  }
  const host = state.players.find((player) => player.id === input.playerId);
  if (!host || host.leftAt !== undefined) {
    return lifecycleError(state, "PLAYER_LEFT_MATCH");
  }
  if (state.phase === "Abandoned" || state.phase === "Closed") {
    return lifecycleError(state, "ROOM_CLOSED");
  }
  if (state.phase === "GameOver") {
    return { ok: true, state };
  }

  return {
    ok: true,
    state: {
      ...state,
      phase: "GameOver",
      stateRevision: state.stateRevision + 1,
      currentTurnPlayerId: undefined,
      currentTurnId: undefined,
      currentClaim: undefined,
      activeClaimWindow: undefined,
      finalDecisionPlayerId: undefined,
      turnStartedAt: undefined,
      turnExpiresAt: undefined,
      winnerPlayerId: undefined,
      matchEndedReason: "HOST_ENDED",
      endedByPlayerId: input.playerId,
      endedAt: input.now,
    },
  };
}

export function startRematch(
  state: GameState,
  input: StartRematchInput,
): LifecycleResult {
  const matchId = state.matchId ?? `${state.roomId}:match:1`;
  if (input.matchId !== matchId) {
    return lifecycleError(state, "MATCH_CHANGED");
  }
  if (state.hostPlayerId !== input.playerId) {
    return lifecycleError(state, "NOT_HOST");
  }
  if (state.phase !== "GameOver") {
    return lifecycleError(state, "GAME_NOT_OVER");
  }

  const players = state.players
    .filter((player) => player.leftAt === undefined)
    .map((player) => ({
      ...player,
      cardCount: 1,
      eliminated: false,
      ready: player.isBot,
      roundCards: [],
    }));
  const matchNumber = (state.matchNumber ?? 1) + 1;

  return {
    ok: true,
    state: {
      ...state,
      phase: "Lobby",
      stateRevision: state.stateRevision + 1,
      socialRevision: (state.socialRevision ?? 0) + 1,
      matchId: `${state.roomId}:match:${matchNumber}`,
      matchNumber,
      players,
      playerCredentials: credentials(state).filter((credential) =>
        players.some((player) => player.id === credential.playerId),
      ),
      roundNumber: 0,
      roundParticipantIds: [],
      startingPlayerId: undefined,
      finalDecisionPlayerId: undefined,
      currentTurnPlayerId: undefined,
      currentTurnId: undefined,
      currentClaim: undefined,
      activeClaimWindow: undefined,
      claimHistory: [],
      turnStartedAt: undefined,
      turnExpiresAt: undefined,
      lastRoundResult: undefined,
      winnerPlayerId: undefined,
      matchEndedReason: undefined,
      endedByPlayerId: undefined,
      endedAt: undefined,
      leaveReceipts: [],
      reactions: [],
    },
  };
}

export function sendReaction(
  state: GameState,
  input: SendReactionInput,
): LifecycleResult {
  const player = state.players.find(
    (candidate) => candidate.id === input.playerId,
  );
  if (!player || player.isBot || player.leftAt !== undefined) {
    return lifecycleError(state, "PLAYER_NOT_FOUND");
  }
  if (!REACTION_KINDS.includes(input.kind)) {
    return lifecycleError(state, "INVALID_REACTION");
  }
  if (
    (state.reactions ?? []).some(
      (reaction) => reaction.requestId === input.requestId,
    )
  ) {
    return { ok: true, state };
  }

  return {
    ok: true,
    state: {
      ...state,
      socialRevision: (state.socialRevision ?? 0) + 1,
      reactions: [
        ...(state.reactions ?? []),
        {
          id: `${state.roomId}:reaction:${input.requestId}`,
          requestId: input.requestId,
          playerId: input.playerId,
          kind: input.kind,
          createdAt: input.now,
        },
      ].slice(-20),
    },
  };
}
