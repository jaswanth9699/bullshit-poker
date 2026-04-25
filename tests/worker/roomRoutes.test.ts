import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRoomStateStore,
  RoomAuthority,
} from "../../src/durable-objects/index.ts";
import type { RoomIdentityProvider } from "../../src/shared/index.ts";
import { handleRoomHttpRequest } from "../../src/worker/index.ts";

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
      return `verifier:${playerId}:${pin}`;
    },
    verifyPin(pin, verifier, playerId) {
      return verifier === `verifier:${playerId}:${pin}`;
    },
    hashReconnectToken(token, playerId) {
      return `hash:${playerId}:${token}`;
    },
  };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("room HTTP routes create, join, and start a room", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  const createResponse = await handleRoomHttpRequest(
    jsonRequest("/room/create", {
      roomId: "room-1",
      code: "ABC123",
      hostName: "Host",
      pin: "1234",
    }),
    context,
  );
  const createBody = await responseJson(createResponse);
  assert.equal(createResponse.status, 200);
  assert.equal(createBody.ok, true);
  assert.equal(createBody.playerId, "player-1");

  const joinResponse = await handleRoomHttpRequest(
    jsonRequest("/room/join", { name: "Friend", pin: "5678" }),
    context,
  );
  const joinBody = await responseJson(joinResponse);
  assert.equal(joinResponse.status, 200);
  assert.equal(joinBody.ok, true);
  assert.equal(joinBody.playerId, "player-2");

  const startResponse = await handleRoomHttpRequest(
    jsonRequest("/room/start", { hostPlayerId: "player-1" }),
    context,
  );
  const startBody = await responseJson(startResponse);
  assert.equal(startResponse.status, 200);
  assert.equal(startBody.ok, true);
  assert.equal(
    (startBody.view as Record<string, unknown>).phase,
    "RoundActive",
  );
  assert.equal("state" in startBody, false);
});

test("room HTTP routes reject bad method, bad JSON, and missing fields", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  const methodResponse = await handleRoomHttpRequest(
    new Request("https://example.test/room/create", { method: "GET" }),
    context,
  );
  assert.equal(methodResponse.status, 405);
  assert.equal((await responseJson(methodResponse)).code, "METHOD_NOT_ALLOWED");

  const jsonResponse = await handleRoomHttpRequest(
    new Request("https://example.test/room/create", {
      method: "POST",
      body: "not-json",
    }),
    context,
  );
  assert.equal(jsonResponse.status, 400);
  assert.equal((await responseJson(jsonResponse)).code, "INVALID_JSON");

  const missingFieldResponse = await handleRoomHttpRequest(
    jsonRequest("/room/create", { roomId: "room-1" }),
    context,
  );
  assert.equal(missingFieldResponse.status, 400);
  assert.equal(
    (await responseJson(missingFieldResponse)).code,
    "INVALID_CREATE_ROOM_REQUEST",
  );
});

test("room HTTP action route forwards submit claim envelope", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  await handleRoomHttpRequest(
    jsonRequest("/room/create", {
      roomId: "room-1",
      code: "ABC123",
      hostName: "Host",
      pin: "1234",
    }),
    context,
  );
  await handleRoomHttpRequest(
    jsonRequest("/room/join", { name: "Friend", pin: "5678" }),
    context,
  );
  const startResponse = await handleRoomHttpRequest(
    jsonRequest("/room/start", { hostPlayerId: "player-1" }),
    context,
  );
  const startBody = await responseJson(startResponse);
  const state = startBody.view as Record<string, unknown>;

  const submitResponse = await handleRoomHttpRequest(
    jsonRequest("/room/actions/submit-claim", {
      envelope: {
        requestId: "req-1",
        roomId: "room-1",
        playerId: "player-1",
        stateRevision: state.stateRevision,
        turnId: state.currentTurnId,
        payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
      },
    }),
    context,
  );

  const submitBody = await responseJson(submitResponse);
  assert.equal(submitResponse.status, 200);
  assert.equal(submitBody.ok, true);
  assert.equal(
    (
      (submitBody.view as Record<string, unknown>).currentClaim as Record<
        string,
        unknown
      >
    ).playerId,
    "player-1",
  );
  assert.equal("state" in submitBody, false);
});

test("room HTTP routes add a bot in the lobby", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  await handleRoomHttpRequest(
    jsonRequest("/room/create", {
      roomId: "room-1",
      code: "ABC123",
      hostName: "Host",
      pin: "1234",
    }),
    context,
  );

  const response = await handleRoomHttpRequest(
    jsonRequest("/room/bots/add", {
      hostPlayerId: "player-1",
      name: "Table Bot",
    }),
    context,
  );
  const body = await responseJson(response);
  const view = body.view as Record<string, unknown>;
  const players = view.players as Array<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(players.length, 2);
  assert.equal(players[1].name, "Table Bot");
  assert.equal(players[1].isBot, true);
  assert.equal("state" in body, false);
});

