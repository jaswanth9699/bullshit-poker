import assert from "node:assert/strict";
import test from "node:test";

import {
  createRoomWithHost,
  addBotToRoom,
  advanceToNextRound,
  connectPlayer,
  createCard,
  disconnectPlayer,
  generateRoomCode,
  joinRoom,
  removeBotFromRoom,
  removePlayerFromRoom,
  startGame,
  type GameState,
  type PlayerState,
  type RoomIdentityProvider,
} from "../../src/shared/index.ts";

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
      return `verifier:${playerId}:${pin.split("").reverse().join("")}`;
    },
    verifyPin(pin, verifier, playerId) {
      return (
        verifier === `verifier:${playerId}:${pin.split("").reverse().join("")}`
      );
    },
    hashReconnectToken(token, playerId) {
      return `token-hash:${playerId}:${token}`;
    },
  };
}

function createHostRoom(identity = identityProvider()) {
  const result = createRoomWithHost({
    roomId: "room-1",
    code: "ABC123",
    hostName: "Jaswanth",
    pin: "1234",
    now: 100,
    identity,
  });

  assert.equal(result.ok, true);
  return result;
}

function resolvedPlayer(
  id: string,
  seatIndex: number,
  options: { cardCount?: number; eliminated?: boolean; leftAt?: number } = {},
): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id,
    seatIndex,
    avatarKey: id,
    cardCount: options.cardCount ?? 1,
    eliminated: options.eliminated ?? false,
    connected: true,
    isBot: false,
    leftAt: options.leftAt,
    roundCards: [createCard("2", "S")],
  };
}

function resolvingState(
  players: PlayerState[],
  overrides: Partial<GameState> = {},
): GameState {
  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "ResolvingRound",
    stateRevision: 9,
    hostPlayerId: "A",
    players,
    roundNumber: 2,
    startingPlayerId: "A",
    currentTurnPlayerId: undefined,
    currentTurnId: undefined,
    currentClaim: undefined,
    activeClaimWindow: undefined,
    claimHistory: [
      {
        id: "claim-1",
        handType: "HIGH_CARD",
        primaryRank: "K",
        playerId: "C",
        sequence: 1,
      },
    ],
    turnDurationMs: 120000,
    ...overrides,
  };
}

test("generateRoomCode creates uppercase alphanumeric six-character codes", () => {
  const values = [0, 0.1, 0.2, 0.3, 0.4, 0.99];
  const code = generateRoomCode(() => values.shift() ?? 0);

  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z0-9]{6}$/);
});

test("createRoomWithHost creates lobby state with host seat and private credential", () => {
  const result = createHostRoom();

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.playerId, "player-1");
  assert.equal(result.reconnectToken, "token-1");
  assert.equal(result.state.phase, "Lobby");
  assert.equal(result.state.hostPlayerId, "player-1");
  assert.equal(result.state.players[0].seatIndex, 0);
  assert.equal(result.state.players[0].normalizedName, "JASWANTH");
  assert.equal(result.state.playerCredentials?.[0].playerId, "player-1");
  assert.notEqual(result.state.playerCredentials?.[0].pinVerifier, "1234");
});

test("createRoomWithHost rejects invalid PIN format", () => {
  const result = createRoomWithHost({
    roomId: "room-1",
    code: "ABC123",
    hostName: "Jaswanth",
    pin: "12A4",
    now: 100,
    identity: identityProvider(),
  });

  assert.deepEqual(result, {
    ok: false,
    code: "INVALID_PIN_FORMAT",
    latestStateRevision: 0,
  });
});

test("joinRoom adds a new player in lobby", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const joined = joinRoom(host.state, {
    name: "Friend",
    pin: "5678",
    now: 200,
    identity,
  });

  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  assert.equal(joined.playerId, "player-2");
  assert.equal(joined.reclaimed, false);
  assert.equal(joined.state.players.length, 2);
  assert.equal(joined.state.players[1].seatIndex, 1);
  assert.equal(joined.state.players[1].normalizedName, "FRIEND");
  assert.equal(joined.state.playerCredentials?.length, 2);
});

test("joinRoom rejects duplicate normalized name with wrong PIN", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const result = joinRoom(host.state, {
    name: " jaswanth ",
    pin: "9999",
    now: 200,
    identity,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "PIN_MISMATCH",
    latestStateRevision: host.state.stateRevision,
  });
});

