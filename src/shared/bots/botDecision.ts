import { createDeck } from "../cards/deck.ts";
import { rankValue, type Card, type Rank } from "../cards/cardTypes.ts";
import { compareClaims, normalizeClaimShape } from "../claims/compareClaims.ts";
import { findClaimProof } from "../claims/evaluateClaim.ts";
import {
  getAllLegalClaimTemplates,
  getLegalClaimsAfter,
} from "../claims/legalClaims.ts";
import {
  HAND_CLASS_VALUE,
  type Claim,
  type HandType,
} from "../claims/claimTypes.ts";
import type { GameState, PlayerState } from "../game/gameTypes.ts";

export type BotDecisionReason =
  | "NOT_BOT"
  | "NOT_ACTIVE"
  | "NO_ACTION_AVAILABLE"
  | "OPEN_WITH_LOWEST_TRUTHFUL_CLAIM"
  | "OPEN_WITH_STRONG_TRUTHFUL_CLAIM"
  | "RAISE_WITH_TRUTHFUL_CLAIM"
  | "RAISE_WITH_STRONG_TRUTHFUL_CLAIM"
  | "RAISE_WITH_LOWEST_CONSERVATIVE_BLUFF"
  | "RAISE_WITH_PRESSURE_BLUFF"
  | "RAISE_WITH_WILD_BLUFF"
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
  strategyOverride?: Partial<BotStrategyBlend>;
};

export type BotStrategyBlend = {
  aggression: number;
  deception: number;
  trap: number;
  skepticism: number;
  opportunism: number;
  chaos: number;
  survival: number;
  pressure: number;
};

const DEFAULT_SIMULATION_SAMPLES = 128;
const OFF_TURN_CALL_THRESHOLD_DISCOUNT = 0.14;

export const DEFAULT_BOT_TUNING: BotTuning = {
  callBullshitAtOrBelow: 0.28,
  raiseBluffMinimumEstimate: 0.38,
  simulationSamples: DEFAULT_SIMULATION_SAMPLES,
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
  ROYAL_FLUSH: 0.01,
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
    [14, "A"],
  ]);

  return [highValue - 4, highValue - 3, highValue - 2, highValue - 1, highValue]
    .map((value) => ranksByValue.get(value))
    .filter((rank): rank is Rank => Boolean(rank));
}

function straightCompletion(
  cards: readonly Card[],
  claim: Claim,
  suited: boolean,
): number {
  const ranks = straightRanks(
    claim.handType === "ROYAL_FLUSH" ? "A" : claim.primaryRank,
  );
  if (ranks.length === 0) return 0;

  const matchingCards =
    suited && claim.suit
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
        (Math.min(rankCount(ownCards, claim.primaryRank) / 2, 1) +
          Math.min(rankCount(ownCards, claim.secondaryRank) / 2, 1)) /
        2
      );

    case "THREE_OF_A_KIND":
      return Math.min(rankCount(ownCards, claim.primaryRank) / 3, 1);

    case "STRAIGHT":
      return straightCompletion(ownCards, claim, false);

    case "FLUSH": {
      if (!claim.suit) return 0;
      const suited = ownCards.filter((card) => card.suit === claim.suit);
      const hasHighCard = suited.some(
        (card) => card.rank === claim.primaryRank,
      );
      const lowerCount = suited.filter(
        (card) =>
          claim.primaryRank &&
          rankValue(card.rank) < rankValue(claim.primaryRank),
      ).length;
      return (hasHighCard ? 1 : 0) * 0.35 + Math.min(lowerCount / 4, 1) * 0.65;
    }

    case "FULL_HOUSE":
      return (
        (Math.min(rankCount(ownCards, claim.primaryRank) / 3, 1) +
          Math.min(rankCount(ownCards, claim.secondaryRank) / 2, 1)) /
        2
      );

    case "FOUR_OF_A_KIND":
      return Math.min(rankCount(ownCards, claim.primaryRank) / 4, 1);

    case "STRAIGHT_FLUSH":
      return straightCompletion(ownCards, claim, true);

    case "ROYAL_FLUSH":
      return straightCompletion(ownCards, claim, true);
  }
}

