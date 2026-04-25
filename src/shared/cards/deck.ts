import { createCard, RANKS, SUITS, type Card } from "./cardTypes.ts";

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => createCard(rank, suit)));
}

export function assertUniqueCards(cards: readonly Card[]): void {
  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) {
    throw new Error("Card collection contains duplicate card ids");
  }
}
