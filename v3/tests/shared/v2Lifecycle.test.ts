import assert from "node:assert/strict";
import test from "node:test";

import {
  createCard,
  endGame,
  sendReaction,
  setPlayerReady,
  startRematch,
  type GameState,
  type PlayerState,
} from "../../src/shared/index.ts";

function player(
  id: string,
  seatIndex: number,
  options: Partial<PlayerState> = {},
): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id.toUpperCase(),
    seatIndex,
    avatarKey: `avatar-${seatIndex}`,
    cardCount: 2,
    eliminated: false,
    connected: true,
    isBot: false,
    ready: false,
    roundCards: [createCard("A", "S")],
    ...options,
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: "room-v2",
    code: "V2ROOM",
    phase: "Lobby",
    stateRevision: 3,
    socialRevision: 2,
    matchId: "room-v2:match:1",
    matchNumber: 1,
    hostPlayerId: "p1",
    players: [
      player("p1", 0),
      player("p2", 1),
      player("bot", 2, { isBot: true, ready: true }),
    ],
    playerCredentials: [],
    roundNumber: 0,
    roundParticipantIds: [],
    claimHistory: [],
    turnDurationMs: 0,
    leaveReceipts: [],
    reactions: [],
    ...overrides,
  };
}

test("ready changes are lobby-only and do not stale gameplay actions", () => {
  const result = setPlayerReady(state(), { playerId: "p1", ready: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.players[0].ready, true);
  assert.equal(result.state.stateRevision, 3);
  assert.equal(result.state.socialRevision, 3);

  const rejected = setPlayerReady(state({ phase: "RoundActive" }), {
    playerId: "p1",
    ready: true,
  });
  assert.equal(rejected.ok, false);
});

test("reactions are bounded, idempotent, and use social revision", () => {
  let current = state();
  for (let index = 0; index < 24; index += 1) {
    const result = sendReaction(current, {
      playerId: "p1",
      requestId: `reaction-${index}`,
      kind: "SUSPICIOUS",
      now: index,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    current = result.state;
  }
  assert.equal(current.reactions?.length, 20);
  assert.equal(current.stateRevision, 3);
  assert.equal(current.socialRevision, 26);

  const repeated = sendReaction(current, {
    playerId: "p1",
    requestId: "reaction-23",
    kind: "SUSPICIOUS",
    now: 100,
  });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.state.socialRevision, 26);
});

test("an eliminated host can end an active game", () => {
  const current = state({
    phase: "RoundActive",
    players: [player("p1", 0, { eliminated: true }), player("p2", 1)],
    currentTurnPlayerId: "p2",
    currentTurnId: "turn-p2",
    currentClaim: {
      id: "claim-1",
      handType: "HIGH_CARD",
      primaryRank: "A",
      playerId: "p2",
      sequence: 1,
    },
    activeClaimWindow: {
      id: "window-1",
      claimId: "claim-1",
      roundNumber: 1,
      openedByClaimSequence: 1,
      status: "OPEN",
      openedAt: 100,
    },
    turnStartedAt: 100,
  });
  const result = endGame(current, {
    playerId: "p1",
    requestId: "end-1",
    matchId: current.matchId!,
    now: 500,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.phase, "GameOver");
  assert.equal(result.state.matchEndedReason, "HOST_ENDED");
  assert.equal(result.state.winnerPlayerId, undefined);
  assert.equal(result.state.currentTurnPlayerId, undefined);
  assert.equal(result.state.currentClaim, undefined);
  assert.equal(result.state.activeClaimWindow, undefined);
  assert.equal(result.state.turnStartedAt, undefined);
});

test("rematch creates a fresh match and omits seats that deliberately left", () => {
  const left = player("p2", 1, {
    connected: false,
    leftAt: 400,
    departure: {
      matchId: "room-v2:match:1",
      requestId: "leave-p2",
      leftAt: 400,
      reason: "VOLUNTARY",
    },
  });
  const current = state({
    phase: "GameOver",
    players: [
      player("p1", 0, { eliminated: true }),
      left,
      player("bot", 2, { isBot: true }),
    ],
    winnerPlayerId: "bot",
    matchEndedReason: "LAST_PLAYER_STANDING",
  });
  const result = startRematch(current, {
    playerId: "p1",
    requestId: "rematch-1",
    matchId: current.matchId!,
    now: 800,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.phase, "Lobby");
  assert.equal(result.state.matchId, "room-v2:match:2");
  assert.deepEqual(
    result.state.players.map(({ id }) => id),
    ["p1", "bot"],
  );
  assert.equal(result.state.players[0].eliminated, false);
  assert.equal(result.state.players[0].ready, false);
  assert.equal(result.state.players[1].ready, true);
  assert.equal(result.state.winnerPlayerId, undefined);
});
