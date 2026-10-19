import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRoomStateStore,
  RoomAuthority,
} from "../../src/durable-objects/index.ts";
import {
  createCard,
  type CallBullshitPayload,
  type ClientActionEnvelope,
  type GameState,
  type PlayerState,
  type SubmitClaimPayload,
} from "../../src/shared/index.ts";

function player(
  id: string,
  seatIndex: number,
  cards: PlayerState["roundCards"],
): PlayerState {
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
    roundCards: cards,
  };
}

function stateWithClaim(): GameState {
  const currentClaim = {
    id: "claim-1",
    handType: "PAIR" as const,
    primaryRank: "K" as const,
    playerId: "A",
    sequence: 1,
  };

  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "RoundActive",
    stateRevision: 4,
    hostPlayerId: "A",
    players: [
      player("A", 0, [createCard("K", "S")]),
      player("B", 1, [createCard("A", "H")]),
      player("C", 2, [createCard("2", "D")]),
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
      openedAt: 100,
    },
    claimHistory: [currentClaim],
    turnStartedAt: 100,
    turnExpiresAt: 120100,
    turnDurationMs: 120000,
  };
}

function submitEnvelope(
  state: GameState,
  overrides: Partial<ClientActionEnvelope<SubmitClaimPayload>> = {},
): ClientActionEnvelope<SubmitClaimPayload> {
  return {
    requestId: "req-1",
    roomId: state.roomId,
    playerId: "B",
    stateRevision: state.stateRevision,
    turnId: state.currentTurnId,
    claimWindowId: state.activeClaimWindow?.id,
    payload: { claim: { handType: "PAIR", primaryRank: "A" } },
    ...overrides,
  };
}

test("RoomAuthority persists accepted reducer transitions", async () => {
  const initialState = stateWithClaim();
  const store = new MemoryRoomStateStore(initialState);
  const authority = new RoomAuthority(store);

  const result = await authority.submitClaim(
    submitEnvelope(initialState),
    1_000,
    () => 0,
  );
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

  const result = await authority.submitClaim(
    submitEnvelope(initialState, {
      stateRevision: initialState.stateRevision - 1,
    }),
    1_000,
    () => 0,
  );
  const persisted = await authority.getState();

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "STALE_STATE_REVISION");
  assert.deepEqual(persisted, initialState);
});

test("RoomAuthority serializes genuinely concurrent race actions", async () => {
  const initialState = stateWithClaim();
  const authority = new RoomAuthority(new MemoryRoomStateStore(initialState));

  const [callResult, claimResult] = await Promise.all([
    authority.callBullshit(
      {
        requestId: "call-1",
        roomId: initialState.roomId,
        playerId: "C",
        stateRevision: initialState.stateRevision,
        claimWindowId: initialState.activeClaimWindow?.id,
        payload: {},
      },
      1_000,
      () => 0,
    ),
    authority.submitClaim(submitEnvelope(initialState), 1_001, () => 0),
  ]);
  assert.equal(callResult.ok, true);
  assert.equal(claimResult.ok, false);
  assert.equal(!claimResult.ok && claimResult.code, "STALE_STATE_REVISION");
  assert.equal((await authority.getState())?.phase, "RoundActive");
  assert.equal((await authority.getState())?.roundNumber, 2);
});

test("RoomAuthority returns ROOM_NOT_FOUND when uninitialized", async () => {
  const authority = new RoomAuthority(new MemoryRoomStateStore());
  const result = await authority.submitClaim(
    {
      requestId: "missing",
      roomId: "room-1",
      playerId: "A",
      stateRevision: 1,
      turnId: "turn-1",
      payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
    },
    1_000,
    () => 0,
  );

  assert.deepEqual(result, {
    ok: false,
    code: "ROOM_NOT_FOUND",
    latestStateRevision: 0,
  });
});

