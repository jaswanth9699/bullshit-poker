import assert from "node:assert/strict";
import test from "node:test";

import {
  decideBotAction,
  estimateClaimTruthForBot,
  createCard,
  type Claim,
  type GameState,
  type PlayerState
} from "../../src/shared/index.ts";

function player(
  id: string,
  seatIndex: number,
  cards: PlayerState["roundCards"],
  options: Partial<PlayerState> = {}
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
    ...options
  };
}

function stateWithBot(params: {
  botCards: PlayerState["roundCards"];
  otherCards?: PlayerState["roundCards"];
  currentClaim?: Claim;
  currentTurnPlayerId?: string;
}): GameState {
  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "RoundActive",
    stateRevision: 4,
    hostPlayerId: "human",
    players: [
      player("human", 0, params.otherCards ?? [createCard("2", "D")]),
      player("bot", 1, params.botCards, { isBot: true })
    ],
    roundNumber: 1,
    startingPlayerId: "human",
    currentTurnPlayerId: params.currentTurnPlayerId ?? "bot",
    currentTurnId: "turn-bot",
    currentClaim: params.currentClaim,
    activeClaimWindow: params.currentClaim
      ? {
          id: "window-1",
          claimId: params.currentClaim.id ?? "claim-1",
          roundNumber: 1,
          openedByClaimSequence: params.currentClaim.sequence ?? 1,
          status: "OPEN",
          openedAt: 100
        }
      : undefined,
    claimHistory: params.currentClaim ? [params.currentClaim] : [],
    turnStartedAt: 100,
    turnExpiresAt: 120100,
    turnDurationMs: 120000
  };
}

test("bot opens with the lowest truthful claim from its own hand", () => {
  const decision = decideBotAction(
    stateWithBot({
      botCards: [createCard("A", "S")]
    }),
    "bot"
  );

  assert.equal(decision.type, "SUBMIT_CLAIM");
  if (decision.type !== "SUBMIT_CLAIM") return;
  assert.equal(decision.reason, "OPEN_WITH_LOWEST_TRUTHFUL_CLAIM");
  assert.deepEqual(decision.claim, { handType: "HIGH_CARD", primaryRank: "A" });
  assert.equal(decision.estimatedTruth, 1);
});

test("bot raises with a truthful higher claim when it can prove one from its own cards", () => {
  const decision = decideBotAction(
    stateWithBot({
      botCards: [createCard("K", "H"), createCard("A", "S")],
      currentClaim: { id: "claim-1", handType: "HIGH_CARD", primaryRank: "K", playerId: "human", sequence: 1 }
    }),
    "bot"
  );

  assert.equal(decision.type, "SUBMIT_CLAIM");
  if (decision.type !== "SUBMIT_CLAIM") return;
  assert.equal(decision.reason, "RAISE_WITH_TRUTHFUL_CLAIM");
  assert.deepEqual(decision.claim, { handType: "HIGH_CARD", primaryRank: "A" });
});

test("bot raises instead of calling when a higher claim is provable", () => {
  const decision = decideBotAction(
    stateWithBot({
      botCards: [createCard("A", "S"), createCard("A", "H")],
      currentClaim: { id: "claim-1", handType: "PAIR", primaryRank: "K", playerId: "human", sequence: 1 },
      currentTurnPlayerId: "bot"
    }),
    "bot",
    { callBullshitAtOrBelow: 1, raiseBluffMinimumEstimate: 0.38, simulationSamples: 16 }
  );

  assert.equal(decision.type, "SUBMIT_CLAIM");
  if (decision.type !== "SUBMIT_CLAIM") return;
  assert.equal(decision.reason, "RAISE_WITH_TRUTHFUL_CLAIM");
  assert.deepEqual(decision.claim, { handType: "PAIR", primaryRank: "A" });
});

test("off-turn bot waits instead of sniping when it has a truthful future raise", () => {
  const decision = decideBotAction(
    stateWithBot({
      botCards: [createCard("A", "S"), createCard("A", "H")],
      currentClaim: { id: "claim-1", handType: "PAIR", primaryRank: "K", playerId: "human", sequence: 1 },
      currentTurnPlayerId: "human"
    }),
    "bot"
  );

  assert.equal(decision.type, "WAIT");
});

test("off-turn bot still calls a nearly impossible claim without a truthful future raise", () => {
  const decision = decideBotAction(
    stateWithBot({
      botCards: [createCard("2", "S")],
      currentClaim: { id: "claim-four", handType: "FOUR_OF_A_KIND", primaryRank: "A", playerId: "human", sequence: 1 },
      currentTurnPlayerId: "human"
    }),
    "bot"
  );

  assert.equal(decision.type, "CALL_BULLSHIT");
  if (decision.type !== "CALL_BULLSHIT") return;
  assert.equal(decision.reason, "CALL_LOW_CONFIDENCE_CLAIM");
  assert.equal(decision.targetClaimId, "claim-four");
});

test("bot calls BullShit when the current claim has very low support", () => {
  const decision = decideBotAction(
    stateWithBot({
      botCards: [createCard("2", "S")],
      currentClaim: { id: "claim-four", handType: "FOUR_OF_A_KIND", primaryRank: "A", playerId: "human", sequence: 1 },
      currentTurnPlayerId: "bot"
    }),
    "bot"
  );

  assert.equal(decision.type, "CALL_BULLSHIT");
  if (decision.type !== "CALL_BULLSHIT") return;
  assert.equal(decision.reason, "CALL_LOW_CONFIDENCE_CLAIM");
  assert.equal(decision.targetClaimId, "claim-four");
});

test("bot must call when there is no legal higher claim", () => {
  const decision = decideBotAction(
    stateWithBot({
      botCards: [createCard("A", "H")],
      currentClaim: { id: "claim-top", handType: "ROYAL_FLUSH", suit: "S", playerId: "human", sequence: 1 }
    }),
    "bot",
    { callBullshitAtOrBelow: 0, raiseBluffMinimumEstimate: 0 }
  );

  assert.equal(decision.type, "CALL_BULLSHIT");
  if (decision.type !== "CALL_BULLSHIT") return;
  assert.equal(decision.reason, "CALL_NO_LEGAL_RAISE");
});

test("bot estimate increases when its own hand supports the claim", () => {
  const claim: Claim = { handType: "PAIR", primaryRank: "A" };

  assert.equal(estimateClaimTruthForBot(claim, [createCard("A", "S"), createCard("A", "H")]), 1);
  assert.ok(estimateClaimTruthForBot(claim, [createCard("A", "S")]) > estimateClaimTruthForBot(claim, [createCard("2", "S")]));
});

test("bot decision does not change when only opponent hidden cards change", () => {
  const currentClaim: Claim = { id: "claim-1", handType: "PAIR", primaryRank: "K", playerId: "human", sequence: 1 };
  const decisionA = decideBotAction(
    stateWithBot({
      botCards: [createCard("A", "S")],
      otherCards: [createCard("K", "S"), createCard("K", "H")],
      currentClaim
    }),
    "bot"
  );
  const decisionB = decideBotAction(
    stateWithBot({
      botCards: [createCard("A", "S")],
      otherCards: [createCard("2", "S"), createCard("3", "H")],
      currentClaim
    }),
    "bot"
  );

  assert.deepEqual(decisionA, decisionB);
});
