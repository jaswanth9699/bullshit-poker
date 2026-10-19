import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRoomStateStore,
  RoomAuthority,
  RoomSessionManager,
  type RoomSocketEvent,
  type RoomSocketLike,
} from "../../src/durable-objects/index.ts";
import {
  applyCallBullshit,
  applySubmitClaim,
  createCard,
  type GameState,
  type PlayerState,
  type RoomIdentityProvider,
  type RoomServerMessage,
} from "../../src/shared/index.ts";

class FakeSocket implements RoomSocketLike {
  accepted = false;
  failSends = false;
  closed?: { code?: number; reason?: string };
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    Array<(event: RoomSocketEvent) => void>
  >();

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    if (this.failSends) throw new Error("socket send failed");
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  addEventListener(
    type: "message" | "close" | "error",
    listener: (event: RoomSocketEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: "message" | "close" | "error", event: RoomSocketEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  messages(): RoomServerMessage[] {
    return this.sent.map((message) => JSON.parse(message) as RoomServerMessage);
  }

  lastMessageOfType<TType extends RoomServerMessage["type"]>(
    type: TType,
  ): Extract<RoomServerMessage, { type: TType }> | undefined {
    return this.messages()
      .filter(
        (message): message is Extract<RoomServerMessage, { type: TType }> =>
          message.type === type,
      )
      .at(-1);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

function identityProvider(): RoomIdentityProvider {
  let playerCounter = 0;
  let tokenCounter = 0;

  return {
    createPlayerId() {
      playerCounter += 1;
      return `player-${playerCounter}`;
    },
    createReconnectToken() {
      tokenCounter += 1;
      return `token-${tokenCounter}`;
    },
    createPinVerifier(pin, playerId) {
      return `pin:${playerId}:${pin}`;
    },
    verifyPin(pin, verifier, playerId) {
      return verifier === `pin:${playerId}:${pin}`;
    },
    hashReconnectToken(token, playerId) {
      return `token:${playerId}:${token}`;
    },
  };
}

function sessionTestPlayer(
  id: string,
  seatIndex: number,
  cards: PlayerState["roundCards"],
  options: Partial<PlayerState> = {},
): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id,
    seatIndex,
    avatarKey: id,
    cardCount: cards.length,
    eliminated: false,
    connected: true,
    isBot: false,
    roundCards: cards,
    ...options,
  };
}

function roomStateWithBot(params: {
  currentTurnPlayerId: string;
  currentClaim?: GameState["currentClaim"];
  activeClaimWindow?: GameState["activeClaimWindow"];
  botCards: PlayerState["roundCards"];
  botId?: string;
  humanCards?: PlayerState["roundCards"];
}): GameState {
  const botId = params.botId ?? "bot";
  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "RoundActive",
    stateRevision: 5,
    hostPlayerId: "human",
    players: [
      sessionTestPlayer(
        "human",
        0,
        params.humanCards ?? [createCard("2", "D")],
      ),
      sessionTestPlayer(botId, 1, params.botCards, { isBot: true }),
    ],
    playerCredentials: [
      {
        playerId: "human",
        normalizedName: "human",
        pinVerifier: "pin:human:1234",
        reconnectTokenHash: "token:human:token-human",
      },
    ],
    roundNumber: 1,
    startingPlayerId: "human",
    currentTurnPlayerId: params.currentTurnPlayerId,
    currentTurnId: `turn-${params.currentTurnPlayerId}`,
    currentClaim: params.currentClaim,
    activeClaimWindow: params.activeClaimWindow,
    claimHistory: params.currentClaim ? [params.currentClaim] : [],
    turnStartedAt: 100,
    turnExpiresAt: 120100,
    turnDurationMs: 120000,
  };
}

async function startedRoom() {
  const identity = identityProvider();
  const authority = new RoomAuthority(new MemoryRoomStateStore());

  const created = await authority.createRoom({
    roomId: "room-1",
    code: "ABC123",
    hostName: "Host",
    pin: "1234",
    now: 100,
    identity,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("create failed");

  const joined = await authority.joinRoom({
    name: "Friend",
    pin: "5678",
    now: 200,
    identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) throw new Error("join failed");

  const started = await authority.startGame(created.playerId!, 300, () => 0);
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error("start failed");

  return {
    authority,
    identity,
    hostPlayerId: created.playerId!,
    hostToken: created.reconnectToken!,
    friendPlayerId: joined.playerId!,
    friendToken: joined.reconnectToken!,
  };
}

async function lobbyRoom() {
  const identity = identityProvider();
  const authority = new RoomAuthority(new MemoryRoomStateStore());

  const created = await authority.createRoom({
    roomId: "room-1",
    code: "ABC123",
    hostName: "Host",
    pin: "1234",
    now: 100,
    identity,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("create failed");

  return {
    authority,
    identity,
    hostPlayerId: created.playerId!,
    hostToken: created.reconnectToken!,
  };
}

async function connectPlayer(params: {
  manager: RoomSessionManager;
  socket: FakeSocket;
  playerId: string;
  reconnectToken: string;
  identity: RoomIdentityProvider;
}) {
  const result = await params.manager.connectSocket({
    socket: params.socket,
    playerId: params.playerId,
    reconnectToken: params.reconnectToken,
    identity: params.identity,
    now: 500,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("connect failed");
  return result.sessionId;
}

test("RoomSessionManager accepts valid reconnect token and sends a private hand-only view", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const socket = new FakeSocket();
  await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });

  const state = await room.authority.getState();
  const friendCardId = state!.players.find(
    (player) => player.id === room.friendPlayerId,
  )!.roundCards[0].id;
  const accepted = socket.lastMessageOfType("SESSION_ACCEPTED");
  const serialized = JSON.stringify(accepted);

  assert.equal(socket.accepted, true);
  assert.equal(accepted?.view.viewerPlayerId, room.hostPlayerId);
  assert.equal(accepted?.view.viewerCards.length, 1);
  assert.equal(serialized.includes(friendCardId), false);
  assert.equal(serialized.includes("roundCards"), false);
});

test("RoomSessionManager rejects invalid reconnect token before adding a session", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const socket = new FakeSocket();

  const result = await manager.connectSocket({
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: "wrong-token",
    identity: room.identity,
    now: 500,
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "RECONNECT_TOKEN_INVALID");
  assert.equal(socket.closed?.code, 1008);
  assert.equal(manager.activeSessionCount, 0);
});

test("RoomSessionManager replaces an older live session for the same player", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const firstSocket = new FakeSocket();
  const secondSocket = new FakeSocket();

  await connectPlayer({
    manager,
    socket: firstSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  await connectPlayer({
    manager,
    socket: secondSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });

  const accepted = secondSocket.lastMessageOfType("SESSION_ACCEPTED");
  const state = await room.authority.getState();

  assert.equal(manager.activeSessionCount, 1);
  assert.deepEqual(firstSocket.closed, {
    code: 4000,
    reason: "SESSION_REPLACED",
  });
  assert.equal(accepted?.view.viewerPlayerId, room.hostPlayerId);
  assert.equal(
    state?.players.find((player) => player.id === room.hostPlayerId)?.connected,
    true,
  );
});

test("RoomSessionManager broadcasts accepted actions as sanitized per-player views", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  const hostSessionId = await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: room.friendPlayerId,
    reconnectToken: room.friendToken,
    identity: room.identity,
  });
  hostSocket.clear();
  friendSocket.clear();

  const state = await room.authority.getState();
  const hostCardId = state!.players.find(
    (player) => player.id === room.hostPlayerId,
  )!.roundCards[0].id;
  const friendCardId = state!.players.find(
    (player) => player.id === room.friendPlayerId,
  )!.roundCards[0].id;

  await manager.handleSocketMessage(
    hostSessionId,
    JSON.stringify({
      type: "SUBMIT_CLAIM",
      envelope: {
        requestId: "claim-1",
        roomId: "room-1",
        playerId: room.hostPlayerId,
        stateRevision: state!.stateRevision,
        turnId: state!.currentTurnId,
        payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
      },
    }),
    1_000,
  );

  const hostUpdate = hostSocket.lastMessageOfType("ROOM_UPDATED");
  const friendUpdate = friendSocket.lastMessageOfType("ROOM_UPDATED");
  const friendSerialized = JSON.stringify(friendUpdate);

  assert.equal(hostUpdate?.reason, "ACTION_ACCEPTED");
  assert.equal(hostUpdate?.view.currentClaim?.playerId, room.hostPlayerId);
  assert.deepEqual(
    hostUpdate?.view.viewerCards.map((card) => card.id),
    [hostCardId],
  );
  assert.deepEqual(
    friendUpdate?.view.viewerCards.map((card) => card.id),
    [friendCardId],
  );
  assert.equal(friendSerialized.includes(hostCardId), false);
  assert.equal(friendSerialized.includes("roundCards"), false);
});

test("RoomSessionManager rejects playerId mismatch and stale post-resolution race actions", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  const hostSessionId = await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const friendSessionId = await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: room.friendPlayerId,
    reconnectToken: room.friendToken,
    identity: room.identity,
  });

  const startState = await room.authority.getState();
  await manager.handleSocketMessage(
    hostSessionId,
    JSON.stringify({
      type: "SUBMIT_CLAIM",
      envelope: {
        requestId: "bad-player",
        roomId: "room-1",
        playerId: room.friendPlayerId,
        stateRevision: startState!.stateRevision,
        turnId: startState!.currentTurnId,
        payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
      },
    }),
    1_000,
  );
  assert.equal(
    hostSocket.lastMessageOfType("ACTION_REJECTED")?.code,
    "PLAYER_SESSION_MISMATCH",
  );

  await manager.handleSocketMessage(
    hostSessionId,
    JSON.stringify({
      type: "SUBMIT_CLAIM",
      envelope: {
        requestId: "claim-1",
        roomId: "room-1",
        playerId: room.hostPlayerId,
        stateRevision: startState!.stateRevision,
        turnId: startState!.currentTurnId,
        payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
      },
    }),
    1_100,
  );
  const claimState = await room.authority.getState();

  await manager.handleSocketMessage(
    friendSessionId,
    JSON.stringify({
      type: "CALL_BULLSHIT",
      envelope: {
        requestId: "call-1",
        roomId: "room-1",
        playerId: room.friendPlayerId,
        stateRevision: claimState!.stateRevision,
        claimWindowId: claimState!.activeClaimWindow?.id,
        payload: {},
      },
    }),
    1_200,
  );

  await manager.handleSocketMessage(
    friendSessionId,
    JSON.stringify({
      type: "SUBMIT_CLAIM",
      envelope: {
        requestId: "stale-claim",
        roomId: "room-1",
        playerId: room.friendPlayerId,
        stateRevision: claimState!.stateRevision,
        turnId: claimState!.currentTurnId,
        claimWindowId: claimState!.activeClaimWindow?.id,
        payload: { claim: { handType: "PAIR", primaryRank: "2" } },
      },
    }),
    1_300,
  );

  assert.equal(
    friendSocket.lastMessageOfType("ACTION_REJECTED")?.code,
    "STALE_STATE_REVISION",
  );
});

