import { createDeck } from "../cards/deck.ts";
import { rankValue, type Card, type Rank } from "../cards/cardTypes.ts";
import { compareClaims } from "../claims/compareClaims.ts";
import { findClaimProof } from "../claims/evaluateClaim.ts";
import { getLegalClaimsAfter } from "../claims/legalClaims.ts";
import { HAND_CLASS_VALUE, type Claim, type HandType } from "../claims/claimTypes.ts";
import type { GameState, PlayerState } from "../game/gameTypes.ts";

export type BotDecisionReason =
  | "NOT_BOT"
  | "NOT_ACTIVE"
  | "NO_ACTION_AVAILABLE"
  | "OPEN_WITH_LOWEST_TRUTHFUL_CLAIM"
  | "RAISE_WITH_TRUTHFUL_CLAIM"
  | "RAISE_WITH_LOWEST_CONSERVATIVE_BLUFF"
  | "CALL_LOW_CONFIDENCE_CLAIM"
  | "CALL_NO_LEGAL_RAISE";

export type BotDecision =
  | {
      type: "WAIT";
      reason: BotDecisionReason;
    }
  | {
      type: "SUBMIT_CLAIM";
      reason: BotDecisionReason;
      claim: Claim;
      turnId: string;
      claimWindowId?: string;
      estimatedTruth: number;
    }
  | {
      type: "CALL_BULLSHIT";
      reason: BotDecisionReason;
      claimWindowId: string;
      targetClaimId: string;
      estimatedTruth: number;
    };

export type BotTuning = {
  callBullshitAtOrBelow: number;
  raiseBluffMinimumEstimate: number;
  simulationSamples?: number;
};

const DEFAULT_SIMULATION_SAMPLES = 128;

export const DEFAULT_BOT_TUNING: BotTuning = {
  callBullshitAtOrBelow: 0.28,
  raiseBluffMinimumEstimate: 0.38,
  simulationSamples: DEFAULT_SIMULATION_SAMPLES
};

const BASE_TRUTH_BY_HAND_TYPE: Record<HandType, number> = {
  HIGH_CARD: 0.62,
  PAIR: 0.42,
  TWO_PAIR: 0.24,
  THREE_OF_A_KIND: 0.2,
  STRAIGHT: 0.18,
  FLUSH: 0.16,
  FULL_HOUSE: 0.11,
  FOUR_OF_A_KIND: 0.05,
  STRAIGHT_FLUSH: 0.025,
  ROYAL_FLUSH: 0.01
};

function activePlayer(player: PlayerState | undefined): player is PlayerState {
  return Boolean(player && !player.eliminated && player.leftAt === undefined);
}

function rankCount(cards: readonly Card[], rank: Rank | undefined): number {
  if (!rank) return 0;
  return cards.filter((card) => card.rank === rank).length;
}

function straightRanks(highRank: Rank | undefined): Rank[] {
  if (!highRank) return [];
  if (highRank === "5") return ["A", "2", "3", "4", "5"];

  const highValue = rankValue(highRank);
  const ranksByValue = new Map<number, Rank>([
    [2, "2"],
    [3, "3"],
    [4, "4"],
    [5, "5"],
    [6, "6"],
    [7, "7"],
    [8, "8"],
    [9, "9"],
    [10, "10"],
    [11, "J"],
    [12, "Q"],
    [13, "K"],
    [14, "A"]
  ]);

  return [highValue - 4, highValue - 3, highValue - 2, highValue - 1, highValue]
    .map((value) => ranksByValue.get(value))
    .filter((rank): rank is Rank => Boolean(rank));
}

function straightCompletion(cards: readonly Card[], claim: Claim, suited: boolean): number {
  const ranks = straightRanks(claim.handType === "ROYAL_FLUSH" ? "A" : claim.primaryRank);
  if (ranks.length === 0) return 0;

  const matchingCards = suited && claim.suit
    ? cards.filter((card) => card.suit === claim.suit)
    : cards;
  const matchingRanks = new Set(matchingCards.map((card) => card.rank));
  const matchedCount = ranks.filter((rank) => matchingRanks.has(rank)).length;
  return matchedCount / 5;
}

