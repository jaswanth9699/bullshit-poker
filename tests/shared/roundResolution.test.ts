import assert from "node:assert/strict";
import test from "node:test";

import {
  createCard,
  resolveBullshitCall,
  resolveFinalClaim,
  type GameState,
  type PlayerState,
} from "../../src/shared/index.ts";

function player(
  id: string,
  seatIndex: number,
  roundCards: PlayerState["roundCards"],
  cardCount = 1,
): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id,
    seatIndex,
    avatarKey: id,
    cardCount,
    eliminated: false,
    connected: true,
    isBot: false,
    roundCards,
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  const players = [
    player("A", 0, [createCard("A", "S")]),
    player("B", 1, [createCard("K", "H")]),
    player("C", 2, [createCard("2", "D")]),
  ];

  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "RoundActive",
    stateRevision: 1,
    hostPlayerId: "A",
    players,
    roundNumber: 3,
    startingPlayerId: "A",
    currentTurnPlayerId: "B",
    currentTurnId: "turn-1",
    currentClaim: {
      id: "claim-1",
      handType: "PAIR",
      primaryRank: "K",
      playerId: "B",
      sequence: 1,
    },
    activeClaimWindow: {
      id: "window-1",
      claimId: "claim-1",
      roundNumber: 3,
      openedByClaimSequence: 1,
      status: "OPEN",
      openedAt: 100,
    },
    claimHistory: [],
    turnStartedAt: 100,
    turnExpiresAt: 220,
    turnDurationMs: 120000,
    ...overrides,
  };
}

test("false final claim penalizes final claimant and reveals cards", () => {
  const state = baseState({
    currentTurnPlayerId: "A",
    currentClaim: {
      id: "claim-1",
      handType: "PAIR",
      primaryRank: "K",
      playerId: "B",
      sequence: 1,
    },
  });

  const result = resolveFinalClaim(
    state,
    {
      id: "final-1",
      handType: "PAIR",
      primaryRank: "A",
      playerId: "A",
      sequence: 2,
    },
    500,
  );

  assert.equal(result.roundResult.reason, "FINAL_CLAIM");
  assert.equal(result.roundResult.claimWasTrue, false);
  assert.equal(result.roundResult.penaltyPlayerId, "A");
  assert.equal(
    result.state.players.find((candidate) => candidate.id === "A")?.cardCount,
    2,
  );
  assert.equal(result.roundResult.revealedHands.length, 3);
  assert.equal(result.roundResult.nextStartingPlayerId, "B");
});

test("true final claim ends round with no penalty", () => {
  const state = baseState({
    currentTurnPlayerId: "A",
    players: [
      player("A", 0, [createCard("A", "S")]),
      player("B", 1, [createCard("A", "H")]),
      player("C", 2, [createCard("2", "D")]),
    ],
    currentClaim: {
      id: "claim-1",
      handType: "PAIR",
      primaryRank: "K",
      playerId: "B",
      sequence: 1,
    },
  });

  const result = resolveFinalClaim(
    state,
    {
      id: "final-1",
      handType: "PAIR",
      primaryRank: "A",
      playerId: "A",
      sequence: 2,
    },
    500,
  );

  assert.equal(result.roundResult.claimWasTrue, true);
  assert.equal(result.roundResult.penaltyPlayerId, undefined);
  assert.equal(result.roundResult.noPenaltyReason, "TRUE_FINAL_CLAIM");
  assert.deepEqual(
    result.state.players.map((candidate) => candidate.cardCount),
    [1, 1, 1],
  );
  assert.equal(result.roundResult.nextStartingPlayerId, "B");
});

test("final claim must be strictly higher than current claim", () => {
  const state = baseState({ currentTurnPlayerId: "A" });

  assert.throws(
    () =>
      resolveFinalClaim(
        state,
        { id: "final-1", handType: "PAIR", primaryRank: "Q", playerId: "A" },
        500,
      ),
    /strictly higher/,
  );
});

test("incorrect BullShit call penalizes caller when claim is true", () => {
  const state = baseState({
    players: [
      player("A", 0, [createCard("A", "S")]),
      player("B", 1, [createCard("K", "H")]),
      player("C", 2, [createCard("K", "D")]),
    ],
  });

  const result = resolveBullshitCall(state, "C", 500);

  assert.equal(result.roundResult.claimWasTrue, true);
  assert.equal(result.roundResult.penaltyPlayerId, "C");
  assert.equal(
    result.state.players.find((candidate) => candidate.id === "C")?.cardCount,
    2,
  );
});

test("correct BullShit call penalizes claimant when claim is false", () => {
  const result = resolveBullshitCall(baseState(), "C", 500);

  assert.equal(result.roundResult.claimWasTrue, false);
  assert.equal(result.roundResult.penaltyPlayerId, "B");
  assert.equal(
    result.state.players.find((candidate) => candidate.id === "B")?.cardCount,
    2,
  );
});

test("last active player wins immediately when a penalty eliminates everyone else", () => {
  const state = baseState({
    players: [
      player("A", 0, [createCard("A", "S")]),
      player("B", 1, [createCard("K", "H")], 5),
    ],
    currentClaim: {
      id: "claim-1",
      handType: "PAIR",
      primaryRank: "K",
      playerId: "B",
      sequence: 1,
    },
  });

  const result = resolveBullshitCall(state, "A", 500);

  assert.equal(result.state.phase, "GameOver");
  assert.equal(result.state.winnerPlayerId, "A");
  assert.equal(result.roundResult.penaltyPlayerId, "B");
  assert.deepEqual(result.roundResult.eliminatedPlayerIds, ["B"]);
  assert.equal(result.roundResult.nextStartingPlayerId, undefined);
});