test("RoomSessionManager broadcasts the frozen result and redealt round together", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(
    room.authority,
    () => 500,
    () => 0,
  );
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  const hostSessionId = await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const friendSessionId = await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: room.friendPlayerId,
    reconnectToken: room.friendToken,
    identity: room.identity,
  });

  const startState = await room.authority.getState();
  await manager.handleSocketMessage(
    hostSessionId,
    JSON.stringify({
      type: "SUBMIT_CLAIM",
      envelope: {
        requestId: "claim-1",
        roomId: "room-1",
        playerId: room.hostPlayerId,
        stateRevision: startState!.stateRevision,
        turnId: startState!.currentTurnId,
        payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
      },
    }),
    1_000,
  );

  const claimState = await room.authority.getState();
  await manager.handleSocketMessage(
    friendSessionId,
    JSON.stringify({
      type: "CALL_BULLSHIT",
      envelope: {
        requestId: "call-1",
        roomId: "room-1",
        playerId: room.friendPlayerId,
        stateRevision: claimState!.stateRevision,
        claimWindowId: claimState!.activeClaimWindow?.id,
        payload: {},
      },
    }),
    1_100,
  );
  const update = friendSocket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(update?.reason, "ACTION_ACCEPTED");
  assert.equal(update?.requestId, "call-1");
  assert.equal(update?.view.phase, "RoundActive");
  assert.equal(update?.view.roundNumber, 2);
  assert.equal(update?.view.startingPlayerId, room.friendPlayerId);
  assert.equal(update?.view.viewerCards.length, 1);
  assert.equal(update?.roundResult?.roundNumber, 1);
  assert.deepEqual(update?.view.lastRoundResult, update?.roundResult);
  assert.deepEqual(
    update?.roundResult?.revealedHands,
    claimState?.players.map((player) => ({
      playerId: player.id,
      cards: player.roundCards,
    })),
  );

  const afterCall = await room.authority.getState();
  await manager.handleSocketMessage(
    friendSessionId,
    JSON.stringify({ type: "START_NEXT_ROUND", requestId: "obsolete-next" }),
    2_000,
  );
  assert.equal(
    friendSocket.lastMessageOfType("ACTION_REJECTED")?.code,
    "ROUND_NOT_RESOLVED",
  );
  assert.deepEqual(await room.authority.getState(), afterCall);
});

