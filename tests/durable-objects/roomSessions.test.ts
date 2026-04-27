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
  createCard,
  type GameState,
  type PlayerState,
  type RoomIdentityProvider,
  type RoomServerMessage,
} from "../../src/shared/index.ts";

class FakeSocket implements RoomSocketLike {
  accepted = false;
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
    state?.players.find((player) => player.id === room.hostPlayerId)
      ?.connected,
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
    "ROUND_ALREADY_RESOLVED",
  );
});

test("RoomSessionManager advances from round review into the next dealt round", async () => {
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
  assert.equal((await room.authority.getState())?.phase, "ResolvingRound");

  hostSocket.clear();
  friendSocket.clear();
  await manager.handleSocketMessage(
    friendSessionId,
    JSON.stringify({
      type: "START_NEXT_ROUND",
      requestId: "next-1",
    }),
    2_000,
  );

  const update = friendSocket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(update?.reason, "ACTION_ACCEPTED");
  assert.equal(update?.requestId, "next-1");
  assert.equal(update?.view.phase, "RoundActive");
  assert.equal(update?.view.roundNumber, 2);
  assert.equal(update?.view.startingPlayerId, room.friendPlayerId);
  assert.equal(update?.view.viewerCards.length, 1);
});

test("RoomSessionManager automatically advances after the round reveal beat", async () => {
  const room = await startedRoom();
  let now = 500;
  const manager = new RoomSessionManager(room.authority, {
    now: () => now,
    rng: () => 0,
    autoNextRoundDelayMs: 0,
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
  friendSocket.clear();
  now = 2_000;
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

  assert.equal((await room.authority.getState())?.phase, "ResolvingRound");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const state = await room.authority.getState();
  const update = friendSocket.lastMessageOfType("ROOM_UPDATED");
  assert.equal(state?.phase, "RoundActive");
  assert.equal(state?.roundNumber, 2);
  assert.equal(update?.reason, "AUTO_NEXT_ROUND");
  assert.equal(update?.view.phase, "RoundActive");
  assert.equal(update?.view.roundNumber, 2);
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

  assert.equal(state?.phase, "ResolvingRound");
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
