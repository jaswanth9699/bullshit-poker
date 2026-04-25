import assert from "node:assert/strict";
import test from "node:test";

import { MemoryRoomStateStore, RoomAuthority } from "../../src/durable-objects/index.ts";
import type { RoomIdentityProvider } from "../../src/shared/index.ts";

function identityProvider(): RoomIdentityProvider {
  let playerCounter = 0;
  let tokenCounter = 0;

  return {
    createPlayerId() {
      playerCounter += 1;
      return `player-${playerCounter}`;
    },
    createReconnectToken() {
      tokenCounter += 1;
      return `token-${tokenCounter}`;
    },
    createPinVerifier(pin, playerId) {
      return `pin:${playerId}:${pin}`;
    },
    verifyPin(pin, verifier, playerId) {
      return verifier === `pin:${playerId}:${pin}`;
    },
    hashReconnectToken(token, playerId) {
      return `token:${playerId}:${token}`;
    }
  };
}

test("RoomAuthority creates, joins, and starts a room through persisted state", async () => {
  const identity = identityProvider();
  const authority = new RoomAuthority(new MemoryRoomStateStore());

  const created = await authority.createRoom({
    roomId: "room-1",
    code: "ABC123",
    hostName: "Host",
    pin: "1234",
    now: 100,
    identity
  });
  assert.equal(created.ok, true);
  assert.equal(created.ok && created.playerId, "player-1");

  const joined = await authority.joinRoom({ name: "Friend", pin: "5678", now: 200, identity });
  assert.equal(joined.ok, true);
  assert.equal(joined.ok && joined.playerId, "player-2");

  const started = await authority.startGame("player-1", 300, () => 0);
  assert.equal(started.ok, true);
  assert.equal(started.ok && started.state.phase, "RoundActive");

  const persisted = await authority.getState();
  assert.equal(persisted?.phase, "RoundActive");
  assert.equal(persisted?.players.length, 2);
  assert.equal(persisted?.players.every((player) => player.roundCards.length === 1), true);
});

test("RoomAuthority does not persist failed join attempts", async () => {
  const identity = identityProvider();
  const authority = new RoomAuthority(new MemoryRoomStateStore());

  const created = await authority.createRoom({
    roomId: "room-1",
    code: "ABC123",
    hostName: "Host",
    pin: "1234",
    now: 100,
    identity
  });
  assert.equal(created.ok, true);

  const failedJoin = await authority.joinRoom({ name: "Host", pin: "9999", now: 200, identity });
  assert.equal(failedJoin.ok, false);
  assert.equal(!failedJoin.ok && failedJoin.code, "PIN_MISMATCH");

  const persisted = await authority.getState();
  assert.equal(persisted?.players.length, 1);
  assert.equal(persisted?.stateRevision, created.ok ? created.state.stateRevision : undefined);
});
