import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCallBullshit,
  applySubmitClaim,
  applyTimeout,
  createCard,
  type ClientActionEnvelope,
  type GameState,
  type PlayerState,
  type SubmitClaimPayload,
  type CallBullshitPayload,
} from "../../src/shared/index.ts";

function player(
  id: string,
  seatIndex: number,
  cards: PlayerState["roundCards"],
): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id,
    seatIndex,
    avatarKey: id,
    cardCount: 1,
    eliminated: false,
    connected: true,
    isBot: false,
    roundCards: cards,
  };
}

function stateWithClaim(overrides: Partial<GameState> = {}): GameState {
  const currentClaim = {
    id: "claim-1",
    handType: "PAIR" as const,
    primaryRank: "K" as const,
    playerId: "A",
    sequence: 1,
  };

  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "RoundActive",
    stateRevision: 7,
    hostPlayerId: "A",
    players: [
      player("A", 0, [createCard("K", "S")]),
      player("B", 1, [createCard("A", "H")]),
      player("C", 2, [createCard("2", "D")]),
    ],
    roundNumber: 2,
    startingPlayerId: "A",
    currentTurnPlayerId: "B",
    currentTurnId: "turn-B-1",
    currentClaim,
    activeClaimWindow: {
      id: "window-1",
      claimId: "claim-1",
      roundNumber: 2,
      openedByClaimSequence: 1,
      status: "OPEN",
      openedAt: 100,
    },
    claimHistory: [currentClaim],
    turnStartedAt: 100,
    turnExpiresAt: 120100,
    turnDurationMs: 120000,
    ...overrides,
  };
}

function submitEnvelope(
  state: GameState,
  playerId: string,
  payload: SubmitClaimPayload,
  overrides: Partial<ClientActionEnvelope<SubmitClaimPayload>> = {},
): ClientActionEnvelope<SubmitClaimPayload> {
  return {
    requestId: `req-${playerId}`,
    roomId: state.roomId,
    playerId,
    stateRevision: state.stateRevision,
    turnId: state.currentTurnId,
    claimWindowId: state.activeClaimWindow?.id,
    payload,
    ...overrides,
  };
}

function callEnvelope(
  state: GameState,
  playerId: string,
  overrides: Partial<ClientActionEnvelope<CallBullshitPayload>> = {},
): ClientActionEnvelope<CallBullshitPayload> {
  return {
    requestId: `call-${playerId}`,
    roomId: state.roomId,
    playerId,
    stateRevision: state.stateRevision,
    claimWindowId: state.activeClaimWindow?.id,
    payload: {},
    ...overrides,
  };
}

test("submit claim advances turn, opens new claim window, and resets 120s timer", () => {
  const state = stateWithClaim();
  const result = applySubmitClaim(
    state,
    submitEnvelope(state, "B", {
      claim: { handType: "PAIR", primaryRank: "A" },
    }),
    1_000,
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.state.currentClaim?.playerId, "B");
  assert.equal(result.ok && result.state.currentTurnPlayerId, "C");
  assert.equal(result.ok && result.state.activeClaimWindow?.status, "OPEN");
  assert.equal(result.ok && result.state.turnExpiresAt, 121_000);
  assert.equal(
    result.ok && result.state.stateRevision,
    state.stateRevision + 1,
  );
});

test("submit claim rejects stale state revision", () => {
  const state = stateWithClaim();
  const result = applySubmitClaim(
    state,
    submitEnvelope(
      state,
      "B",
      { claim: { handType: "PAIR", primaryRank: "A" } },
      { stateRevision: 6 },
    ),
    1_000,
  );

  assert.deepEqual(result, {
    ok: false,
    code: "STALE_STATE_REVISION",
    latestStateRevision: 7,
  });
});

test("submit claim rejects lower/equal claim", () => {
  const state = stateWithClaim();
  const result = applySubmitClaim(
    state,
    submitEnvelope(state, "B", {
      claim: { handType: "PAIR", primaryRank: "Q" },
    }),
    1_000,
  );

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "CLAIM_NOT_HIGHER");
});