test("RoomSessionManager recovers a persisted legacy review on reconnect exactly once", async () => {
  const room = await startedRoom();
  const state = (await room.authority.getState())!;
  const claimed = applySubmitClaim(
    state,
    {
      requestId: "legacy-claim",
      roomId: state.roomId,
      playerId: room.hostPlayerId,
      stateRevision: state.stateRevision,
      turnId: state.currentTurnId,
      payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
    },
    600,
  );
  assert.ok(claimed.ok);
  const resolved = applyCallBullshit(
    claimed.state,
    {
      requestId: "legacy-call",
      roomId: state.roomId,
      playerId: room.friendPlayerId,
      stateRevision: claimed.state.stateRevision,
      claimWindowId: claimed.state.activeClaimWindow?.id,
      payload: {},
    },
    700,
  );
  assert.ok(resolved.ok);
  assert.equal(resolved.state.phase, "ResolvingRound");

  const store = new MemoryRoomStateStore(resolved.state);
  const restartedAuthority = new RoomAuthority(store);
  const manager = new RoomSessionManager(restartedAuthority, { rng: () => 0 });
  const firstSocket = new FakeSocket();
  const secondSocket = new FakeSocket();
  const results = await Promise.all([
    manager.connectSocket({
      socket: firstSocket,
      playerId: room.hostPlayerId,
      reconnectToken: room.hostToken,
      identity: room.identity,
    }),
    manager.connectSocket({
      socket: secondSocket,
      playerId: room.friendPlayerId,
      reconnectToken: room.friendToken,
      identity: room.identity,
    }),
  ]);
  assert.ok(results.every((result) => result.ok));
  const recovered = await store.getState();
  assert.equal(recovered?.phase, "RoundActive");
  assert.equal(recovered?.roundNumber, 2);
  assert.equal(recovered?.stateRevision, resolved.state.stateRevision + 1);
  assert.deepEqual(recovered?.lastRoundResult, resolved.roundResult);
  for (const socket of [firstSocket, secondSocket]) {
    const accepted = socket.lastMessageOfType("SESSION_ACCEPTED");
    assert.equal(accepted?.view.phase, "RoundActive");
    assert.equal(accepted?.view.roundNumber, 2);
    assert.deepEqual(
      accepted?.view.lastRoundResult,
      JSON.parse(JSON.stringify(resolved.roundResult)),
    );
  }
});