test("room HTTP routes remove a bot in the lobby", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  await handleRoomHttpRequest(
    jsonRequest("/room/create", {
      roomId: "room-1",
      code: "ABC123",
      hostName: "Host",
      pin: "1234",
    }),
    context,
  );
  const addResponse = await handleRoomHttpRequest(
    jsonRequest("/room/bots/add", {
      hostPlayerId: "player-1",
      name: "Table Bot",
    }),
    context,
  );
  const addedBody = await responseJson(addResponse);
  const addedView = addedBody.view as Record<string, unknown>;
  const bot = (addedView.players as Array<Record<string, unknown>>).find(
    (player) => player.isBot,
  );

  const removeResponse = await handleRoomHttpRequest(
    jsonRequest("/room/bots/remove", {
      hostPlayerId: "player-1",
      botPlayerId: bot?.id,
    }),
    context,
  );
  const removedBody = await responseJson(removeResponse);
  const removedView = removedBody.view as Record<string, unknown>;
  const players = removedView.players as Array<Record<string, unknown>>;

  assert.equal(removeResponse.status, 200);
  assert.equal(removedBody.ok, true);
  assert.equal(
    players.some((player) => player.id === bot?.id),
    false,
  );
});

test("room HTTP routes let the host remove a human lobby seat", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  await handleRoomHttpRequest(
    jsonRequest("/room/create", {
      roomId: "room-1",
      code: "ABC123",
      hostName: "Host",
      pin: "1234",
    }),
    context,
  );
  const joinResponse = await handleRoomHttpRequest(
    jsonRequest("/room/join", { name: "Friend", pin: "5678" }),
    context,
  );
  const joinedBody = await responseJson(joinResponse);

  const removeResponse = await handleRoomHttpRequest(
    jsonRequest("/room/players/remove", {
      hostPlayerId: "player-1",
      targetPlayerId: joinedBody.playerId,
    }),
    context,
  );
  const removedBody = await responseJson(removeResponse);
  const removedView = removedBody.view as Record<string, unknown>;
  const players = removedView.players as Array<Record<string, unknown>>;

  assert.equal(removeResponse.status, 200);
  assert.equal(removedBody.ok, true);
  assert.equal(
    players.some((player) => player.id === joinedBody.playerId),
    false,
  );
});

test("room HTTP add-bot route validates host player id", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  const response = await handleRoomHttpRequest(
    jsonRequest("/room/bots/add", {}),
    context,
  );

  assert.equal(response.status, 400);
  assert.equal((await responseJson(response)).code, "INVALID_ADD_BOT_REQUEST");
});

test("room HTTP routes advance from resolved round into the next round", async () => {
  const context = {
    authority: new RoomAuthority(new MemoryRoomStateStore()),
    identity: identityProvider(),
    now: () => 500,
    rng: () => 0,
  };

  await handleRoomHttpRequest(
    jsonRequest("/room/create", {
      roomId: "room-1",
      code: "ABC123",
      hostName: "Host",
      pin: "1234",
    }),
    context,
  );
  await handleRoomHttpRequest(
    jsonRequest("/room/join", { name: "Friend", pin: "5678" }),
    context,
  );
  const startResponse = await handleRoomHttpRequest(
    jsonRequest("/room/start", { hostPlayerId: "player-1" }),
    context,
  );
  const startState = (await responseJson(startResponse)).view as Record<
    string,
    unknown
  >;

  const submitResponse = await handleRoomHttpRequest(
    jsonRequest("/room/actions/submit-claim", {
      envelope: {
        requestId: "claim-1",
        roomId: "room-1",
        playerId: "player-1",
        stateRevision: startState.stateRevision,
        turnId: startState.currentTurnId,
        payload: { claim: { handType: "HIGH_CARD", primaryRank: "A" } },
      },
    }),
    context,
  );
  const claimState = (await responseJson(submitResponse)).view as Record<
    string,
    unknown
  >;

  await handleRoomHttpRequest(
    jsonRequest("/room/actions/call-bullshit", {
      envelope: {
        requestId: "call-1",
        roomId: "room-1",
        playerId: "player-2",
        stateRevision: claimState.stateRevision,
        claimWindowId: (claimState.activeClaimWindow as Record<string, unknown>)
          .id,
        payload: {},
      },
    }),
    context,
  );

  const nextRoundResponse = await handleRoomHttpRequest(
    jsonRequest("/room/next-round", {}),
    context,
  );
  const nextRoundBody = await responseJson(nextRoundResponse);
  const nextRoundState = nextRoundBody.view as Record<string, unknown>;

  assert.equal(nextRoundBody.ok, true);
  assert.equal(nextRoundState.phase, "RoundActive");
  assert.equal(nextRoundState.roundNumber, 2);
  assert.equal(nextRoundState.startingPlayerId, "player-2");
});
