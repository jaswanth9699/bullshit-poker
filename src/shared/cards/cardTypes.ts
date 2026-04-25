export const SUITS = ["S", "H", "D", "C"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export type Rank = (typeof RANKS)[number];

export type Card = {
  id: string;
  rank: Rank;
  suit: Suit;
};

export type Rng = (() => number) & {
  int?: (maxExclusive: number) => number;
};

export const RANK_VALUES: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

export const RANK_BY_VALUE = new Map<number, Rank>(
  Object.entries(RANK_VALUES).map(([rank, value]) => [value, rank as Rank])
);

export function cardId(rank: Rank, suit: Suit): string {
  return `${rank}${suit}`;
}

export function createCard(rank: Rank, suit: Suit): Card {
  return { id: cardId(rank, suit), rank, suit };
}

export function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

export function rankFromValue(value: number): Rank {
  const rank = RANK_BY_VALUE.get(value);
  if (!rank) {
    throw new Error(`Unknown rank value: ${value}`);
  }
  return rank;
}
