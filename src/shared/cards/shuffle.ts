import type { Card, Rng } from "./cardTypes.ts";

function randomIndexBelow(maxExclusive: number, rng: Rng): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("Shuffle bound must be a positive integer");
  }

  if (rng.int) {
    const value = rng.int(maxExclusive);
    if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
      throw new Error("RNG int must return an integer in the requested range");
    }
    return value;
  }

  const randomValue = rng();
  if (randomValue < 0 || randomValue >= 1) {
    throw new Error("RNG must return a number in the range [0, 1)");
  }
  return Math.floor(randomValue * maxExclusive);
}

export function shuffleDeck(deck: readonly Card[], rng: Rng): Card[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndexBelow(index + 1, rng);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}
