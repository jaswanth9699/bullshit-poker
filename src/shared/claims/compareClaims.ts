import { RANKS, rankValue, type Rank } from "../cards/cardTypes.ts";
import {
  FLUSH_HIGH_RANKS,
  HAND_CLASS_VALUE,
  STRAIGHT_FLUSH_HIGH_RANKS,
  STRAIGHT_HIGH_RANKS,
  type Claim
} from "./claimTypes.ts";

function assertRank(rank: Rank | undefined, label: string): Rank {
  if (!rank) {
    throw new Error(`Missing ${label}`);
  }
  return rank;
}

function assertAllowedRank(rank: Rank, allowed: readonly Rank[], label: string): void {
  if (!allowed.includes(rank)) {
    throw new Error(`${rank} is not legal for ${label}`);
  }
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): -1 | 0 | 1 {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

export function normalizeClaimShape(claim: Claim): Claim {
  if (claim.handType !== "TWO_PAIR") {
    return { ...claim };
  }

  const firstRank = assertRank(claim.primaryRank, "Two Pair primaryRank");
  const secondRank = assertRank(claim.secondaryRank, "Two Pair secondaryRank");
  if (firstRank === secondRank) {
    throw new Error("Two Pair ranks must be different");
  }

  const [highPairRank, lowPairRank] =
    rankValue(firstRank) > rankValue(secondRank) ? [firstRank, secondRank] : [secondRank, firstRank];

  return {
    ...claim,
    primaryRank: highPairRank,
    secondaryRank: lowPairRank
  };
}

export function validateClaimShape(claim: Claim): void {
  const normalized = normalizeClaimShape(claim);

  switch (normalized.handType) {
    case "HIGH_CARD":
    case "PAIR":
    case "THREE_OF_A_KIND":
    case "FOUR_OF_A_KIND":
      assertRank(normalized.primaryRank, `${normalized.handType} primaryRank`);
      return;

    case "TWO_PAIR": {
      const highPairRank = assertRank(normalized.primaryRank, "Two Pair highPairRank");
      const lowPairRank = assertRank(normalized.secondaryRank, "Two Pair lowPairRank");
      if (rankValue(highPairRank) <= rankValue(lowPairRank)) {
        throw new Error("Two Pair primaryRank must be higher than secondaryRank after normalization");
      }
      return;
    }

    case "STRAIGHT":
      assertAllowedRank(assertRank(normalized.primaryRank, "Straight highRank"), STRAIGHT_HIGH_RANKS, "Straight");
      return;

    case "FLUSH":
      assertAllowedRank(assertRank(normalized.primaryRank, "Flush highRank"), FLUSH_HIGH_RANKS, "Flush");
      if (!normalized.suit) throw new Error("Missing Flush suit");
      return;

    case "FULL_HOUSE": {
      const tripsRank = assertRank(normalized.primaryRank, "Full House tripsRank");
      const pairRank = assertRank(normalized.secondaryRank, "Full House pairRank");
      if (tripsRank === pairRank) {
        throw new Error("Full House ranks must be different");
      }
      return;
    }

    case "STRAIGHT_FLUSH":
      assertAllowedRank(
        assertRank(normalized.primaryRank, "Straight Flush highRank"),
        STRAIGHT_FLUSH_HIGH_RANKS,
        "Straight Flush"
      );
      if (!normalized.suit) throw new Error("Missing Straight Flush suit");
      return;

    case "ROYAL_FLUSH":
      if (!normalized.suit) throw new Error("Missing Royal Flush suit");
      return;
  }
}

function tieBreakValues(claim: Claim): number[] {
  const normalized = normalizeClaimShape(claim);
  validateClaimShape(normalized);

  switch (normalized.handType) {
    case "HIGH_CARD":
    case "PAIR":
    case "THREE_OF_A_KIND":
    case "STRAIGHT":
    case "FOUR_OF_A_KIND":
    case "STRAIGHT_FLUSH":
      return [rankValue(assertRank(normalized.primaryRank, "primaryRank"))];

    case "TWO_PAIR":
    case "FULL_HOUSE":
      return [
        rankValue(assertRank(normalized.primaryRank, "primaryRank")),
        rankValue(assertRank(normalized.secondaryRank, "secondaryRank"))
      ];

    case "FLUSH":
      return [-rankValue(assertRank(normalized.primaryRank, "Flush highRank"))];

    case "ROYAL_FLUSH":
      return [0];
  }
}

export function compareClaims(left: Claim, right: Claim): -1 | 0 | 1 {
  const normalizedLeft = normalizeClaimShape(left);
  const normalizedRight = normalizeClaimShape(right);
  const leftClass = HAND_CLASS_VALUE[normalizedLeft.handType];
  const rightClass = HAND_CLASS_VALUE[normalizedRight.handType];

  if (leftClass > rightClass) return 1;
  if (leftClass < rightClass) return -1;

  return compareNumberArrays(tieBreakValues(normalizedLeft), tieBreakValues(normalizedRight));
}

export function isClaimStrictlyHigher(next: Claim, previous?: Claim): boolean {
  if (!previous) {
    validateClaimShape(next);
    return true;
  }
  return compareClaims(next, previous) === 1;
}

export function sortRanksDescending(ranks: readonly Rank[]): Rank[] {
  return [...ranks].sort((left, right) => rankValue(right) - rankValue(left));
}

export const ALL_RANKS_DESCENDING = sortRanksDescending(RANKS);