function callEnvelope(
  state: GameState,
): ClientActionEnvelope<CallBullshitPayload> {
  return {
    requestId: "call-atomic",
    roomId: state.roomId,
    playerId: "B",
    stateRevision: state.stateRevision,
    claimWindowId: state.activeClaimWindow?.id,
    payload: {},
  };
}

class RecordingStore extends MemoryRoomStateStore {
  readonly writes: GameState[] = [];
  failNextWrite = false;

  override async putState(state: GameState): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("storage unavailable");
    }
    this.writes.push(structuredClone(state));
    await super.putState(state);
  }
}

test("resolution and redeal use one durable write and survive authority restart", async () => {
  const initial = stateWithClaim();
  const store = new RecordingStore(initial);
  const authority = new RoomAuthority(store);
  const result = await authority.callBullshit(
    callEnvelope(initial),
    1_000,
    () => 0,
  );
  assert.ok(result.ok);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].phase, "RoundActive");
  assert.equal(store.writes[0].roundNumber, 2);
  assert.equal(result.newStateRevision, initial.stateRevision + 2);
  assert.equal(result.state.players[0].cardCount, 2);
  assert.equal(result.state.players[0].roundCards.length, 2);
  assert.equal(result.state.startingPlayerId, "B");
  assert.equal(result.roundResult?.penaltyPlayerId, "A");
  assert.deepEqual(
    result.roundResult?.revealedHands,
    initial.players.map((seat) => ({
      playerId: seat.id,
      cards: seat.roundCards,
    })),
  );
  assert.deepEqual(result.state.lastRoundResult, result.roundResult);

  const restarted = new RoomAuthority(store);
  assert.deepEqual(await restarted.getState(), result.state);
  const retry = await restarted.callBullshit(
    callEnvelope(initial),
    1_001,
    () => 0,
  );
  assert.ok(!retry.ok);
  assert.equal(retry.code, "STALE_STATE_REVISION");
  assert.equal(store.writes.length, 1);
  assert.deepEqual(await restarted.getState(), result.state);
});