test("next claim accepted first makes old BullShit call stale", () => {
  const state = stateWithClaim();
  const oldWindowId = state.activeClaimWindow!.id;
  const claimResult = applySubmitClaim(
    state,
    submitEnvelope(state, "B", {
      claim: { handType: "PAIR", primaryRank: "A" },
    }),
    1_000,
  );
  assert.equal(claimResult.ok, true);

  const nextState = claimResult.ok ? claimResult.state : state;
  const callResult = applyCallBullshit(
    nextState,
    callEnvelope(nextState, "C", { claimWindowId: oldWindowId }),
    1_010,
  );

  assert.equal(callResult.ok, false);
  assert.equal(!callResult.ok && callResult.code, "STALE_CLAIM_WINDOW");
});

test("BullShit call accepted first makes next claim stale through resolved round", () => {
  const state = stateWithClaim();
  const callResult = applyCallBullshit(state, callEnvelope(state, "C"), 1_000);
  assert.equal(callResult.ok, true);

  const resolvedState = callResult.ok ? callResult.state : state;
  const claimResult = applySubmitClaim(
    resolvedState,
    submitEnvelope(state, "B", {
      claim: { handType: "PAIR", primaryRank: "A" },
    }),
    1_010,
  );

  assert.equal(claimResult.ok, false);
  assert.equal(!claimResult.ok && claimResult.code, "ROUND_ALREADY_RESOLVED");
});

test("claimant cannot call BullShit on own claim", () => {
  const state = stateWithClaim();
  const result = applyCallBullshit(state, callEnvelope(state, "A"), 1_000);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "CLAIMANT_CANNOT_CALL");
});

test("final claim accepted first resolves round and rejects old BullShit call", () => {
  const state = stateWithClaim({
    currentTurnPlayerId: "A",
    currentTurnId: "turn-A-final",
    players: [
      player("A", 0, [createCard("A", "S")]),
      player("B", 1, [createCard("A", "H")]),
      player("C", 2, [createCard("2", "D")]),
    ],
  });
  const oldWindowId = state.activeClaimWindow!.id;

  const finalResult = applySubmitClaim(
    state,
    submitEnvelope(state, "A", {
      claim: { handType: "PAIR", primaryRank: "A" },
    }),
    1_000,
  );
  assert.equal(finalResult.ok, true);
  assert.equal(
    finalResult.ok && finalResult.roundResult?.reason,
    "FINAL_CLAIM",
  );

  const resolvedState = finalResult.ok ? finalResult.state : state;
  const callResult = applyCallBullshit(
    resolvedState,
    callEnvelope(resolvedState, "C", { claimWindowId: oldWindowId }),
    1_010,
  );

  assert.equal(callResult.ok, false);
  assert.equal(!callResult.ok && callResult.code, "ROUND_ALREADY_RESOLVED");
});

test("timeout accepted first resolves round and later action is stale", () => {
  const state = stateWithClaim({ turnExpiresAt: 1_000 });
  const timeoutResult = applyTimeout(state, state.currentTurnId!, 1_000);

  assert.equal(timeoutResult.ok, true);
  assert.equal(
    timeoutResult.ok && timeoutResult.roundResult?.reason,
    "TIMEOUT",
  );

  const resolvedState = timeoutResult.ok ? timeoutResult.state : state;
  const claimResult = applySubmitClaim(
    resolvedState,
    submitEnvelope(state, "B", {
      claim: { handType: "PAIR", primaryRank: "A" },
    }),
    1_001,
  );

  assert.equal(claimResult.ok, false);
  assert.equal(!claimResult.ok && claimResult.code, "ROUND_ALREADY_RESOLVED");
});

test("claim submitted at or after expiry is rejected as expired", () => {
  const state = stateWithClaim({ turnExpiresAt: 1_000 });
  const result = applySubmitClaim(
    state,
    submitEnvelope(state, "B", {
      claim: { handType: "PAIR", primaryRank: "A" },
    }),
    1_000,
  );

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "TURN_EXPIRED");
});

test("bullshit call at or after expiry is rejected so timeout can resolve first", () => {
  const state = stateWithClaim({ turnExpiresAt: 1_000 });
  const result = applyCallBullshit(state, callEnvelope(state, "C"), 1_000);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "TURN_EXPIRED");
});
