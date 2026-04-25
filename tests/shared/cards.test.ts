import assert from "node:assert/strict";
import test from "node:test";

import { assertUniqueCards, createCard, createDeck, shuffleDeck, type Rng } from "../../src/shared/index.ts";

test("createDeck creates a unique standard 52-card deck", () => {
  const deck = createDeck();

  assert.equal(deck.length, 52);
  assert.doesNotThrow(() => assertUniqueCards(deck));
  assert.equal(deck.filter((card) => card.suit === "S").length, 13);
  assert.equal(deck.filter((card) => card.rank === "A").length, 4);
});

test("shuffleDeck preserves cards and is deterministic with injected RNG", () => {
  const deck = [createCard("A", "S"), createCard("K", "H"), createCard("Q", "D"), createCard("J", "C")];
  const rngValues = [0.1, 0.7, 0.4];
  const shuffled = shuffleDeck(deck, () => rngValues.shift() ?? 0);

  assert.deepEqual(
    shuffled.map((card) => card.id).sort(),
    deck.map((card) => card.id).sort()
  );
  assert.notDeepEqual(
    shuffled.map((card) => card.id),
    deck.map((card) => card.id)
  );
  assert.deepEqual(
    deck.map((card) => card.id),
    ["AS", "KH", "QD", "JC"]
  );
});

test("shuffleDeck rejects RNG values outside [0, 1)", () => {
  assert.throws(() => shuffleDeck(createDeck(), () => 1), /RNG/);
});

test("shuffleDeck prefers bounded random integers when available", () => {
  const deck = [createCard("A", "S"), createCard("K", "H"), createCard("Q", "D"), createCard("J", "C")];
  const requestedBounds: number[] = [];
  const rng = (() => {
    throw new Error("float RNG should not be used when int RNG exists");
  }) as Rng;
  const values = [0, 1, 0];
  rng.int = (maxExclusive) => {
    requestedBounds.push(maxExclusive);
    return values.shift() ?? 0;
  };

  const shuffled = shuffleDeck(deck, rng);

  assert.deepEqual(requestedBounds, [4, 3, 2]);
  assert.deepEqual(
    shuffled.map((card) => card.id),
    ["QD", "JC", "KH", "AS"]
  );
});