test("a final claim resolves and redeals once under concurrent duplicate submission", async () => {
  const initial = stateWithClaim();
  initial.currentTurnPlayerId = "A";
  initial.currentTurnId = "turn-A-final";
  const store = new RecordingStore(initial);
  const authority = new RoomAuthority(store);
  const envelope = submitEnvelope(initial, { playerId: "A" });
  const results = await Promise.all([
    authority.submitClaim(envelope, 1_000, () => 0),
    authority.submitClaim(envelope, 1_001, () => 0),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(store.writes.length, 1);
  const state = (await store.getState())!;
  assert.equal(state.phase, "RoundActive");
  assert.equal(state.roundNumber, 2);
  assert.equal(state.players[0].cardCount, 2);
  assert.equal(state.lastRoundResult?.reason, "FINAL_CLAIM");
  assert.equal(state.lastRoundResult?.claim?.playerId, "A");
});

test("a winning resolution persists its frozen result without redealing", async () => {
  const initial = stateWithClaim();
  initial.players = initial.players.slice(0, 2);
  initial.players[0].cardCount = 5;
  const store = new RecordingStore(initial);
  const authority = new RoomAuthority(store);
  const result = await authority.callBullshit(
    callEnvelope(initial),
    1_000,
    () => {
      throw new Error("winning games must not request a new deck");
    },
  );
  assert.ok(result.ok);
  assert.equal(store.writes.length, 1);
  assert.equal(result.state.phase, "GameOver");
  assert.equal(result.state.roundNumber, 1);
  assert.equal(result.state.winnerPlayerId, "B");
  assert.equal(result.state.players[0].eliminated, true);
  assert.equal(result.state.currentTurnId, undefined);
  assert.deepEqual(result.state.lastRoundResult, result.roundResult);
});

test("a failed redeal leaves the unresolved state intact for a safe retry", async () => {
  const initial = stateWithClaim();
  const store = new RecordingStore(initial);
  const authority = new RoomAuthority(store);
  const failed = await authority.callBullshit(
    callEnvelope(initial),
    1_000,
    () => {
      throw new Error("random source unavailable");
    },
  );
  assert.ok(!failed.ok);
  assert.equal(failed.code, "INTERNAL_ERROR");
  assert.equal(store.writes.length, 0);
  assert.deepEqual(await store.getState(), initial);

  const retried = await authority.callBullshit(
    callEnvelope(initial),
    1_001,
    () => 0,
  );
  assert.ok(retried.ok);
  assert.equal(retried.state.players[0].cardCount, 2);
  assert.equal(retried.state.roundNumber, 2);
});

test("a storage failure does not persist a penalty or poison the mutation queue", async () => {
  const initial = stateWithClaim();
  const store = new RecordingStore(initial);
  const authority = new RoomAuthority(store);
  store.failNextWrite = true;
  await assert.rejects(
    authority.callBullshit(callEnvelope(initial), 1_000, () => 0),
    /storage unavailable/,
  );
  assert.deepEqual(await authority.getState(), initial);
  assert.equal(store.writes.length, 0);
  const retried = await authority.callBullshit(
    callEnvelope(initial),
    1_001,
    () => 0,
  );
  assert.ok(retried.ok);
  assert.equal(retried.state.players[0].cardCount, 2);
  assert.equal(store.writes.length, 1);
});

test("malformed wire claims cannot poison a persisted opening claim", async () => {
  const initial = stateWithClaim();
  initial.currentClaim = undefined;
  initial.activeClaimWindow = undefined;
  initial.claimHistory = [];
  const store = new RecordingStore(initial);
  const authority = new RoomAuthority(store);
  const malformed = [
    { handType: "NOT_POKER" },
    { handType: "toString" },
    { handType: "HIGH_CARD", primaryRank: "Z" },
    { handType: "PAIR", primaryRank: 14 },
    { handType: "TWO_PAIR", primaryRank: "A", secondaryRank: "Z" },
    { handType: "FULL_HOUSE", primaryRank: "Z", secondaryRank: "2" },
    { handType: "FLUSH", primaryRank: "A", suit: "stars" },
    { handType: "ROYAL_FLUSH", suit: { symbol: "H" } },
  ];
  for (const claim of malformed) {
    const envelope = submitEnvelope(initial);
    envelope.payload.claim = claim as SubmitClaimPayload["claim"];
    const result = await authority.submitClaim(envelope, 1_000, () => 0);
    assert.ok(!result.ok, JSON.stringify(claim));
    assert.equal(result.code, "INVALID_CLAIM_SHAPE");
    assert.deepEqual(await store.getState(), initial);
  }
  assert.equal(store.writes.length, 0);

  const valid = await authority.submitClaim(
    submitEnvelope(initial),
    1_001,
    () => 0,
  );
  assert.ok(valid.ok);
  assert.equal(store.writes.length, 1);
});

test("accepted claim metadata is generated by the server and drops untrusted fields", async () => {
  const initial = stateWithClaim();
  const authority = new RoomAuthority(new MemoryRoomStateStore(initial));
  const envelope = submitEnvelope(initial);
  envelope.payload.claim = {
    ...envelope.payload.claim,
    id: "reused-client-id",
    playerId: "impersonated-player",
    sequence: 999,
    createdAt: -1,
    arbitraryPayload: { secret: "untrusted" },
  } as SubmitClaimPayload["claim"];
  const result = await authority.submitClaim(envelope, 1_000, () => 0);
  assert.ok(result.ok);
  assert.equal(result.state.currentClaim?.id, "room-1:round:1:claim:2");
  assert.equal(result.state.currentClaim?.playerId, "B");
  assert.equal(result.state.currentClaim?.sequence, 2);
  assert.equal(result.state.currentClaim?.createdAt, 1_000);
  assert.equal("arbitraryPayload" in result.state.currentClaim!, false);
});