export function estimateClaimTruthForBot(
  claim: Claim,
  ownCards: readonly Card[],
): number {
  const completion = ownCompletion(claim, ownCards);
  if (completion >= 1) return 1;

  const base = BASE_TRUTH_BY_HAND_TYPE[claim.handType];
  const classPenalty = (HAND_CLASS_VALUE[claim.handType] - 1) * 0.01;
  return Math.max(
    0.01,
    Math.min(0.98, base + completion * 0.44 - classPenalty),
  );
}

function activeTableCardCount(state: GameState): number {
  return state.players
    .filter((player) => !player.eliminated && player.leftAt === undefined)
    .reduce((sum, player) => sum + player.cardCount, 0);
}

function claimSeed(
  claim: Claim,
  ownCards: readonly Card[],
  sampleIndex: number,
): number {
  const source = [
    claim.handType,
    claim.primaryRank ?? "",
    claim.secondaryRank ?? "",
    claim.suit ?? "",
    ...ownCards.map((card) => card.id).sort(),
    String(sampleIndex),
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

function deterministicSample(
  deck: readonly Card[],
  count: number,
  seed: number,
): Card[] {
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
  samples: number,
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
    const sampledCards = deterministicSample(
      remainingDeck,
      unknownCount,
      claimSeed(claim, ownCards, sampleIndex),
    );
    if (findClaimProof(claim, [...ownCards, ...sampledCards])) {
      trueSamples += 1;
    }
  }

  return trueSamples / safeSamples;
}

function sortedClaims(claims: readonly Claim[]): Claim[] {
  return [...claims].sort(compareClaims);
}

function currentClaimCanBeCalled(state: GameState, bot: PlayerState): boolean {
  return Boolean(
    state.currentClaim &&
    state.currentClaim.playerId !== bot.id &&
    state.activeClaimWindow?.status === "OPEN",
  );
}

function claimKey(claim: Claim): string {
  const normalized = normalizeClaimShape(claim);
  return [
    normalized.handType,
    normalized.primaryRank ?? "",
    normalized.secondaryRank ?? "",
    normalized.suit ?? "",
  ].join(":");
}

const ALL_CLAIMS_BY_STRENGTH = sortedClaims(getAllLegalClaimTemplates());
const CLAIM_STRENGTH_BY_KEY = new Map(
  ALL_CLAIMS_BY_STRENGTH.map((claim, index) => [
    claimKey(claim),
    index / Math.max(1, ALL_CLAIMS_BY_STRENGTH.length - 1),
  ]),
);
const CLAIM_RESPONSE_SCARCITY_BY_KEY = new Map<string, number>();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function claimStrength(claim: Claim): number {
  const key = claimKey(claim);
  const cached = CLAIM_STRENGTH_BY_KEY.get(key);
  if (cached !== undefined) return cached;

  const index = ALL_CLAIMS_BY_STRENGTH.findIndex(
    (candidate) => compareClaims(candidate, claim) === 0,
  );
  return index < 0 ? 0 : index / Math.max(1, ALL_CLAIMS_BY_STRENGTH.length - 1);
}

function claimResponseScarcity(claim: Claim): number {
  const key = claimKey(claim);
  const cached = CLAIM_RESPONSE_SCARCITY_BY_KEY.get(key);
  if (cached !== undefined) return cached;

  const scarcity =
    1 -
    getLegalClaimsAfter(claim).length /
      Math.max(1, ALL_CLAIMS_BY_STRENGTH.length);
  CLAIM_RESPONSE_SCARCITY_BY_KEY.set(key, scarcity);
  return scarcity;
}

function normalizedRankPower(rank: Rank | undefined, reversed = false): number {
  if (!rank) return 1;
  const power = (rankValue(rank) - 2) / 12;
  return reversed ? 1 - power : power;
}

function claimLocalPower(claim: Claim): number {
  const normalized = normalizeClaimShape(claim);
  const primary = normalizedRankPower(
    normalized.primaryRank,
    normalized.handType === "FLUSH",
  );
  const secondary = normalizedRankPower(normalized.secondaryRank);

  switch (normalized.handType) {
    case "HIGH_CARD":
    case "PAIR":
    case "THREE_OF_A_KIND":
    case "STRAIGHT":
    case "FLUSH":
    case "FOUR_OF_A_KIND":
    case "STRAIGHT_FLUSH":
      return primary;

    case "TWO_PAIR":
    case "FULL_HOUSE":
      return primary * 0.72 + secondary * 0.28;

    case "ROYAL_FLUSH":
      return 1;
  }
}

function hashString(source: string): number {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitHash(source: string, salt: string): number {
  return hashString(`${source}|${salt}`) / 2 ** 32;
}

function activePlayersBySeat(players: readonly PlayerState[]): PlayerState[] {
  return players
    .filter((player) => !player.eliminated && player.leftAt === undefined)
    .sort((left, right) => left.seatIndex - right.seatIndex);
}

function playerVulnerability(player: PlayerState | undefined): number {
  if (!player || player.eliminated || player.leftAt !== undefined) return 0;
  return clamp01((player.cardCount - 1) / 4);
}

function nextActivePlayerAfter(
  state: GameState,
  playerId: string,
): PlayerState | undefined {
  const active = activePlayersBySeat(state.players);
  if (active.length === 0) return undefined;

  const index = active.findIndex((player) => player.id === playerId);
  if (index < 0) return undefined;
  return active[(index + 1) % active.length];
}

function publicStateSignature(state: GameState, bot: PlayerState): string {
  const publicPlayers = state.players
    .map((player) =>
      [
        player.id,
        player.seatIndex,
        player.cardCount,
        player.eliminated ? "out" : "in",
        player.leftAt === undefined ? "seated" : "left",
        player.connected ? "online" : "offline",
        player.isBot ? "bot" : "human",
      ].join(":"),
    )
    .join(",");
  const claims = state.claimHistory.map(claimKey).join(",");
  const lastRound = state.lastRoundResult
    ? [
        state.lastRoundResult.reason,
        state.lastRoundResult.claim
          ? claimKey(state.lastRoundResult.claim)
          : "",
        state.lastRoundResult.callerPlayerId ?? "",
        state.lastRoundResult.claimantPlayerId ?? "",
        state.lastRoundResult.penaltyPlayerId ?? "",
        state.lastRoundResult.claimWasTrue === undefined
          ? ""
          : String(state.lastRoundResult.claimWasTrue),
        state.lastRoundResult.revealedHands
          .map(
            (hand) =>
              `${hand.playerId}:${hand.cards
                .map((card) => card.id)
                .sort()
                .join(".")}`,
          )
          .join(","),
      ].join("/")
    : "";

  return [
    state.roomId,
    state.code,
    state.phase,
    state.roundNumber,
    state.stateRevision,
    bot.id,
    bot.roundCards
      .map((card) => card.id)
      .sort()
      .join(","),
    state.currentClaim ? claimKey(state.currentClaim) : "",
    state.currentTurnPlayerId ?? "",
    state.startingPlayerId ?? "",
    publicPlayers,
    claims,
    lastRound,
  ].join("|");
}

function createStrategyBlend(
  state: GameState,
  bot: PlayerState,
  tuning: BotTuning,
): BotStrategyBlend {
  const signature = publicStateSignature(state, bot);
  const base = (salt: string, low = 0.2, high = 0.82) =>
    low + unitHash(signature, salt) * (high - low);
  const activeCount = Math.max(1, activePlayersBySeat(state.players).length);
  const claimDepth = clamp01(
    state.claimHistory.length / Math.max(2, activeCount),
  );
  const risk = playerVulnerability(bot);
  const wasPenalty = state.lastRoundResult?.penaltyPlayerId === bot.id ? 1 : 0;
  const gotCaughtBluffing =
    state.lastRoundResult?.claimantPlayerId === bot.id &&
    state.lastRoundResult.claimWasTrue === false
      ? 1
      : 0;
  const calledCorrectly =
    state.lastRoundResult?.callerPlayerId === bot.id &&
    state.lastRoundResult.claimWasTrue === false
      ? 1
      : 0;

  const blend: BotStrategyBlend = {
    aggression: clamp01(
      base("aggression") +
        claimDepth * 0.18 -
        risk * 0.1 +
        gotCaughtBluffing * 0.1,
    ),
    deception: clamp01(
      base("deception") + (1 - claimDepth) * 0.1 + wasPenalty * 0.08,
    ),
    trap: clamp01(
      base("trap") + (1 - claimDepth) * 0.18 + gotCaughtBluffing * 0.08,
    ),
    skepticism: clamp01(
      base("skepticism") + calledCorrectly * 0.16 + risk * 0.08,
    ),
    opportunism: clamp01(base("opportunism") + claimDepth * 0.12),
    chaos: clamp01(
      base("chaos", 0.04, 0.42) +
        (unitHash(signature, "chaos-spike") > 0.9 ? 0.42 : 0),
    ),
    survival: clamp01(base("survival", 0.18, 0.58) + risk * 0.48),
    pressure: clamp01(base("pressure") + claimDepth * 0.2),
  };

  if (!tuning.strategyOverride) return blend;
  return {
    aggression: clamp01(tuning.strategyOverride.aggression ?? blend.aggression),
    deception: clamp01(tuning.strategyOverride.deception ?? blend.deception),
    trap: clamp01(tuning.strategyOverride.trap ?? blend.trap),
    skepticism: clamp01(tuning.strategyOverride.skepticism ?? blend.skepticism),
    opportunism: clamp01(
      tuning.strategyOverride.opportunism ?? blend.opportunism,
    ),
    chaos: clamp01(tuning.strategyOverride.chaos ?? blend.chaos),
    survival: clamp01(tuning.strategyOverride.survival ?? blend.survival),
    pressure: clamp01(tuning.strategyOverride.pressure ?? blend.pressure),
  };
}

function addUniqueClaim(
  target: Map<string, Claim>,
  claim: Claim | undefined,
): void {
  if (!claim) return;
  target.set(claimKey(claim), claim);
}

function topByScore<T>(
  values: readonly T[],
  score: (value: T) => number,
  limit: number,
): T[] {
  return [...values]
    .sort((left, right) => score(right) - score(left))
    .slice(0, limit);
}

function strategicClaimPool(
  legalClaims: readonly Claim[],
  ownCards: readonly Card[],
): Claim[] {
  const candidates = new Map<string, Claim>();
  const sorted = sortedClaims(legalClaims);

  for (const claim of sorted.slice(0, 12)) addUniqueClaim(candidates, claim);

  const truthful = sorted.filter((claim) => findClaimProof(claim, ownCards));
  for (const claim of truthful) addUniqueClaim(candidates, claim);

  for (const claim of topByScore(
    sorted,
    (claim) => ownCompletion(claim, ownCards) * 10 + claimStrength(claim),
    24,
  )) {
    addUniqueClaim(candidates, claim);
  }

  for (const point of [0.18, 0.32, 0.48, 0.64, 0.78, 0.9, 0.98]) {
    addUniqueClaim(
      candidates,
      sorted[Math.floor(point * Math.max(0, sorted.length - 1))],
    );
  }

  const boldHandTypes: HandType[] = [
    "THREE_OF_A_KIND",
    "STRAIGHT",
    "FLUSH",
    "FULL_HOUSE",
    "FOUR_OF_A_KIND",
    "STRAIGHT_FLUSH",
    "ROYAL_FLUSH",
  ];
  for (const handType of boldHandTypes) {
    const claimsOfType = sorted.filter((claim) => claim.handType === handType);
    for (const claim of topByScore(
      claimsOfType,
      (candidate) =>
        ownCompletion(candidate, ownCards) * 8 + claimStrength(candidate),
      3,
    )) {
      addUniqueClaim(candidates, claim);
    }
  }

  return [...candidates.values()];
}

type ClaimIntent =
  | "TRUTHFUL"
  | "TRAP_UNDERCLAIM"
  | "SEMI_BLUFF"
  | "PRESSURE_BLUFF"
  | "WILD_BLUFF";

type ClaimActionCandidate = {
  type: "SUBMIT_CLAIM";
  reason: BotDecisionReason;
  claim: Claim;
  estimatedTruth: number;
  score: number;
  intent: ClaimIntent;
};

type CallActionCandidate = {
  type: "CALL_BULLSHIT";
  reason: BotDecisionReason;
  claimWindowId: string;
  targetClaimId: string;
  estimatedTruth: number;
  score: number;
};

type ActionCandidate = ClaimActionCandidate | CallActionCandidate;

function maxProvenClaimStrength(
  legalClaims: readonly Claim[],
  ownCards: readonly Card[],
): number {
  return legalClaims.reduce(
    (best, claim) =>
      findClaimProof(claim, ownCards)
        ? Math.max(best, claimStrength(claim))
        : best,
    0,
  );
}

function classifyClaimIntent(
  proven: boolean,
  support: number,
  estimate: number,
  blend: BotStrategyBlend,
): ClaimIntent {
  if (proven) return support >= 1 ? "TRUTHFUL" : "TRAP_UNDERCLAIM";
  if (support >= 0.42) return "SEMI_BLUFF";
  if (estimate >= 0.22 || blend.deception >= 0.68) return "PRESSURE_BLUFF";
  return "WILD_BLUFF";
}

function reasonForClaimIntent(
  intent: ClaimIntent,
  currentClaim: Claim | undefined,
): BotDecisionReason {
  if (intent === "TRUTHFUL" || intent === "TRAP_UNDERCLAIM") {
    return currentClaim
      ? "RAISE_WITH_STRONG_TRUTHFUL_CLAIM"
      : "OPEN_WITH_STRONG_TRUTHFUL_CLAIM";
  }
  if (intent === "WILD_BLUFF") return "RAISE_WITH_WILD_BLUFF";
  return "RAISE_WITH_PRESSURE_BLUFF";
}

function scoreClaimAction(params: {
  claim: Claim;
  state: GameState;
  bot: PlayerState;
  currentClaim?: Claim;
  totalTableCards: number;
  tuning: BotTuning;
  blend: BotStrategyBlend;
  maxTruthStrength: number;
  signature: string;
}): ClaimActionCandidate {
  const support = ownCompletion(params.claim, params.bot.roundCards);
  const proven = Boolean(findClaimProof(params.claim, params.bot.roundCards));
  const estimate = proven
    ? 1
    : estimateClaimTruthBySimulation(
        params.claim,
        params.bot.roundCards,
        params.totalTableCards,
        params.tuning.simulationSamples ?? DEFAULT_SIMULATION_SAMPLES,
      );
  const strength = claimStrength(params.claim);
  const currentStrength = params.currentClaim
    ? claimStrength(params.currentClaim)
    : 0;
  const jump = Math.max(0, strength - currentStrength);
  const handPower = (HAND_CLASS_VALUE[params.claim.handType] - 1) / 9;
  const localPower = claimLocalPower(params.claim);
  const scarcity = claimResponseScarcity(params.claim);
  const nextPlayer = nextActivePlayerAfter(params.state, params.bot.id);
  const nextVulnerability = playerVulnerability(nextPlayer);
  const botRisk = playerVulnerability(params.bot);
  const truthStrengthRatio =
    params.maxTruthStrength > 0
      ? clamp01(strength / params.maxTruthStrength)
      : 0;
  const intent = classifyClaimIntent(proven, support, estimate, params.blend);

  const truthScore = proven
    ? 0.82 +
      handPower * 0.62 +
      strength * (0.42 + params.blend.aggression * 0.18) +
      localPower * 0.3 +
      truthStrengthRatio * 0.26
    : 0;
  const trapUnderclaimScore = proven
    ? (1 - truthStrengthRatio) *
      params.blend.trap *
      (params.currentClaim ? 0.16 : 0.28)
    : 0;
  const pressureScore =
    scarcity * (0.24 + params.blend.pressure * 0.36) +
    jump * (0.24 + params.blend.aggression * 0.34) +
    nextVulnerability * params.blend.opportunism * 0.22;
  const bluffScore = proven
    ? 0
    : estimate * 0.96 +
      support * 0.46 +
      strength * (0.14 + params.blend.aggression * 0.42) +
      scarcity * params.blend.pressure * 0.34 +
      params.blend.deception * 0.28 +
      params.blend.chaos * 0.22;
  const bluffRiskPenalty = proven
    ? 0
    : (1 - estimate) * (0.42 + botRisk * 0.3 + params.blend.survival * 0.36);
  const wildPenalty =
    !proven && support < 0.18 && estimate < 0.18
      ? 0.3 - params.blend.chaos * 0.36 - params.blend.deception * 0.12
      : 0;
  const boldBluffBonus =
    !proven && params.currentClaim && handPower >= 0.3 && estimate > 0
      ? (params.blend.aggression * 0.34 +
          params.blend.deception * 0.28 +
          params.blend.chaos * 0.28 +
          params.blend.pressure * 0.2) *
        (1 - botRisk * 0.5)
      : 0;
  const lowTruthTax =
    proven &&
    params.currentClaim &&
    HAND_CLASS_VALUE[params.claim.handType] <= 2
      ? (params.blend.aggression +
          params.blend.deception +
          params.blend.pressure) *
        0.08
      : 0;
  const impossibleBluffPenalty = !proven && estimate <= 0 ? 2.2 : 0;
  const absurdPenalty =
    !proven && estimate < 0.015 && params.blend.chaos < 0.78 ? 0.5 : 0;
  const entropy =
    (unitHash(params.signature, `claim:${claimKey(params.claim)}`) - 0.5) *
    (0.008 + params.blend.chaos * 0.008);

  return {
    type: "SUBMIT_CLAIM",
    reason: reasonForClaimIntent(intent, params.currentClaim),
    claim: params.claim,
    estimatedTruth: estimate,
    score:
      truthScore +
      trapUnderclaimScore +
      pressureScore +
      bluffScore -
      bluffRiskPenalty -
      wildPenalty -
      lowTruthTax +
      boldBluffBonus -
      impossibleBluffPenalty -
      absurdPenalty +
      entropy,
    intent,
  };
}

function scoreCallAction(params: {
  state: GameState;
  bot: PlayerState;
  currentClaim: Claim;
  claimEstimate: number;
  callThreshold: number;
  blend: BotStrategyBlend;
}): CallActionCandidate {
  const claimant = params.state.players.find(
    (player) => player.id === params.currentClaim.playerId,
  );
  const claimantVulnerability = playerVulnerability(claimant);
  const botRisk = playerVulnerability(params.bot);
  const falseProbability = 1 - params.claimEstimate;
  const lowConfidenceBonus =
    params.claimEstimate <= params.callThreshold ? 0.24 : 0;
  const impossibleBonus = params.claimEstimate <= 0.015 ? 0.28 : 0;

  return {
    type: "CALL_BULLSHIT",
    reason: "CALL_LOW_CONFIDENCE_CLAIM",
    claimWindowId: params.state.activeClaimWindow!.id,
    targetClaimId: params.currentClaim.id!,
    estimatedTruth: params.claimEstimate,
    score:
      falseProbability * 1.16 +
      params.blend.skepticism * 0.34 +
      claimantVulnerability * params.blend.opportunism * 0.24 +
      lowConfidenceBonus +
      impossibleBonus -
      params.claimEstimate * (0.5 + params.blend.survival * 0.26) -
      botRisk * 0.16,
  };
}

function bestAction(
  candidates: readonly ActionCandidate[],
): ActionCandidate | undefined {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.type === "SUBMIT_CLAIM" && right.type === "SUBMIT_CLAIM") {
      return compareClaims(right.claim, left.claim);
    }
    return left.type === "SUBMIT_CLAIM" ? -1 : 1;
  })[0];
}

