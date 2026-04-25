import assert from "node:assert/strict";
import test from "node:test";

import {
  compareClaims,
  createCard,
  evaluateClaim,
  findClaimProof,
  getLegalClaimsAfter,
  isClaimStrictlyHigher,
  normalizeClaimShape,
  type Claim,
  type HandType,
  type Rank,
  type Suit
} from "../../src/shared/index.ts";

function claim(handType: HandType, primaryRank?: Rank, secondaryRank?: Rank, suit?: Suit): Claim {
  return { handType, primaryRank, secondaryRank, suit };
}

function hasClaim(claims: readonly Claim[], expected: Claim): boolean {
  const normalizedExpected = normalizeClaimShape(expected);
  return claims.some((candidate) => {
    const normalizedCandidate = normalizeClaimShape(candidate);
    return (
      normalizedCandidate.handType === normalizedExpected.handType &&
      normalizedCandidate.primaryRank === normalizedExpected.primaryRank &&
      normalizedCandidate.secondaryRank === normalizedExpected.secondaryRank &&
      normalizedCandidate.suit === normalizedExpected.suit
    );
  });
}

test("Two Pair compares both pair ranks, not only the high pair", () => {
  assert.equal(compareClaims(claim("TWO_PAIR", "K", "J"), claim("TWO_PAIR", "K", "10")), 1);
  assert.equal(compareClaims(claim("TWO_PAIR", "K", "Q"), claim("TWO_PAIR", "K", "J")), 1);
  assert.equal(compareClaims(claim("TWO_PAIR", "A", "K"), claim("TWO_PAIR", "K", "Q")), 1);
});

test("Two Pair legal-claim generation includes same-high-pair raises", () => {
  const legalClaims = getLegalClaimsAfter(claim("TWO_PAIR", "K", "10"));

  assert.equal(hasClaim(legalClaims, claim("TWO_PAIR", "K", "J")), true);
  assert.equal(hasClaim(legalClaims, claim("TWO_PAIR", "K", "Q")), true);
  assert.equal(hasClaim(legalClaims, claim("TWO_PAIR", "A", "K")), true);
});

test("Two Pair normalizes reversed pair rank input", () => {
  assert.deepEqual(normalizeClaimShape(claim("TWO_PAIR", "K", "A")), claim("TWO_PAIR", "A", "K"));
});

test("Full House compares pair rank when trips are tied", () => {
  assert.equal(compareClaims(claim("FULL_HOUSE", "K", "J"), claim("FULL_HOUSE", "K", "10")), 1);
  assert.equal(compareClaims(claim("FULL_HOUSE", "K", "Q"), claim("FULL_HOUSE", "K", "J")), 1);
  assert.equal(compareClaims(claim("FULL_HOUSE", "K", "A"), claim("FULL_HOUSE", "K", "Q")), 1);
});

test("Full House legal-claim generation includes same-trips higher-pair raises", () => {
  const legalClaims = getLegalClaimsAfter(claim("FULL_HOUSE", "K", "10"));

  assert.equal(hasClaim(legalClaims, claim("FULL_HOUSE", "K", "J")), true);
  assert.equal(hasClaim(legalClaims, claim("FULL_HOUSE", "K", "Q")), true);
  assert.equal(hasClaim(legalClaims, claim("FULL_HOUSE", "K", "A")), true);
});

test("regular Flush uses locked reversed high-card ordering", () => {
  assert.equal(compareClaims(claim("FLUSH", "K", undefined, "S"), claim("FLUSH", "A", undefined, "S")), 1);
  assert.equal(compareClaims(claim("FLUSH", "Q", undefined, "S"), claim("FLUSH", "K", undefined, "S")), 1);
  assert.equal(compareClaims(claim("FLUSH", "6", undefined, "S"), claim("FLUSH", "7", undefined, "S")), 1);
});

test("Straight Flush uses normal high-card ordering", () => {
  assert.equal(
    compareClaims(claim("STRAIGHT_FLUSH", "K", undefined, "H"), claim("STRAIGHT_FLUSH", "Q", undefined, "H")),
    1
  );
});

test("Royal Flush is not ranked by suit", () => {
  assert.equal(compareClaims(claim("ROYAL_FLUSH", undefined, undefined, "H"), claim("ROYAL_FLUSH", undefined, undefined, "S")), 0);
  assert.equal(isClaimStrictlyHigher(claim("ROYAL_FLUSH", undefined, undefined, "H"), claim("ROYAL_FLUSH", undefined, undefined, "S")), false);
});

test("Ace-low straight requires the Ace", () => {
  const cards = [createCard("2", "S"), createCard("3", "H"), createCard("4", "D"), createCard("5", "C")];

  assert.equal(evaluateClaim(claim("STRAIGHT", "5"), cards), false);
});

test("Ace-low straight evaluates true with A, 2, 3, 4, 5", () => {
  const cards = [
    createCard("A", "S"),
    createCard("2", "H"),
    createCard("3", "D"),
    createCard("4", "C"),
    createCard("5", "S")
  ];

  assert.equal(evaluateClaim(claim("STRAIGHT", "5"), cards), true);
});

test("regular Flush requires high card and four lower same-suit cards", () => {
  const cards = [
    createCard("K", "H"),
    createCard("Q", "H"),
    createCard("9", "H"),
    createCard("6", "H"),
    createCard("2", "H")
  ];

  assert.equal(evaluateClaim(claim("FLUSH", "K", undefined, "H"), cards), true);
  assert.equal(evaluateClaim(claim("FLUSH", "A", undefined, "H"), cards), false);
});

test("5-high Straight Flush requires suited Ace", () => {
  const cards = [
    createCard("2", "D"),
    createCard("3", "D"),
    createCard("4", "D"),
    createCard("5", "D"),
    createCard("A", "S")
  ];

  assert.equal(evaluateClaim(claim("STRAIGHT_FLUSH", "5", undefined, "D"), cards), false);
});

test("findClaimProof returns exact proof cards for a true Full House", () => {
  const cards = [
    createCard("Q", "S"),
    createCard("Q", "H"),
    createCard("Q", "D"),
    createCard("7", "C"),
    createCard("7", "D"),
    createCard("2", "S")
  ];

  const proof = findClaimProof(claim("FULL_HOUSE", "Q", "7"), cards);

  assert.deepEqual(
    proof?.map((card) => card.id).sort(),
    ["7C", "7D", "QD", "QH", "QS"]
  );
});