test("RoomSessionManager adds bot seats from a host live session", async () => {
  const room = await lobbyRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const socket = new FakeSocket();
  const sessionId = await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  socket.clear();

  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({
      type: "ADD_BOT",
      requestId: "bot-add-1",
      name: "Table Bot",
    }),
    600,
  );

  const state = await room.authority.getState();
  const update = socket.lastMessageOfType("ROOM_UPDATED");

  assert.equal(state?.players.length, 2);
  assert.equal(state?.players[1].name, "Table Bot");
  assert.equal(state?.players[1].isBot, true);
  assert.equal(state?.playerCredentials?.length, 1);
  assert.equal(update?.requestId, "bot-add-1");
  assert.equal(update?.view.players[1].isBot, true);
});

test("RoomSessionManager removes lobby seats from a host live session before start", async () => {
  const room = await lobbyRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const socket = new FakeSocket();
  const sessionId = await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });

  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({ type: "ADD_BOT", requestId: "bot-add-1" }),
    600,
  );
  const bot = (await room.authority.getState())?.players.find(
    (player) => player.isBot,
  );
  assert.ok(bot);

  socket.clear();
  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({
      type: "REMOVE_PLAYER",
      requestId: "player-remove-1",
      targetPlayerId: bot.id,
    }),
    700,
  );

  const state = await room.authority.getState();
  const update = socket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(
    state?.players.some((player) => player.id === bot.id),
    false,
  );
  assert.equal(update?.requestId, "player-remove-1");
  assert.equal(
    update?.view.players.some((player) => player.id === bot.id),
    false,
  );
});

test("RoomSessionManager starts a bot-filled game from a host live session", async () => {
  const room = await lobbyRoom();
  const manager = new RoomSessionManager(
    room.authority,
    () => 500,
    () => 0,
  );
  const socket = new FakeSocket();
  const sessionId = await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });

  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({ type: "ADD_BOT", requestId: "bot-add-1" }),
    600,
  );
  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({ type: "START_GAME", requestId: "start-before-ready" }),
    625,
  );
  assert.equal(socket.lastMessageOfType("ACTION_REJECTED")?.code, "NOT_READY");
  assert.equal((await room.authority.getState())?.phase, "Lobby");
  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({ type: "SET_READY", requestId: "ready-1", ready: true }),
    650,
  );
  socket.clear();
  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({ type: "START_GAME", requestId: "start-1" }),
    700,
  );

  const state = await room.authority.getState();
  const update = socket.lastMessageOfType("ROOM_UPDATED");

  assert.equal(state?.phase, "RoundActive");
  assert.equal(state?.players.length, 2);
  assert.equal(
    state?.players.every((player) => player.roundCards.length === 1),
    true,
  );
  assert.equal(update?.requestId, "start-1");
  assert.equal(update?.view.phase, "RoundActive");
  assert.equal(update?.view.viewerCards.length, 1);
});

test("RoomSessionManager runs a bot turn through the normal submit-claim reducer", async () => {
  const identity = identityProvider();
  const authority = new RoomAuthority(
    new MemoryRoomStateStore(
      roomStateWithBot({
        currentTurnPlayerId: "bot",
        botCards: [createCard("A", "S")],
      }),
    ),
  );
  const manager = new RoomSessionManager(authority, {
    now: () => 1_000,
    botActionMinDelayMs: 0,
    botActionMaxDelayMs: 0,
  });
  const socket = new FakeSocket();

  await connectPlayer({
    manager,
    socket,
    playerId: "human",
    reconnectToken: "token-human",
    identity,
  });

  const state = await authority.getState();
  const botUpdate = socket.lastMessageOfType("ROOM_UPDATED");

  assert.equal(state?.currentClaim?.playerId, "bot");
  assert.equal(state?.currentClaim?.handType, "HIGH_CARD");
  assert.equal(state?.currentTurnPlayerId, "human");
  assert.equal(botUpdate?.acceptedByPlayerId, "bot");
  assert.equal(botUpdate?.view.currentClaim?.playerId, "bot");
});

test("RoomSessionManager spaces bot actions with a configured delay", async () => {
  const identity = identityProvider();
  const authority = new RoomAuthority(
    new MemoryRoomStateStore(
      roomStateWithBot({
        currentTurnPlayerId: "bot",
        botCards: [createCard("A", "S")],
      }),
    ),
  );
  const manager = new RoomSessionManager(authority, {
    now: () => 1_000,
    botActionMinDelayMs: 20,
    botActionMaxDelayMs: 20,
  });
  const socket = new FakeSocket();

  await connectPlayer({
    manager,
    socket,
    playerId: "human",
    reconnectToken: "token-human",
    identity,
  });

  assert.equal((await authority.getState())?.currentClaim, undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));

  const state = await authority.getState();
  const botUpdate = socket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(state?.currentClaim?.playerId, "bot");
  assert.equal(botUpdate?.acceptedByPlayerId, "bot");
});

