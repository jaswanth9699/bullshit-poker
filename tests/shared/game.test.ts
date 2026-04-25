import assert from "node:assert/strict";
import test from "node:test";

import { determineNextRoundStarter, normalizeDisplayName, validatePlayerPin, type SeatPlayer } from "../../src/shared/index.ts";

const players: SeatPlayer[] = [
  { id: "A", seatIndex: 0 },
  { id: "B", seatIndex: 1 },
  { id: "C", seatIndex: 2 }
];

test("normalizeDisplayName trims, compacts whitespace, and uppercases", () => {
  assert.equal(normalizeDisplayName("  jaswanth   reddy "), "JASWANTH REDDY");
});

test("validatePlayerPin accepts exactly four digits", () => {
  assert.equal(validatePlayerPin("1234"), true);
  assert.equal(validatePlayerPin("123"), false);
  assert.equal(validatePlayerPin("12345"), false);
  assert.equal(validatePlayerPin("12A4"), false);
});

test("next starter rotates clockwise and skips eliminated player after previous starter", () => {
  assert.equal(determineNextRoundStarter([{ ...players[0] }, { ...players[1], eliminated: true }, { ...players[2] }], "A"), "C");
});

test("next starter rotates clockwise when previous starter is eliminated", () => {
  assert.equal(determineNextRoundStarter([{ ...players[0], eliminated: true }, players[1], players[2]], "A"), "B");
});

test("next starter rotates clockwise and skips voluntary leavers", () => {
  assert.equal(determineNextRoundStarter([players[0], { ...players[1], leftAt: 100 }, players[2]], "A"), "C");
});

test("next starter is null when only one active player remains", () => {
  assert.equal(determineNextRoundStarter([players[0], { ...players[1], eliminated: true }, { ...players[2], leftAt: 100 }], "A"), null);
});