export function decideBotAction(
  state: GameState,
  botPlayerId: string,
  tuning: BotTuning = DEFAULT_BOT_TUNING,
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
        tuning.simulationSamples ?? DEFAULT_SIMULATION_SAMPLES,
      )
    : 1;
  const riskFactor = Math.min(1, Math.max(0, (bot.cardCount - 1) / 4));
  const callThreshold = Math.max(
    0.12,
    tuning.callBullshitAtOrBelow - riskFactor * 0.08,
  );
  const blend = createStrategyBlend(state, bot, tuning);
  const signature = publicStateSignature(state, bot);

  const isBotTurn =
    state.currentTurnPlayerId === bot.id && Boolean(state.currentTurnId);
  const legalClaims = isBotTurn ? getLegalClaimsAfter(currentClaim) : [];

  if (!isBotTurn) {
    if (!canCall || !currentClaim) {
      return { type: "WAIT", reason: "NO_ACTION_AVAILABLE" };
    }

    const futureClaims = getLegalClaimsAfter(currentClaim);
    const hasTruthfulFutureRaise = futureClaims.some((claim) =>
      findClaimProof(claim, bot.roundCards),
    );
    const offTurnCall = scoreCallAction({
      state,
      bot,
      currentClaim,
      claimEstimate,
      callThreshold,
      blend,
    });
    const offTurnCallScoreNeeded =
      1.02 -
      blend.skepticism * 0.12 +
      riskFactor * 0.14 +
      (hasTruthfulFutureRaise ? 0.34 : 0);
    const offTurnVeryLowEstimate = Math.max(
      0.04,
      callThreshold - OFF_TURN_CALL_THRESHOLD_DISCOUNT,
    );
    const futureRaiseShouldWait =
      hasTruthfulFutureRaise &&
      claimEstimate > offTurnVeryLowEstimate &&
      offTurnCall.score < 1.55 + riskFactor * 0.12;

    if (
      !futureRaiseShouldWait &&
      (offTurnCall.score >= offTurnCallScoreNeeded ||
        claimEstimate <= offTurnVeryLowEstimate)
    ) {
      return {
        type: "CALL_BULLSHIT",
        reason: offTurnCall.reason,
        claimWindowId: offTurnCall.claimWindowId,
        targetClaimId: offTurnCall.targetClaimId,
        estimatedTruth: offTurnCall.estimatedTruth,
      };
    }

    return { type: "WAIT", reason: "NO_ACTION_AVAILABLE" };
  }

  if (legalClaims.length === 0) {
    if (canCall && currentClaim) {
      return {
        type: "CALL_BULLSHIT",
        reason: "CALL_NO_LEGAL_RAISE",
        claimWindowId: state.activeClaimWindow!.id,
        targetClaimId: currentClaim.id!,
        estimatedTruth: claimEstimate,
      };
    }
    return { type: "WAIT", reason: "NO_ACTION_AVAILABLE" };
  }

  const maxTruthStrength = maxProvenClaimStrength(legalClaims, bot.roundCards);
  const claimCandidates = strategicClaimPool(legalClaims, bot.roundCards).map(
    (claim) =>
      scoreClaimAction({
        claim,
        state,
        bot,
        currentClaim,
        totalTableCards,
        tuning,
        blend,
        maxTruthStrength,
        signature,
      }),
  );
  const callCandidate =
    canCall && currentClaim
      ? scoreCallAction({
          state,
          bot,
          currentClaim,
          claimEstimate,
          callThreshold,
          blend,
        })
      : undefined;
  const candidates: ActionCandidate[] = callCandidate
    ? [...claimCandidates, callCandidate]
    : claimCandidates;
  const chosen = bestAction(candidates);

  if (chosen?.type === "SUBMIT_CLAIM") {
    const minimumBluffScore =
      chosen.intent === "TRUTHFUL" || chosen.intent === "TRAP_UNDERCLAIM"
        ? -Infinity
        : 0.72 +
          riskFactor * 0.18 +
          blend.survival * 0.14 -
          blend.deception * 0.1 -
          blend.chaos * 0.08;
    const fallbackTruthful = claimCandidates
      .filter(
        (candidate) =>
          candidate.intent === "TRUTHFUL" ||
          candidate.intent === "TRAP_UNDERCLAIM",
      )
      .sort((left, right) => right.score - left.score)[0];
    const safeChosen =
      chosen.score >= minimumBluffScore ? chosen : fallbackTruthful;
    if (safeChosen) {
      return {
        type: "SUBMIT_CLAIM",
        reason: safeChosen.reason,
        claim: safeChosen.claim,
        turnId: state.currentTurnId!,
        claimWindowId: state.activeClaimWindow?.id,
        estimatedTruth: safeChosen.estimatedTruth,
      };
    }
    if (callCandidate) {
      return {
        type: "CALL_BULLSHIT",
        reason: callCandidate.reason,
        claimWindowId: callCandidate.claimWindowId,
        targetClaimId: callCandidate.targetClaimId,
        estimatedTruth: callCandidate.estimatedTruth,
      };
    }
  }

  if (chosen?.type === "CALL_BULLSHIT") {
    return {
      type: "CALL_BULLSHIT",
      reason: chosen.reason,
      claimWindowId: chosen.claimWindowId,
      targetClaimId: chosen.targetClaimId,
      estimatedTruth: chosen.estimatedTruth,
    };
  }

  return { type: "WAIT", reason: "NO_ACTION_AVAILABLE" };
}
