import assert from "node:assert/strict";
import test from "node:test";

import {
  createCard,
  createPrivateGameView,
  createPublicGameView,
  type GameState,
  type PlayerState
} from "../../src/shared/index.ts";

function player(id: string, seatIndex: number, cards: PlayerState["roundCards"]): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id.toUpperCase(),
    seatIndex,
    avatarKey: `avatar-${seatIndex}`,
    cardCount: cards.length,
    eliminated: false,
    connected: true,
    isBot: false,
    roundCards: cards
  };
}

function state(): GameState {
  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "RoundActive",
    stateRevision: 3,
    hostPlayerId: "A",
    players: [
      player("A", 0, [createCard("A", "S")]),
      player("B", 1, [createCard("K", "H")])
    ],
    playerCredentials: [
      {
        playerId: "A",
        normalizedName: "A",
        pinVerifier: "secret-pin",
        reconnectTokenHash: "secret-token"
      }
    ],
    roundNumber: 1,
    startingPlayerId: "A",
    currentTurnPlayerId: "A",
    currentTurnId: "turn-A",
    claimHistory: [],
    turnStartedAt: 100,
    turnExpiresAt: 120100,
    turnDurationMs: 120000
  };
}

test("public game view removes credentials and all current-round cards", () => {
  const view = createPublicGameView(state());
  const serialized = JSON.stringify(view);

  assert.equal("playerCredentials" in view, false);
  assert.equal("roundCards" in view.players[0], false);
  assert.equal(serialized.includes("secret-pin"), false);
  assert.equal(serialized.includes("AS"), false);
  assert.equal(serialized.includes("KH"), false);
});

test("private game view exposes only the viewer current hand", () => {
  const view = createPrivateGameView(state(), "A");
  const serialized = JSON.stringify(view);

  assert.deepEqual(view.viewerCards.map((card) => card.id), ["AS"]);
  assert.equal("roundCards" in view.players[0], false);
  assert.equal(serialized.includes("AS"), true);
  assert.equal(serialized.includes("KH"), false);
  assert.equal(view.isViewerHost, true);
  assert.equal(view.canViewerAct, true);
});
