import assert from "node:assert/strict";
import test from "node:test";

import { DurableObjectRoomStateStore, ROOM_STATE_STORAGE_KEY, type DurableObjectStorageLike } from "../../src/durable-objects/index.ts";
import { createCard, type GameState, type PlayerState } from "../../src/shared/index.ts";

class FakeDurableObjectStorage implements DurableObjectStorageLike {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

function player(id: string): PlayerState {
  return {
    id,
    name: id,
    normalizedName: id,
    seatIndex: 0,
    avatarKey: id,
    cardCount: 1,
    eliminated: false,
    connected: true,
    isBot: false,
    roundCards: [createCard("A", "S")]
  };
}

function gameState(): GameState {
  return {
    roomId: "room-1",
    code: "ABC123",
    phase: "Lobby",
    stateRevision: 1,
    hostPlayerId: "A",
    players: [player("A")],
    roundNumber: 0,
    claimHistory: [],
    turnDurationMs: 120000
  };
}

test("DurableObjectRoomStateStore stores GameState under the default key", async () => {
  const storage = new FakeDurableObjectStorage();
  const store = new DurableObjectRoomStateStore(storage);
  const state = gameState();

  await store.putState(state);

  assert.deepEqual(await store.getState(), state);
  assert.equal(storage.values.has(ROOM_STATE_STORAGE_KEY), true);
});

test("DurableObjectRoomStateStore can use a custom key", async () => {
  const storage = new FakeDurableObjectStorage();
  const store = new DurableObjectRoomStateStore(storage, "custom");
  const state = gameState();

  await store.putState(state);

  assert.deepEqual(await store.getState(), state);
  assert.equal(storage.values.has("custom"), true);
  assert.equal(storage.values.has(ROOM_STATE_STORAGE_KEY), false);
});