test("joinRoom reclaims existing seat with same normalized name and correct PIN", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const result = joinRoom(host.state, {
    name: " jaswanth ",
    pin: "1234",
    now: 200,
    identity,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.playerId, "player-1");
  assert.equal(result.reclaimed, true);
  assert.equal(result.reconnectToken, "token-2");
  assert.equal(result.state.players.length, 1);
  assert.equal(result.state.stateRevision, host.state.stateRevision + 1);
});

test("joinRoom reclaims an original started-game seat with same name and PIN", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const joined = joinRoom(host.state, {
    name: "Friend",
    pin: "5678",
    now: 200,
    identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const started = startGame(joined.state, {
    hostPlayerId: "player-1",
    now: 300,
    rng: () => 0,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const disconnected = disconnectPlayer(started.state, {
    playerId: "player-2",
    now: 400,
  });
  assert.equal(disconnected.ok, true);
  if (!disconnected.ok) return;

  const reclaimed = joinRoom(disconnected.state, {
    name: " friend ",
    pin: "5678",
    now: 500,
    identity,
  });

  assert.equal(reclaimed.ok, true);
  if (!reclaimed.ok) return;
  assert.equal(reclaimed.playerId, "player-2");
  assert.equal(reclaimed.reclaimed, true);
  assert.equal(reclaimed.reconnectToken, "token-3");
  assert.equal(
    reclaimed.state.players.find((player) => player.id === "player-2")
      ?.connected,
    true,
  );
  assert.equal(reclaimed.state.players.length, 2);
  assert.deepEqual(
    reclaimed.state.players.find((player) => player.id === "player-2")
      ?.roundCards,
    started.state.players.find((player) => player.id === "player-2")
      ?.roundCards,
  );
});

test("joinRoom blocks new started-game names and wrong PIN seat claims", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const joined = joinRoom(host.state, {
    name: "Friend",
    pin: "5678",
    now: 200,
    identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const started = startGame(joined.state, {
    hostPlayerId: "player-1",
    now: 300,
    rng: () => 0,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  assert.deepEqual(
    joinRoom(started.state, {
      name: "Friend",
      pin: "9999",
      now: 400,
      identity,
    }),
    {
      ok: false,
      code: "PIN_MISMATCH",
      latestStateRevision: started.state.stateRevision,
    },
  );

  assert.deepEqual(
    joinRoom(started.state, {
      name: "Late Player",
      pin: "0000",
      now: 400,
      identity,
    }),
    {
      ok: false,
      code: "GAME_ALREADY_STARTED",
      latestStateRevision: started.state.stateRevision,
    },
  );
});

test("addBotToRoom adds a host-controlled bot seat without player credentials", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const added = addBotToRoom(host.state, {
    hostPlayerId: "player-1",
    now: 200,
    identity,
  });

  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.state.players.length, 2);
  assert.equal(added.state.players[1].id, "player-2");
  assert.equal(added.state.players[1].name, "Bot 1");
  assert.equal(added.state.players[1].isBot, true);
  assert.equal(added.state.players[1].seatIndex, 1);
  assert.equal(added.state.playerCredentials?.length, 1);
});

test("addBotToRoom enforces host-only, lobby-only, and unique names", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  assert.deepEqual(
    addBotToRoom(host.state, { hostPlayerId: "player-2", now: 200, identity }),
    {
      ok: false,
      code: "NOT_HOST",
      latestStateRevision: host.state.stateRevision,
    },
  );

  assert.deepEqual(
    addBotToRoom(host.state, {
      hostPlayerId: "player-1",
      name: " jaswanth ",
      now: 200,
      identity,
    }),
    {
      ok: false,
      code: "NAME_TAKEN",
      latestStateRevision: host.state.stateRevision,
    },
  );

  const added = addBotToRoom(host.state, {
    hostPlayerId: "player-1",
    now: 200,
    identity,
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const started = startGame(added.state, {
    hostPlayerId: "player-1",
    now: 300,
    rng: () => 0,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  assert.deepEqual(
    addBotToRoom(started.state, {
      hostPlayerId: "player-1",
      now: 400,
      identity,
    }),
    {
      ok: false,
      code: "GAME_ALREADY_STARTED",
      latestStateRevision: started.state.stateRevision,
    },
  );
});

test("startGame rejects non-host and rooms with fewer than two players", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  assert.deepEqual(
    startGame(host.state, { hostPlayerId: "player-2", now: 300, rng: () => 0 }),
    {
      ok: false,
      code: "NOT_HOST",
      latestStateRevision: host.state.stateRevision,
    },
  );
  assert.deepEqual(
    startGame(host.state, { hostPlayerId: "player-1", now: 300, rng: () => 0 }),
    {
      ok: false,
      code: "NOT_ENOUGH_PLAYERS",
      latestStateRevision: host.state.stateRevision,
    },
  );
});

test("removePlayerFromRoom lets the host remove any non-host seat in the lobby", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const joined = joinRoom(host.state, {
    name: "Friend",
    pin: "5678",
    now: 200,
    identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const removed = removePlayerFromRoom(joined.state, {
    hostPlayerId: "player-1",
    targetPlayerId: "player-2",
    now: 250,
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(
    removed.state.players.some((player) => player.id === "player-2"),
    false,
  );
  assert.equal(
    removed.state.playerCredentials?.some(
      (credential) => credential.playerId === "player-2",
    ),
    false,
  );

  assert.deepEqual(
    removePlayerFromRoom(joined.state, {
      hostPlayerId: "player-2",
      targetPlayerId: "player-2",
      now: 250,
    }),
    {
      ok: false,
      code: "NOT_HOST",
      latestStateRevision: joined.state.stateRevision,
    },
  );

  assert.deepEqual(
    removePlayerFromRoom(joined.state, {
      hostPlayerId: "player-1",
      targetPlayerId: "player-1",
      now: 250,
    }),
    {
      ok: false,
      code: "CANNOT_REMOVE_HOST",
      latestStateRevision: joined.state.stateRevision,
    },
  );

  assert.deepEqual(
    removePlayerFromRoom(joined.state, {
      hostPlayerId: "player-1",
      targetPlayerId: "missing",
      now: 250,
    }),
    {
      ok: false,
      code: "PLAYER_NOT_FOUND",
      latestStateRevision: joined.state.stateRevision,
    },
  );
});

test("removeBotFromRoom keeps the compatibility bot-only contract", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const added = addBotToRoom(host.state, {
    hostPlayerId: "player-1",
    now: 200,
    identity,
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const removed = removeBotFromRoom(added.state, {
    hostPlayerId: "player-1",
    botPlayerId: "player-2",
    now: 250,
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.state.players.length, 1);
  assert.equal(removed.state.players[0].id, "player-1");

  assert.deepEqual(
    removeBotFromRoom(added.state, {
      hostPlayerId: "player-2",
      botPlayerId: "player-2",
      now: 250,
    }),
    {
      ok: false,
      code: "NOT_HOST",
      latestStateRevision: added.state.stateRevision,
    },
  );

  assert.deepEqual(
    removeBotFromRoom(added.state, {
      hostPlayerId: "player-1",
      botPlayerId: "player-1",
      now: 250,
    }),
    {
      ok: false,
      code: "BOT_NOT_FOUND",
      latestStateRevision: added.state.stateRevision,
    },
  );

  const started = startGame(added.state, {
    hostPlayerId: "player-1",
    now: 300,
    rng: () => 0,
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.deepEqual(
    removeBotFromRoom(started.state, {
      hostPlayerId: "player-1",
      botPlayerId: "player-2",
      now: 350,
    }),
    {
      ok: false,
      code: "GAME_ALREADY_STARTED",
      latestStateRevision: started.state.stateRevision,
    },
  );
});

test("startGame deals one card to each player and starts with host seat 0", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  if (!host.ok) return;

  const joined = joinRoom(host.state, {
    name: "Friend",
    pin: "5678",
    now: 200,
    identity,
  });
  assert.equal(joined.ok, true);
  if (!joined.ok) return;

  const started = startGame(joined.state, {
    hostPlayerId: "player-1",
    now: 300,
    rng: () => 0,
  });

  assert.equal(started.ok, true);
  if (!started.ok) return;

  assert.equal(started.state.phase, "RoundActive");
  assert.equal(started.state.roundNumber, 1);
  assert.equal(started.state.startingPlayerId, "player-1");
  assert.equal(started.state.currentTurnPlayerId, "player-1");
  assert.equal(started.state.currentClaim, undefined);
  assert.equal(started.state.activeClaimWindow, undefined);
  assert.equal(started.state.turnStartedAt, 300);
  assert.equal(started.state.turnExpiresAt, undefined);
  assert.equal(
    started.state.players.every((player) => player.roundCards.length === 1),
    true,
  );
  assert.notEqual(
    started.state.players[0].roundCards[0].id,
    started.state.players[1].roundCards[0].id,
  );
});

test("connectPlayer validates reconnect token and marks player connected", () => {
  const identity = identityProvider();
  const host = createHostRoom(identity);
  assert.equal(host.ok, true);
  if (!host.ok) return;

  const disconnected = disconnectPlayer(host.state, {
    playerId: "player-1",
    now: 150,
  });
  assert.equal(disconnected.ok, true);
  if (!disconnected.ok) return;
  assert.equal(disconnected.state.players[0].connected, false);

  const rejected = connectPlayer(disconnected.state, {
    playerId: "player-1",
    reconnectToken: "wrong-token",
    now: 200,
    identity,
  });
  assert.deepEqual(rejected, {
    ok: false,
    code: "RECONNECT_TOKEN_INVALID",
    latestStateRevision: disconnected.state.stateRevision,
  });

  const connected = connectPlayer(disconnected.state, {
    playerId: "player-1",
    reconnectToken: host.reconnectToken!,
    now: 250,
    identity,
  });

  assert.equal(connected.ok, true);
  if (!connected.ok) return;
  assert.equal(connected.state.players[0].connected, true);
  assert.equal(connected.state.players[0].leftAt, undefined);
});

test("advanceToNextRound deals new cards and rotates clockwise from previous starter", () => {
  const state = resolvingState([
    resolvedPlayer("A", 0),
    resolvedPlayer("B", 1, { cardCount: 2 }),
    resolvedPlayer("C", 2),
  ]);

  const result = advanceToNextRound(state, { now: 1_000, rng: () => 0 });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.phase, "RoundActive");
  assert.equal(result.state.roundNumber, 3);
  assert.equal(result.state.startingPlayerId, "B");
  assert.equal(result.state.currentTurnPlayerId, "B");
  assert.equal(result.state.currentTurnId, "room-1:round:3:turn:B:0");
  assert.equal(result.state.claimHistory.length, 0);
  assert.equal(
    result.state.players.find((player) => player.id === "B")?.roundCards.length,
    2,
  );
  assert.equal(result.state.turnStartedAt, 1_000);
  assert.equal(result.state.turnExpiresAt, undefined);
});

test("advanceToNextRound skips eliminated and voluntary-leaver seats", () => {
  const bEliminated = advanceToNextRound(
    resolvingState([
      resolvedPlayer("A", 0),
      resolvedPlayer("B", 1, { eliminated: true, cardCount: 6 }),
      resolvedPlayer("C", 2),
    ]),
    { now: 1_000, rng: () => 0 },
  );
  assert.equal(bEliminated.ok && bEliminated.state.startingPlayerId, "C");

  const aEliminated = advanceToNextRound(
    resolvingState([
      resolvedPlayer("A", 0, { eliminated: true, cardCount: 6 }),
      resolvedPlayer("B", 1),
      resolvedPlayer("C", 2),
    ]),
    { now: 1_000, rng: () => 0 },
  );
  assert.equal(aEliminated.ok && aEliminated.state.startingPlayerId, "B");

  const bLeft = advanceToNextRound(
    resolvingState([
      resolvedPlayer("A", 0),
      resolvedPlayer("B", 1, { leftAt: 900 }),
      resolvedPlayer("C", 2),
    ]),
    { now: 1_000, rng: () => 0 },
  );
  assert.equal(bLeft.ok && bLeft.state.startingPlayerId, "C");
});

test("advanceToNextRound rejects rooms that are not waiting after a resolved round", () => {
  const state = resolvingState(
    [resolvedPlayer("A", 0), resolvedPlayer("B", 1)],
    { phase: "RoundActive" },
  );
  const result = advanceToNextRound(state, { now: 1_000, rng: () => 0 });

  assert.deepEqual(result, {
    ok: false,
    code: "ROUND_NOT_RESOLVED",
    latestStateRevision: state.stateRevision,
  });
});
