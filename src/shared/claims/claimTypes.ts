import type { Rank, Suit } from "../cards/cardTypes.ts";

export const HAND_TYPES = [
  "HIGH_CARD",
  "PAIR",
  "TWO_PAIR",
  "THREE_OF_A_KIND",
  "STRAIGHT",
  "FLUSH",
  "FULL_HOUSE",
  "FOUR_OF_A_KIND",
  "STRAIGHT_FLUSH",
  "ROYAL_FLUSH"
] as const;

export type HandType = (typeof HAND_TYPES)[number];

export type Claim = {
  id?: string;
  sequence?: number;
  playerId?: string;
  handType: HandType;
  primaryRank?: Rank;
  secondaryRank?: Rank;
  suit?: Suit;
  createdAt?: number;
};

export type ClaimTemplate = Claim;

export const HAND_CLASS_VALUE: Record<HandType, number> = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10
};

export const STRAIGHT_HIGH_RANKS = ["5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const FLUSH_HIGH_RANKS = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const STRAIGHT_FLUSH_HIGH_RANKS = ["5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