test("RoomSessionManager lets a bot call BullShit before its turn claim", async () => {
  const identity = identityProvider();
  const currentClaim = {
    id: "claim-royal",
    handType: "ROYAL_FLUSH" as const,
    suit: "H" as const,
    playerId: "human",
    sequence: 1,
  };
  const authority = new RoomAuthority(
    new MemoryRoomStateStore(
      roomStateWithBot({
        currentTurnPlayerId: "bot",
        currentClaim,
        activeClaimWindow: {
          id: "window-1",
          claimId: "claim-royal",
          roundNumber: 1,
          openedByClaimSequence: 1,
          status: "OPEN",
          openedAt: 100,
        },
        botCards: [createCard("2", "S")],
      }),
    ),
  );
  const manager = new RoomSessionManager(authority, {
    now: () => 1_000,
    rng: () => 0,
    botStepLimit: 1,
    botActionMinDelayMs: 0,
    botActionMaxDelayMs: 0,
  });
  const socket = new FakeSocket();

  await connectPlayer({
    manager,
    socket,
    playerId: "human",
    reconnectToken: "token-human",
    identity,
  });

  const state = await authority.getState();
  const botUpdate = socket.lastMessageOfType("ROOM_UPDATED");

  assert.equal(state?.phase, "RoundActive");
  assert.equal(state?.roundNumber, 2);
  assert.equal(state?.lastRoundResult?.reason, "BULLSHIT_CALL");
  assert.equal(state?.lastRoundResult?.callerPlayerId, "bot");
  assert.equal(botUpdate?.acceptedByPlayerId, "bot");
  assert.equal(botUpdate?.roundResult?.callerPlayerId, "bot");
});

test("RoomSessionManager bot loop stops at its configured step limit", async () => {
  const identity = identityProvider();
  const state = roomStateWithBot({
    currentTurnPlayerId: "bot-a",
    botId: "bot-a",
    botCards: [createCard("A", "S")],
  });
  state.players.push(
    sessionTestPlayer("bot-b", 2, [createCard("K", "H")], {
      isBot: true,
    }),
  );
  const authority = new RoomAuthority(new MemoryRoomStateStore(state));
  const manager = new RoomSessionManager(authority, {
    now: () => 1_000,
    botStepLimit: 1,
    botActionMinDelayMs: 0,
    botActionMaxDelayMs: 0,
  });
  const socket = new FakeSocket();

  await connectPlayer({
    manager,
    socket,
    playerId: "human",
    reconnectToken: "token-human",
    identity,
  });

  const updated = await authority.getState();
  const updates = socket
    .messages()
    .filter((message) => message.type === "ROOM_UPDATED");

  assert.equal(updates.length, 1);
  assert.equal(updated?.currentClaim?.playerId, "bot-a");
  assert.equal(updated?.currentTurnPlayerId, "bot-b");
});

test("RoomSessionManager acknowledges permanent leave and broadcasts the resulting winner", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority, {
    now: () => 900,
    botActionMinDelayMs: 0,
    botActionMaxDelayMs: 0,
  });
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: room.friendPlayerId,
    reconnectToken: room.friendToken,
    identity: room.identity,
  });
  const before = await room.authority.getState();
  assert.ok(before?.matchId);
  hostSocket.clear();
  friendSocket.clear();

  await manager.handleSocketMessage(
    "session-1",
    JSON.stringify({
      type: "LEAVE_GAME",
      requestId: "leave-host",
      matchId: before.matchId,
    }),
    1_000,
  );

  assert.equal(
    hostSocket.lastMessageOfType("LEAVE_ACCEPTED")?.requestId,
    "leave-host",
  );
  assert.deepEqual(hostSocket.closed, { code: 1000, reason: "PLAYER_LEFT" });
  const update = friendSocket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(update?.reason, "PLAYER_LEFT");
  assert.equal(update?.view.phase, "GameOver");
  assert.equal(update?.view.winnerPlayerId, room.friendPlayerId);
  assert.equal(update?.view.hostPlayerId, room.friendPlayerId);

  const reconnect = await room.authority.connectPlayer(
    room.hostPlayerId,
    room.hostToken,
    room.identity,
    1_100,
  );
  assert.equal(reconnect.ok, false);
  if (!reconnect.ok) assert.equal(reconnect.code, "PLAYER_LEFT_MATCH");
});

test("RoomSessionManager deletes room state after the final human leaves", async () => {
  const room = await lobbyRoom();
  const bot = await room.authority.addBot({
    hostPlayerId: room.hostPlayerId,
    now: 200,
    identity: room.identity,
  });
  assert.equal(bot.ok, true);
  const manager = new RoomSessionManager(room.authority, { now: () => 500 });
  const socket = new FakeSocket();
  await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const before = await room.authority.getState();
  assert.ok(before?.matchId);
  socket.clear();

  await manager.handleSocketMessage(
    "session-1",
    JSON.stringify({
      type: "LEAVE_GAME",
      requestId: "leave-final-human",
      matchId: before.matchId,
    }),
    600,
  );

  assert.equal(socket.lastMessageOfType("LEAVE_ACCEPTED")?.roomAbandoned, true);
  assert.equal(await room.authority.getState(), undefined);
});

test("RoomSessionManager removes a voluntary lobby leaver from every remaining view", async () => {
  const room = await lobbyRoom();
  const joined = await room.authority.joinRoom({
    name: "Sri",
    pin: "5678",
    now: 200,
    identity: room.identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const manager = new RoomSessionManager(room.authority, () => 500);
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const friendSessionId = await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: joined.playerId!,
    reconnectToken: joined.reconnectToken!,
    identity: room.identity,
  });
  hostSocket.clear();
  friendSocket.clear();

  await manager.handleSocketMessage(
    friendSessionId,
    JSON.stringify({
      type: "LEAVE_GAME",
      requestId: "leave-sri",
      matchId: joined.state.matchId,
    }),
    600,
  );

  const hostUpdate = hostSocket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(
    friendSocket.lastMessageOfType("LEAVE_ACCEPTED")?.requestId,
    "leave-sri",
  );
  assert.deepEqual(
    hostUpdate?.view.players.map((player) => player.name),
    ["Host"],
  );
  assert.equal(hostUpdate?.reason, "PLAYER_LEFT");
  assert.equal(manager.activeSessionCount, 1);
  assert.equal(
    (await room.authority.getState())?.players.find(
      (player) => player.id === joined.playerId,
    )?.leftAt,
    600,
  );
});

