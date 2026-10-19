import assert from "node:assert/strict";
import test from "node:test";

import {
  createCard,
  leaveGame,
  resolveBullshitCall,
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
    cardCount: 1,
    eliminated: false,
    connected: true,
    isBot: false,
    ready: true,
    roundCards: [
      createCard(String(seatIndex + 2) as "2" | "3" | "4" | "5", "S"),
    ],
    ...options,
  };
}

function activeState(overrides: Partial<GameState> = {}): GameState {
  const players = [player("p1", 0), player("p2", 1), player("p3", 2)];
  return {
    roomId: "room-v2",
    code: "V2ROOM",
    phase: "RoundActive",
    stateRevision: 7,
    matchId: "room-v2:match:1",
    hostPlayerId: "p1",
    players,
    roundNumber: 2,
    roundParticipantIds: players.map(({ id }) => id),
    startingPlayerId: "p1",
    finalDecisionPlayerId: "p1",
    currentTurnPlayerId: "p1",
    currentTurnId: "turn-p1",
    claimHistory: [],
    turnDurationMs: 0,
    leaveReceipts: [],
    ...overrides,
  };
}

function leave(state: GameState, playerId = "p1", requestId = "leave-1") {
  return leaveGame(state, {
    playerId,
    requestId,
    matchId: state.matchId!,
    now: 1_000,
  });
}

test("current player leave advances turn, final anchor, and host clockwise", () => {
  const result = leave(activeState());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.state.currentTurnPlayerId, "p2");
  assert.equal(result.state.finalDecisionPlayerId, "p2");
  assert.equal(result.state.hostPlayerId, "p2");
  assert.equal(result.state.players[0].leftAt, 1_000);
  assert.equal(result.state.players[0].departure?.reason, "VOLUNTARY");
  assert.deepEqual(result.state.roundParticipantIds, ["p1", "p2", "p3"]);
});

test("non-current leave preserves the current turn", () => {
  const result = leave(activeState(), "p3");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.currentTurnPlayerId, "p1");
  assert.equal(result.state.currentTurnId, "turn-p1");
});

test("leave is idempotent for a repeated request and for a new request", () => {
  const first = leave(activeState());
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const repeated = leave(first.state);
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.state.stateRevision, first.state.stateRevision);
  assert.equal(repeated.state.leaveReceipts?.length, 1);

  const retriedWithNewId = leave(first.state, "p1", "leave-2");
  assert.equal(retriedWithNewId.ok, true);
  if (!retriedWithNewId.ok) return;
  assert.equal(retriedWithNewId.state.stateRevision, first.state.stateRevision);
});

test("request IDs cannot be reused across players", () => {
  const first = leave(activeState());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const collision = leave(first.state, "p2", "leave-1");
  assert.deepEqual(collision, {
    ok: false,
    code: "REQUEST_ID_REUSED",
    latestStateRevision: 8,
  });
});

test("leave from an old match cannot affect a rematch", () => {
  const state = activeState({
    matchId: "room-v2:match:2",
    leaveReceipts: [
      {
        requestId: "leave-1",
        playerId: "p1",
        matchId: "room-v2:match:1",
        acceptedAt: 500,
        resultingStateRevision: 4,
      },
    ],
  });
  const result = leaveGame(state, {
    playerId: "p1",
    requestId: "leave-1",
    matchId: "room-v2:match:1",
    now: 1_000,
  });
  assert.deepEqual(result, {
    ok: false,
    code: "MATCH_CHANGED",
    latestStateRevision: 7,
  });
});

test("last active seat wins when another active player leaves", () => {
  const state = activeState({ players: [player("p1", 0), player("p2", 1)] });
  const result = leave(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.phase, "GameOver");
  assert.equal(result.state.winnerPlayerId, "p2");
  assert.equal(result.state.matchEndedReason, "LAST_PLAYER_STANDING");
  assert.equal(result.state.currentTurnPlayerId, undefined);
  assert.equal(result.state.currentTurnId, undefined);
  assert.equal(result.state.currentClaim, undefined);
  assert.equal(result.state.activeClaimWindow, undefined);
  assert.equal(result.state.turnStartedAt, undefined);
  assert.equal(result.state.turnExpiresAt, undefined);
});

test("leave after game over preserves the original winner and ending metadata", () => {
  const state = activeState({
    phase: "GameOver",
    winnerPlayerId: "p1",
    matchEndedReason: "LAST_PLAYER_STANDING",
    endedAt: 700,
    currentTurnPlayerId: undefined,
    currentTurnId: undefined,
  });

  const result = leave(state, "p2");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.state.phase, "GameOver");
  assert.equal(result.state.winnerPlayerId, "p1");
  assert.equal(result.state.matchEndedReason, "LAST_PLAYER_STANDING");
  assert.equal(result.state.endedAt, 700);
});

test("last human leave abandons the room even when bots remain", () => {
  const state = activeState({
    players: [player("p1", 0), player("bot", 1, { isBot: true })],
  });
  const result = leave(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.phase, "Abandoned");
  assert.equal(result.state.winnerPlayerId, undefined);
  assert.equal(result.state.matchEndedReason, "ABANDONED");
});

test("lobby leave transfers host without fabricating a winner", () => {
  const state = activeState({
    phase: "Lobby",
    currentTurnPlayerId: undefined,
    currentTurnId: undefined,
  });
  const result = leave(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.phase, "Lobby");
  assert.equal(result.state.hostPlayerId, "p2");
  assert.equal(result.state.winnerPlayerId, undefined);
});

test("a departed claimant's frozen cards still decide claim truth", () => {
  const state = activeState({
    currentTurnPlayerId: "p2",
    currentTurnId: "turn-p2",
    currentClaim: {
      id: "claim-1",
      handType: "HIGH_CARD",
      primaryRank: "2",
      playerId: "p1",
      sequence: 1,
      createdAt: 100,
    },
    activeClaimWindow: {
      id: "window-1",
      claimId: "claim-1",
      roundNumber: 2,
      openedByClaimSequence: 1,
      status: "OPEN",
      openedAt: 100,
    },
    claimHistory: [],
  });
  const departed = leave(state);
  assert.equal(departed.ok, true);
  if (!departed.ok) return;

  const resolution = resolveBullshitCall(departed.state, "p2", 2_000);
  assert.equal(resolution.roundResult.claimWasTrue, true);
  assert.equal(resolution.roundResult.penaltyPlayerId, "p2");
  assert.equal(
    resolution.roundResult.revealedHands.some(
      ({ playerId }) => playerId === "p1",
    ),
    true,
  );
});
