import assert from "node:assert/strict";
import test from "node:test";

import { MemoryRoomStateStore, RoomAuthority } from "../../src/durable-objects/index.ts";
import { createCard, type ClientActionEnvelope, type GameState, type PlayerState, type SubmitClaimPayload } from "../../src/shared/index.ts";

function player(id: string, seatIndex: number, cards: PlayerState["roundCards"]): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id,
    seatIndex,
    avatarKey: id,
    cardCount: 1,
    eliminated: false,
    connected: true,
    isBot: false,
    roundCards: cards
  };
}

function stateWithClaim(): GameState {
  const currentClaim = { id: "claim-1", handType: "PAIR" as const, primaryRank: "K" as const, playerId: "A", sequence: 1 };

  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "RoundActive",
    stateRevision: 4,
    hostPlayerId: "A",
    players: [
      player("A", 0, [createCard("K", "S")]),
      player("B", 1, [createCard("A", "H")]),
      player("C", 2, [createCard("2", "D")])
    ],
    roundNumber: 1,
    startingPlayerId: "A",
    currentTurnPlayerId: "B",
    currentTurnId: "turn-B-1",
    currentClaim,
    activeClaimWindow: {
      id: "window-1",
      claimId: "claim-1",
      roundNumber: 1,
      openedByClaimSequence: 1,
      status: "OPEN",
      openedAt: 100
    },
    claimHistory: [currentClaim],
    turnStartedAt: 100,
    turnExpiresAt: 120100,
    turnDurationMs: 120000
  };
}

function submitEnvelope(
  state: GameState,
  overrides: Partial<ClientActionEnvelope<SubmitClaimPayload>> = {}
): ClientActionEnvelope<SubmitClaimPayload> {
  return {
    requestId: "req-1",
    roomId: state.roomId,
    playerId: "B",
    stateRevision: state.stateRevision,
    turnId: state.currentTurnId,
    claimWindowId: state.activeClaimWindow?.id,
    payload: { claim: { handType: "PAIR", primaryRank: "A" } },
    ...overrides
  };
}

test("RoomAuthority persists accepted reducer transitions", async () => {
  const initialState = stateWithClaim();
  const store = new MemoryRoomStateStore(initialState);
  const authority = new RoomAuthority(store);

  const result = await authority.submitClaim(submitEnvelope(initialState), 1_000);
  const persisted = await authority.getState();

  assert.equal(result.ok, true);
  assert.equal(persisted?.stateRevision, 5);
  assert.equal(persisted?.currentClaim?.playerId, "B");
  assert.equal(persisted?.currentTurnPlayerId, "C");
});

test("RoomAuthority does not persist rejected transitions", async () => {
  const initialState = stateWithClaim();
  const store = new MemoryRoomStateStore(initialState);
  const authority = new RoomAuthority(store);

  const result = await authority.submitClaim(submitEnvelope(initialState, { stateRevision: initialState.stateRevision - 1 }), 1_000);
  const persisted = await authority.getState();

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "STALE_STATE_REVISION");
  assert.deepEqual(persisted, initialState);
});

test("RoomAuthority serializes race outcome through persisted state", async () => {
  const initialState = stateWithClaim();
  const authority = new RoomAuthority(new MemoryRoomStateStore(initialState));

  const callResult = await authority.callBullshit(
    {
      requestId: "call-1",
      roomId: initialState.roomId,
      playerId: "C",
      stateRevision: initialState.stateRevision,
      claimWindowId: initialState.activeClaimWindow?.id,
      payload: {}
    },
    1_000
  );
  assert.equal(callResult.ok, true);

  const claimResult = await authority.submitClaim(submitEnvelope(initialState), 1_001);

  assert.equal(claimResult.ok, false);
  assert.equal(!claimResult.ok && claimResult.code, "ROUND_ALREADY_RESOLVED");
});

test("RoomAuthority returns ROOM_NOT_FOUND when uninitialized", async () => {
  const authority = new RoomAuthority(new MemoryRoomStateStore());
  const result = await authority.timeout("missing-turn", 1_000);

  assert.deepEqual(result, {
    ok: false,
    code: "ROOM_NOT_FOUND",
    latestStateRevision: 0
  });
});