test("a lobby leaver cannot reappear when leave and start are serialized", async () => {
  const room = await lobbyRoom();
  const joined = await room.authority.joinRoom({
    name: "Sri",
    pin: "5678",
    now: 200,
    identity: room.identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  const bot = await room.authority.addBot({
    hostPlayerId: room.hostPlayerId,
    now: 250,
    identity: room.identity,
  });
  assert.equal(bot.ok, true);

  const manager = new RoomSessionManager(room.authority, {
    now: () => 500,
    botActionMinDelayMs: 10_000,
    botActionMaxDelayMs: 10_000,
  });
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  const hostSessionId = await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const friendSessionId = await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: joined.playerId!,
    reconnectToken: joined.reconnectToken!,
    identity: room.identity,
  });
  await manager.handleSocketMessage(
    hostSessionId,
    JSON.stringify({ type: "SET_READY", requestId: "host-ready", ready: true }),
    550,
  );
  hostSocket.clear();
  friendSocket.clear();

  await Promise.all([
    manager.handleSocketMessage(
      friendSessionId,
      JSON.stringify({
        type: "LEAVE_GAME",
        requestId: "leave-sri",
        matchId: joined.state.matchId,
      }),
      600,
    ),
    manager.handleSocketMessage(
      hostSessionId,
      JSON.stringify({ type: "START_GAME", requestId: "start-after-leave" }),
      601,
    ),
  ]);

  const state = await room.authority.getState();
  const startUpdate = hostSocket
    .messages()
    .find(
      (message) =>
        message.type === "ROOM_UPDATED" &&
        message.requestId === "start-after-leave",
    );
  assert.equal(state?.phase, "RoundActive");
  assert.deepEqual(
    state?.players.map((player) => player.name),
    ["Host", "Bot 1"],
  );
  assert.deepEqual(
    startUpdate?.type === "ROOM_UPDATED"
      ? startUpdate.view.players.map((player) => player.name)
      : [],
    ["Host", "Bot 1"],
  );
  assert.equal(
    state?.playerCredentials?.some(
      (credential) => credential.playerId === joined.playerId,
    ),
    false,
  );
});

test("a leave serialized after start uses active-game winner rules", async () => {
  const room = await lobbyRoom();
  const joined = await room.authority.joinRoom({
    name: "Friend",
    pin: "5678",
    now: 200,
    identity: room.identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const manager = new RoomSessionManager(room.authority, () => 500);
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  const hostSessionId = await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const friendSessionId = await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: joined.playerId!,
    reconnectToken: joined.reconnectToken!,
    identity: room.identity,
  });
  await manager.handleSocketMessage(
    hostSessionId,
    JSON.stringify({ type: "SET_READY", requestId: "host-ready", ready: true }),
    550,
  );
  await manager.handleSocketMessage(
    friendSessionId,
    JSON.stringify({
      type: "SET_READY",
      requestId: "friend-ready",
      ready: true,
    }),
    551,
  );

  await Promise.all([
    manager.handleSocketMessage(
      hostSessionId,
      JSON.stringify({ type: "START_GAME", requestId: "start-first" }),
      600,
    ),
    manager.handleSocketMessage(
      friendSessionId,
      JSON.stringify({
        type: "LEAVE_GAME",
        requestId: "leave-after-start",
        matchId: joined.state.matchId,
      }),
      601,
    ),
  ]);

  const state = await room.authority.getState();
  assert.equal(state?.phase, "GameOver");
  assert.equal(state?.winnerPlayerId, room.hostPlayerId);
  assert.equal(state?.matchEndedReason, "LAST_PLAYER_STANDING");
  assert.equal(state?.currentTurnPlayerId, undefined);
});

test("RoomSessionManager terminates a host-removed human lobby session", async () => {
  const room = await lobbyRoom();
  const joined = await room.authority.joinRoom({
    name: "Friend",
    pin: "5678",
    now: 200,
    identity: room.identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const manager = new RoomSessionManager(room.authority, () => 500);
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  const hostSessionId = await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: joined.playerId!,
    reconnectToken: joined.reconnectToken!,
    identity: room.identity,
  });
  hostSocket.clear();
  friendSocket.clear();

  await manager.handleSocketMessage(
    hostSessionId,
    JSON.stringify({
      type: "REMOVE_PLAYER",
      requestId: "remove-friend",
      targetPlayerId: joined.playerId,
    }),
    600,
  );

  assert.equal(
    friendSocket.lastMessageOfType("SEAT_REMOVED")?.reason,
    "HOST_REMOVED",
  );
  assert.deepEqual(friendSocket.closed, { code: 1000, reason: "SEAT_REMOVED" });
  assert.equal(manager.activeSessionCount, 1);
  assert.deepEqual(
    hostSocket
      .lastMessageOfType("ROOM_UPDATED")
      ?.view.players.map((player) => player.name),
    ["Host"],
  );
});

