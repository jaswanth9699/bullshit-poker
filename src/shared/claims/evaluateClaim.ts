import { rankFromValue, rankValue, type Card, type Rank, type Suit } from "../cards/cardTypes.ts";
import { normalizeClaimShape, validateClaimShape } from "./compareClaims.ts";
import type { Claim } from "./claimTypes.ts";

function cardsByRank(cards: readonly Card[], rank: Rank): Card[] {
  return cards.filter((card) => card.rank === rank);
}

function cardsBySuit(cards: readonly Card[], suit: Suit): Card[] {
  return cards.filter((card) => card.suit === suit);
}

function straightRanksEndingAt(highRank: Rank): Rank[] {
  if (highRank === "5") {
    return ["A", "2", "3", "4", "5"];
  }

  const highValue = rankValue(highRank);
  return [highValue - 4, highValue - 3, highValue - 2, highValue - 1, highValue].map(rankFromValue);
}

function takeCards(cards: readonly Card[], rank: Rank, count: number): Card[] | null {
  const matches = cardsByRank(cards, rank);
  return matches.length >= count ? matches.slice(0, count) : null;
}

function findStraightProof(cards: readonly Card[], highRank: Rank, suit?: Suit): Card[] | null {
  const source = suit ? cardsBySuit(cards, suit) : [...cards];
  const proof: Card[] = [];

  for (const rank of straightRanksEndingAt(highRank)) {
    const card = source.find((candidate) => candidate.rank === rank);
    if (!card) return null;
    proof.push(card);
  }

  return proof;
}

export function findClaimProof(claim: Claim, cards: readonly Card[]): Card[] | null {
  const normalized = normalizeClaimShape(claim);
  validateClaimShape(normalized);

  switch (normalized.handType) {
    case "HIGH_CARD":
      return takeCards(cards, normalized.primaryRank!, 1);

    case "PAIR":
      return takeCards(cards, normalized.primaryRank!, 2);

    case "TWO_PAIR": {
      const highPair = takeCards(cards, normalized.primaryRank!, 2);
      const lowPair = takeCards(cards, normalized.secondaryRank!, 2);
      return highPair && lowPair ? [...highPair, ...lowPair] : null;
    }

    case "THREE_OF_A_KIND":
      return takeCards(cards, normalized.primaryRank!, 3);

    case "STRAIGHT":
      return findStraightProof(cards, normalized.primaryRank!);

    case "FLUSH": {
      const suited = cardsBySuit(cards, normalized.suit!);
      const highCard = suited.find((card) => card.rank === normalized.primaryRank);
      if (!highCard) return null;

      const lowerCards = suited
        .filter((card) => rankValue(card.rank) < rankValue(normalized.primaryRank!))
        .sort((left, right) => rankValue(right.rank) - rankValue(left.rank));

      return lowerCards.length >= 4 ? [highCard, ...lowerCards.slice(0, 4)] : null;
    }

    case "FULL_HOUSE": {
      const trips = takeCards(cards, normalized.primaryRank!, 3);
      const pair = takeCards(cards, normalized.secondaryRank!, 2);
      return trips && pair ? [...trips, ...pair] : null;
    }

    case "FOUR_OF_A_KIND":
      return takeCards(cards, normalized.primaryRank!, 4);

    case "STRAIGHT_FLUSH":
      return findStraightProof(cards, normalized.primaryRank!, normalized.suit);

    case "ROYAL_FLUSH":
      return findStraightProof(cards, "A", normalized.suit);
  }
}

export function evaluateClaim(claim: Claim, cards: readonly Card[]): boolean {
  return findClaimProof(claim, cards) !== null;
}