function ownCompletion(claim: Claim, ownCards: readonly Card[]): number {
  if (findClaimProof(claim, ownCards)) {
    return 1;
  }

  switch (claim.handType) {
    case "HIGH_CARD":
      return rankCount(ownCards, claim.primaryRank) > 0 ? 1 : 0;

    case "PAIR":
      return Math.min(rankCount(ownCards, claim.primaryRank) / 2, 1);

    case "TWO_PAIR":
      return (
        Math.min(rankCount(ownCards, claim.primaryRank) / 2, 1) +
        Math.min(rankCount(ownCards, claim.secondaryRank) / 2, 1)
      ) / 2;

    case "THREE_OF_A_KIND":
      return Math.min(rankCount(ownCards, claim.primaryRank) / 3, 1);

    case "STRAIGHT":
      return straightCompletion(ownCards, claim, false);

    case "FLUSH": {
      if (!claim.suit) return 0;
      const suited = ownCards.filter((card) => card.suit === claim.suit);
      const hasHighCard = suited.some((card) => card.rank === claim.primaryRank);
      const lowerCount = suited.filter((card) => claim.primaryRank && rankValue(card.rank) < rankValue(claim.primaryRank)).length;
      return (hasHighCard ? 1 : 0) * 0.35 + Math.min(lowerCount / 4, 1) * 0.65;
    }

    case "FULL_HOUSE":
      return (
        Math.min(rankCount(ownCards, claim.primaryRank) / 3, 1) +
        Math.min(rankCount(ownCards, claim.secondaryRank) / 2, 1)
      ) / 2;

    case "FOUR_OF_A_KIND":
      return Math.min(rankCount(ownCards, claim.primaryRank) / 4, 1);

    case "STRAIGHT_FLUSH":
      return straightCompletion(ownCards, claim, true);

    case "ROYAL_FLUSH":
      return straightCompletion(ownCards, claim, true);
  }
}

export function estimateClaimTruthForBot(claim: Claim, ownCards: readonly Card[]): number {
  const completion = ownCompletion(claim, ownCards);
  if (completion >= 1) return 1;

  const base = BASE_TRUTH_BY_HAND_TYPE[claim.handType];
  const classPenalty = (HAND_CLASS_VALUE[claim.handType] - 1) * 0.01;
  return Math.max(0.01, Math.min(0.98, base + completion * 0.44 - classPenalty));
}

function activeTableCardCount(state: GameState): number {
  return state.players
    .filter((player) => !player.eliminated && player.leftAt === undefined)
    .reduce((sum, player) => sum + player.cardCount, 0);
}

