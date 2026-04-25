import { RANKS, SUITS, rankValue, type Rank } from "../cards/cardTypes.ts";
import { compareClaims, normalizeClaimShape } from "./compareClaims.ts";
import {
  FLUSH_HIGH_RANKS,
  STRAIGHT_FLUSH_HIGH_RANKS,
  STRAIGHT_HIGH_RANKS,
  type Claim,
  type ClaimTemplate
} from "./claimTypes.ts";

function rankPairsHighFirst(): Array<[Rank, Rank]> {
  const pairs: Array<[Rank, Rank]> = [];
  for (const highRank of RANKS) {
    for (const lowRank of RANKS) {
      if (rankValue(highRank) > rankValue(lowRank)) {
        pairs.push([highRank, lowRank]);
      }
    }
  }
  return pairs;
}

export function getAllLegalClaimTemplates(): ClaimTemplate[] {
  const rankPairs = rankPairsHighFirst();

  return [
    ...RANKS.map((rank) => ({ handType: "HIGH_CARD" as const, primaryRank: rank })),
    ...RANKS.map((rank) => ({ handType: "PAIR" as const, primaryRank: rank })),
    ...rankPairs.map(([highPairRank, lowPairRank]) => ({
      handType: "TWO_PAIR" as const,
      primaryRank: highPairRank,
      secondaryRank: lowPairRank
    })),
    ...RANKS.map((rank) => ({ handType: "THREE_OF_A_KIND" as const, primaryRank: rank })),
    ...STRAIGHT_HIGH_RANKS.map((rank) => ({ handType: "STRAIGHT" as const, primaryRank: rank })),
    ...SUITS.flatMap((suit) =>
      FLUSH_HIGH_RANKS.map((rank) => ({ handType: "FLUSH" as const, suit, primaryRank: rank }))
    ),
    ...RANKS.flatMap((tripsRank) =>
      RANKS.filter((pairRank) => pairRank !== tripsRank).map((pairRank) => ({
        handType: "FULL_HOUSE" as const,
        primaryRank: tripsRank,
        secondaryRank: pairRank
      }))
    ),
    ...RANKS.map((rank) => ({ handType: "FOUR_OF_A_KIND" as const, primaryRank: rank })),
    ...SUITS.flatMap((suit) =>
      STRAIGHT_FLUSH_HIGH_RANKS.map((rank) => ({
        handType: "STRAIGHT_FLUSH" as const,
        suit,
        primaryRank: rank
      }))
    ),
    ...SUITS.map((suit) => ({ handType: "ROYAL_FLUSH" as const, suit }))
  ];
}

export function getLegalClaimsAfter(previousClaim?: Claim): ClaimTemplate[] {
  const allClaims = getAllLegalClaimTemplates();
  if (!previousClaim) {
    return allClaims;
  }

  const normalizedPrevious = normalizeClaimShape(previousClaim);
  return allClaims.filter((claim) => compareClaims(claim, normalizedPrevious) === 1);
}