test("RoomSessionManager rejects malformed messages without mutating room state", async () => {
  const room = await lobbyRoom();
  const manager = new RoomSessionManager(room.authority, () => 500);
  const socket = new FakeSocket();
  const sessionId = await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const before = await room.authority.getState();
  socket.clear();

  const malformedMessages = [
    { type: "SUBMIT_CLAIM" },
    { type: "SET_READY", requestId: "bad-ready", ready: "yes" },
    { type: "ADD_BOT", requestId: "bad-bot", name: 42 },
    { type: "LEAVE_GAME", requestId: "bad-leave" },
  ];
  for (const message of malformedMessages) {
    await manager.handleSocketMessage(sessionId, JSON.stringify(message), 600);
    assert.equal(
      socket.lastMessageOfType("ACTION_REJECTED")?.code,
      "INVALID_MESSAGE",
    );
  }

  assert.deepEqual(await room.authority.getState(), before);
});

test("RoomSessionManager isolates a failed socket send from healthy clients", async () => {
  const room = await lobbyRoom();
  const joined = await room.authority.joinRoom({
    name: "Friend",
    pin: "5678",
    now: 200,
    identity: room.identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const manager = new RoomSessionManager(room.authority, () => 500);
  const failedSocket = new FakeSocket();
  const healthySocket = new FakeSocket();
  await connectPlayer({
    manager,
    socket: failedSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const healthySessionId = await connectPlayer({
    manager,
    socket: healthySocket,
    playerId: joined.playerId!,
    reconnectToken: joined.reconnectToken!,
    identity: room.identity,
  });
  failedSocket.failSends = true;
  healthySocket.clear();

  await manager.handleSocketMessage(
    healthySessionId,
    JSON.stringify({
      type: "SET_READY",
      requestId: "friend-ready",
      ready: true,
    }),
    600,
  );

  const acceptedUpdate = healthySocket
    .messages()
    .find(
      (message) =>
        message.type === "ROOM_UPDATED" && message.requestId === "friend-ready",
    );
  assert.ok(acceptedUpdate);
});

test("RoomSessionManager serializes simultaneous final-human leaves", async () => {
  const room = await lobbyRoom();
  const joined = await room.authority.joinRoom({
    name: "Friend",
    pin: "5678",
    now: 200,
    identity: room.identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const manager = new RoomSessionManager(room.authority, () => 500);
  const hostSocket = new FakeSocket();
  const friendSocket = new FakeSocket();
  const hostSessionId = await connectPlayer({
    manager,
    socket: hostSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const friendSessionId = await connectPlayer({
    manager,
    socket: friendSocket,
    playerId: joined.playerId!,
    reconnectToken: joined.reconnectToken!,
    identity: room.identity,
  });
  hostSocket.clear();
  friendSocket.clear();

  await Promise.all([
    manager.handleSocketMessage(
      hostSessionId,
      JSON.stringify({
        type: "LEAVE_GAME",
        requestId: "leave-host",
        matchId: joined.state.matchId,
      }),
      600,
    ),
    manager.handleSocketMessage(
      friendSessionId,
      JSON.stringify({
        type: "LEAVE_GAME",
        requestId: "leave-friend",
        matchId: joined.state.matchId,
      }),
      601,
    ),
  ]);

  assert.equal(
    hostSocket.lastMessageOfType("LEAVE_ACCEPTED")?.requestId,
    "leave-host",
  );
  assert.equal(
    friendSocket.lastMessageOfType("LEAVE_ACCEPTED")?.requestId,
    "leave-friend",
  );
  assert.equal(await room.authority.getState(), undefined);
  assert.equal(manager.activeSessionCount, 0);
});

test("PIN reclaim retires the old socket before queued gameplay or leave can run", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority, { rng: () => 0 });
  const oldSocket = new FakeSocket();
  const oldSessionId = await connectPlayer({
    manager,
    socket: oldSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const before = (await room.authority.getState())!;
  const [reclaimed] = await Promise.all([
    manager.joinRoom({
      name: "Host",
      pin: "1234",
      now: 600,
      identity: room.identity,
    }),
    manager.handleSocketMessage(
      oldSessionId,
      JSON.stringify({
        type: "LEAVE_GAME",
        requestId: "stale-leave",
        matchId: before.matchId,
      }),
      601,
    ),
    manager.handleSocketMessage(
      oldSessionId,
      JSON.stringify({
        type: "END_GAME",
        requestId: "stale-end",
        matchId: before.matchId,
      }),
      602,
    ),
  ]);
  assert.ok(reclaimed.ok);
  assert.ok(reclaimed.reclaimed);
  assert.deepEqual(oldSocket.closed, {
    code: 4000,
    reason: "SESSION_REPLACED",
  });
  assert.equal(manager.activeSessionCount, 0);
  const afterReclaim = (await room.authority.getState())!;
  assert.equal(afterReclaim.phase, "RoundActive");
  assert.equal(afterReclaim.players[0].leftAt, undefined);
  assert.equal(afterReclaim.stateRevision, before.stateRevision + 1);
  await manager.disconnectSession(oldSessionId, 603);
  assert.deepEqual(await room.authority.getState(), afterReclaim);

  const newSocket = new FakeSocket();
  const newSessionId = await connectPlayer({
    manager,
    socket: newSocket,
    playerId: room.hostPlayerId,
    reconnectToken: reclaimed.reconnectToken!,
    identity: room.identity,
  });
  await manager.handleSocketMessage(
    newSessionId,
    JSON.stringify({
      type: "END_GAME",
      requestId: "current-end",
      matchId: afterReclaim.matchId,
    }),
    700,
  );
  assert.equal((await room.authority.getState())?.phase, "GameOver");
  assert.equal(
    newSocket.lastMessageOfType("ROOM_UPDATED")?.requestId,
    "current-end",
  );
});

test("failed PIN reclaim leaves the current connection authoritative", async () => {
  const room = await lobbyRoom();
  const manager = new RoomSessionManager(room.authority);
  const socket = new FakeSocket();
  const sessionId = await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const rejected = await manager.joinRoom({
    name: "Host",
    pin: "0000",
    now: 600,
    identity: room.identity,
  });
  assert.ok(!rejected.ok);
  assert.equal(rejected.code, "PIN_MISMATCH");
  assert.equal(socket.closed, undefined);
  assert.equal(manager.activeSessionCount, 1);
  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({
      type: "SET_READY",
      requestId: "still-ready",
      ready: true,
    }),
    700,
  );
  assert.equal((await room.authority.getState())?.players[0].ready, true);
});

test("replaced-session close and queued commands cannot disconnect or mutate the replacement", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority);
  const oldSocket = new FakeSocket();
  const oldSessionId = await connectPlayer({
    manager,
    socket: oldSocket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const before = (await room.authority.getState())!;
  const replacement = new FakeSocket();
  const [connected] = await Promise.all([
    manager.connectSocket({
      socket: replacement,
      playerId: room.hostPlayerId,
      reconnectToken: room.hostToken,
      identity: room.identity,
      now: 600,
    }),
    manager.handleSocketMessage(
      oldSessionId,
      JSON.stringify({
        type: "END_GAME",
        requestId: "old-end",
        matchId: before.matchId,
      }),
      601,
    ),
    manager.disconnectSession(oldSessionId, 602),
  ]);
  assert.ok(connected.ok);
  assert.equal(manager.activeSessionCount, 1);
  assert.deepEqual(await room.authority.getState(), before);
  assert.equal(replacement.closed, undefined);
});

test("a leave accepted before a racing reconnect cannot restore the departed seat", async () => {
  const room = await startedRoom();
  const manager = new RoomSessionManager(room.authority);
  const socket = new FakeSocket();
  const sessionId = await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const before = (await room.authority.getState())!;
  const replacement = new FakeSocket();
  const [, connected] = await Promise.all([
    manager.handleSocketMessage(
      sessionId,
      JSON.stringify({
        type: "LEAVE_GAME",
        requestId: "leave-first",
        matchId: before.matchId,
      }),
      600,
    ),
    manager.connectSocket({
      socket: replacement,
      playerId: room.hostPlayerId,
      reconnectToken: room.hostToken,
      identity: room.identity,
      now: 601,
    }),
  ]);
  assert.ok(!connected.ok);
  assert.equal(connected.code, "PLAYER_LEFT_MATCH");
  assert.equal(
    socket.lastMessageOfType("LEAVE_ACCEPTED")?.requestId,
    "leave-first",
  );
  assert.equal(
    (await room.authority.getState())?.winnerPlayerId,
    room.friendPlayerId,
  );
  assert.equal(manager.activeSessionCount, 0);
});

test("duplicate lobby commands acknowledge current state without repeating or reversing changes", async () => {
  const room = await lobbyRoom();
  const manager = new RoomSessionManager(room.authority);
  const socket = new FakeSocket();
  const sessionId = await connectPlayer({
    manager,
    socket,
    playerId: room.hostPlayerId,
    reconnectToken: room.hostToken,
    identity: room.identity,
  });
  const add = JSON.stringify({ type: "ADD_BOT", requestId: "add-once" });
  await Promise.all([
    manager.handleSocketMessage(sessionId, add, 600),
    manager.handleSocketMessage(sessionId, add, 601),
  ]);
  const afterAdd = (await room.authority.getState())!;
  assert.equal(afterAdd.players.length, 2);
  assert.equal(socket.lastMessageOfType("ROOM_UPDATED")?.requestId, "add-once");
  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({
      type: "ADD_BOT",
      requestId: "add-once",
      name: "Different bot",
    }),
    602,
  );
  assert.equal(
    socket.lastMessageOfType("ACTION_REJECTED")?.code,
    "REQUEST_ID_REUSED",
  );
  assert.deepEqual(await room.authority.getState(), afterAdd);

  const ready = JSON.stringify({
    type: "SET_READY",
    requestId: "ready-once",
    ready: true,
  });
  await manager.handleSocketMessage(sessionId, ready, 700);
  await manager.handleSocketMessage(
    sessionId,
    JSON.stringify({ type: "SET_READY", requestId: "unready", ready: false }),
    701,
  );
  const unready = (await room.authority.getState())!;
  await manager.handleSocketMessage(sessionId, ready, 702);
  assert.deepEqual(await room.authority.getState(), unready);
  const acknowledgement = socket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(acknowledgement?.reason, "ACTION_ACCEPTED");
  assert.equal(acknowledgement?.requestId, "ready-once");
  assert.equal(acknowledgement?.view.players[0].ready, false);
});