function claimSeed(claim: Claim, ownCards: readonly Card[], sampleIndex: number): number {
  const source = [
    claim.handType,
    claim.primaryRank ?? "",
    claim.secondaryRank ?? "",
    claim.suit ?? "",
    ...ownCards.map((card) => card.id).sort(),
    String(sampleIndex)
  ].join("|");
  let seed = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    seed ^= source.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function deterministicSample(deck: readonly Card[], count: number, seed: number): Card[] {
  const copy = [...deck];
  let next = seed;

  for (let index = copy.length - 1; index > 0; index -= 1) {
    next = nextSeed(next);
    const swapIndex = next % (index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy.slice(0, count);
}

function estimateClaimTruthBySimulation(
  claim: Claim,
  ownCards: readonly Card[],
  totalTableCards: number,
  samples: number
): number {
  if (findClaimProof(claim, ownCards)) return 1;

  const unknownCount = Math.max(0, totalTableCards - ownCards.length);
  if (unknownCount === 0) {
    return 0;
  }

  const ownCardIds = new Set(ownCards.map((card) => card.id));
  const remainingDeck = createDeck().filter((card) => !ownCardIds.has(card.id));
  if (unknownCount > remainingDeck.length) {
    return 0;
  }

  let trueSamples = 0;
  const safeSamples = Math.max(1, samples);
  for (let sampleIndex = 0; sampleIndex < safeSamples; sampleIndex += 1) {
    const sampledCards = deterministicSample(remainingDeck, unknownCount, claimSeed(claim, ownCards, sampleIndex));
    if (findClaimProof(claim, [...ownCards, ...sampledCards])) {
      trueSamples += 1;
    }
  }

  return trueSamples / safeSamples;
}

function sortedClaims(claims: readonly Claim[]): Claim[] {
  return [...claims].sort(compareClaims);
}

function chooseConservativeBluff(
  legalClaims: readonly Claim[],
  ownCards: readonly Card[],
  totalTableCards: number,
  tuning: BotTuning
): { claim: Claim; estimate: number } | undefined {
  return sortedClaims(legalClaims)
    .map((claim) => ({
      claim,
      estimate: estimateClaimTruthBySimulation(
        claim,
        ownCards,
        totalTableCards,
        tuning.simulationSamples ?? DEFAULT_SIMULATION_SAMPLES
      )
    }))
    .find((candidate) => candidate.estimate >= tuning.raiseBluffMinimumEstimate);
}

function currentClaimCanBeCalled(state: GameState, bot: PlayerState): boolean {
  return Boolean(
    state.currentClaim &&
      state.currentClaim.playerId !== bot.id &&
      state.activeClaimWindow?.status === "OPEN"
  );
}

function rankPressure(claim: Claim): number {
  const rank = claim.primaryRank ? rankValue(claim.primaryRank) : 14;
  if (claim.handType === "FLUSH") {
    return (15 - rank) * 0.003;
  }
  if (claim.handType === "STRAIGHT" || claim.handType === "STRAIGHT_FLUSH") {
    return rank * 0.0025;
  }
  return rank * 0.002;
}

function chooseBestPressureClaim(
  legalClaims: readonly Claim[],
  ownCards: readonly Card[],
  totalTableCards: number,
  tuning: BotTuning
): { claim: Claim; estimate: number } | undefined {
  let best: { claim: Claim; estimate: number; score: number } | undefined;

  for (const claim of legalClaims) {
    const estimate = estimateClaimTruthBySimulation(
      claim,
      ownCards,
      totalTableCards,
      tuning.simulationSamples ?? DEFAULT_SIMULATION_SAMPLES
    );
    const score = estimate - HAND_CLASS_VALUE[claim.handType] * 0.03 - rankPressure(claim);
    if (!best || score > best.score || (score === best.score && compareClaims(claim, best.claim) === -1)) {
      best = { claim, estimate, score };
    }
  }

  return best ? { claim: best.claim, estimate: best.estimate } : undefined;
}

export function decideBotAction(
  state: GameState,
  botPlayerId: string,
  tuning: BotTuning = DEFAULT_BOT_TUNING
): BotDecision {
  const bot = state.players.find((player) => player.id === botPlayerId);
  if (!bot?.isBot) {
    return { type: "WAIT", reason: "NOT_BOT" };
  }
  if (!activePlayer(bot) || state.phase !== "RoundActive") {
    return { type: "WAIT", reason: "NOT_ACTIVE" };
  }

  const currentClaim = state.currentClaim;
  const canCall = currentClaimCanBeCalled(state, bot);
  const totalTableCards = activeTableCardCount(state);
  const claimEstimate = currentClaim
    ? estimateClaimTruthBySimulation(
        currentClaim,
        bot.roundCards,
        totalTableCards,
        tuning.simulationSamples ?? DEFAULT_SIMULATION_SAMPLES
      )
    : 1;
  const riskFactor = Math.min(1, Math.max(0, (bot.cardCount - 1) / 4));
  const callThreshold = Math.max(0.12, tuning.callBullshitAtOrBelow - riskFactor * 0.08);

  const legalClaims = state.currentTurnPlayerId === bot.id && state.currentTurnId
    ? getLegalClaimsAfter(currentClaim)
    : [];

  if (canCall && state.currentTurnPlayerId === bot.id && legalClaims.length === 0) {
    return {
      type: "CALL_BULLSHIT",
      reason: "CALL_NO_LEGAL_RAISE",
      claimWindowId: state.activeClaimWindow!.id,
      targetClaimId: currentClaim!.id!,
      estimatedTruth: claimEstimate
    };
  }

  if (canCall && claimEstimate < callThreshold) {
    return {
      type: "CALL_BULLSHIT",
      reason: "CALL_LOW_CONFIDENCE_CLAIM",
      claimWindowId: state.activeClaimWindow!.id,
      targetClaimId: currentClaim!.id!,
      estimatedTruth: claimEstimate
    };
  }

  if (state.currentTurnPlayerId !== bot.id || !state.currentTurnId) {
    return { type: "WAIT", reason: "NO_ACTION_AVAILABLE" };
  }

  if (legalClaims.length === 0) {
    return { type: "WAIT", reason: "NO_ACTION_AVAILABLE" };
  }

  const bestPressureClaim = chooseBestPressureClaim(legalClaims, bot.roundCards, totalTableCards, tuning);
  if (bestPressureClaim?.estimate === 1) {
    return {
      type: "SUBMIT_CLAIM",
      reason: currentClaim ? "RAISE_WITH_TRUTHFUL_CLAIM" : "OPEN_WITH_LOWEST_TRUTHFUL_CLAIM",
      claim: bestPressureClaim.claim,
      turnId: state.currentTurnId,
      claimWindowId: state.activeClaimWindow?.id,
      estimatedTruth: 1
    };
  }

  const safetyThreshold = tuning.raiseBluffMinimumEstimate + riskFactor * 0.08;
  if (canCall && claimEstimate < safetyThreshold && (!bestPressureClaim || bestPressureClaim.estimate < 0.18)) {
    return {
      type: "CALL_BULLSHIT",
      reason: "CALL_LOW_CONFIDENCE_CLAIM",
      claimWindowId: state.activeClaimWindow!.id,
      targetClaimId: currentClaim!.id!,
      estimatedTruth: claimEstimate
    };
  }

  const bluff = bestPressureClaim && bestPressureClaim.estimate >= safetyThreshold
    ? bestPressureClaim
    : chooseConservativeBluff(legalClaims, bot.roundCards, totalTableCards, tuning);
  if (bluff) {
    return {
      type: "SUBMIT_CLAIM",
      reason: "RAISE_WITH_LOWEST_CONSERVATIVE_BLUFF",
      claim: bluff.claim,
      turnId: state.currentTurnId,
      claimWindowId: state.activeClaimWindow?.id,
      estimatedTruth: bluff.estimate
    };
  }

  if (canCall) {
    return {
      type: "CALL_BULLSHIT",
      reason: "CALL_LOW_CONFIDENCE_CLAIM",
      claimWindowId: state.activeClaimWindow!.id,
      targetClaimId: currentClaim!.id!,
      estimatedTruth: claimEstimate
    };
  }

  return { type: "WAIT", reason: "NO_ACTION_AVAILABLE" };
}
