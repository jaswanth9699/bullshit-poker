import assert from "node:assert/strict";
import test from "node:test";

import { RoomDurableObject, type DurableObjectStorageLike } from "../../src/durable-objects/index.ts";
import { handleWorkerRequest, type DurableObjectIdLike, type DurableObjectNamespaceLike } from "../../src/worker/index.ts";

class FakeDurableObjectStorage implements DurableObjectStorageLike {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

class FakeDurableObjectId implements DurableObjectIdLike {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }
}

class FakeRoomNamespace implements DurableObjectNamespaceLike {
  readonly stubs = new Map<string, { fetch(request: Request): Promise<Response> }>();

  idFromName(name: string): DurableObjectIdLike {
    return new FakeDurableObjectId(name);
  }

  get(id: DurableObjectIdLike): { fetch(request: Request): Promise<Response> } {
    const key = id.toString();
    const existing = this.stubs.get(key);
    if (existing) return existing;

    const storage = new FakeDurableObjectStorage();
    const object = new RoomDurableObject(
      { storage },
      {
        ROOM_DURABLE_OBJECT: this,
        PIN_SECRET: "test-secret"
      }
    );
    this.stubs.set(key, object);
    return object;
  }
}

class RecordingRoomNamespace implements DurableObjectNamespaceLike {
  readonly requests: Request[] = [];

  idFromName(name: string): DurableObjectIdLike {
    return new FakeDurableObjectId(name);
  }

  get(): { fetch(request: Request): Promise<Response> } {
    return {
      fetch: async (request) => {
        this.requests.push(request);
        return new Response(null, { status: 204 });
      }
    };
  }
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function rngForCodeChars(chars: string): () => number {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const values = chars.split("").map((char) => {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Unknown code char ${char}`);
    return index / alphabet.length + 0.0001;
  });
  return () => values.shift() ?? 0;
}

test("handleWorkerRequest creates, joins, and starts through Durable Object namespace", async () => {
  const namespace = new FakeRoomNamespace();
  const env = { ROOM_DURABLE_OBJECT: namespace, PIN_SECRET: "test-secret" };

  const createResponse = await handleWorkerRequest(
    jsonRequest("/api/rooms", { hostName: "Host", pin: "1234" }),
    env,
    {
      now: () => 100,
      rng: rngForCodeChars("ABC123"),
      generateRoomId: (code) => `room:${code}`
    }
  );
  const createBody = await responseJson(createResponse);

  assert.equal(createResponse.status, 200);
  assert.equal(createBody.ok, true);
  assert.equal((createBody.view as Record<string, unknown>).code, "ABC123");
  assert.equal("state" in createBody, false);

  const hostPlayerId = createBody.playerId as string;
  const joinResponse = await handleWorkerRequest(jsonRequest("/api/rooms/ABC123/join", { name: "Friend", pin: "5678" }), env);
  const joinBody = await responseJson(joinResponse);
  assert.equal(joinBody.ok, true);

  const startResponse = await handleWorkerRequest(jsonRequest("/api/rooms/ABC123/start", { hostPlayerId }), env);
  const startBody = await responseJson(startResponse);
  assert.equal(startBody.ok, true);
  assert.equal((startBody.view as Record<string, unknown>).phase, "RoundActive");
});

test("handleWorkerRequest retries room-code collision on create", async () => {
  const namespace = new FakeRoomNamespace();
  const env = { ROOM_DURABLE_OBJECT: namespace, PIN_SECRET: "test-secret" };

  await handleWorkerRequest(jsonRequest("/api/rooms", { hostName: "Host", pin: "1234" }), env, {
    now: () => 100,
    rng: rngForCodeChars("AAAAAA"),
    generateRoomId: (code) => `room:${code}`
  });

  const response = await handleWorkerRequest(jsonRequest("/api/rooms", { hostName: "Second", pin: "5678" }), env, {
    now: () => 200,
    rng: rngForCodeChars("AAAAAABBBBBB"),
    generateRoomId: (code) => `room:${code}`
  });
  const body = await responseJson(response);

  assert.equal(body.ok, true);
  assert.equal((body.view as Record<string, unknown>).code, "BBBBBB");
});

test("handleWorkerRequest forwards add-bot route through Durable Object namespace", async () => {
  const namespace = new FakeRoomNamespace();
  const env = { ROOM_DURABLE_OBJECT: namespace, PIN_SECRET: "test-secret" };

  const createResponse = await handleWorkerRequest(
    jsonRequest("/api/rooms", { hostName: "Host", pin: "1234" }),
    env,
    {
      now: () => 100,
      rng: rngForCodeChars("ABC123"),
      generateRoomId: (code) => `room:${code}`
    }
  );
  const createBody = await responseJson(createResponse);

  const response = await handleWorkerRequest(
    jsonRequest("/api/rooms/ABC123/bots/add", { hostPlayerId: createBody.playerId, name: "Table Bot" }),
    env
  );
  const body = await responseJson(response);
  const players = (body.view as Record<string, unknown>).players as Array<Record<string, unknown>>;

  assert.equal(body.ok, true);
  assert.equal(players.length, 2);
  assert.equal(players[1].name, "Table Bot");
  assert.equal(players[1].isBot, true);
});

test("handleWorkerRequest forwards remove-bot route through Durable Object namespace", async () => {
  const namespace = new FakeRoomNamespace();
  const env = { ROOM_DURABLE_OBJECT: namespace, PIN_SECRET: "test-secret" };

  const createResponse = await handleWorkerRequest(
    jsonRequest("/api/rooms", { hostName: "Host", pin: "1234" }),
    env,
    {
      now: () => 100,
      rng: rngForCodeChars("ABC123"),
      generateRoomId: (code) => `room:${code}`
    }
  );
  const createBody = await responseJson(createResponse);
  const addResponse = await handleWorkerRequest(
    jsonRequest("/api/rooms/ABC123/bots/add", { hostPlayerId: createBody.playerId, name: "Table Bot" }),
    env
  );
  const addedBody = await responseJson(addResponse);
  const bot = ((addedBody.view as Record<string, unknown>).players as Array<Record<string, unknown>>)
    .find((player) => player.isBot);

  const response = await handleWorkerRequest(
    jsonRequest("/api/rooms/ABC123/bots/remove", { hostPlayerId: createBody.playerId, botPlayerId: bot?.id }),
    env
  );
  const body = await responseJson(response);
  const players = (body.view as Record<string, unknown>).players as Array<Record<string, unknown>>;

  assert.equal(body.ok, true);
  assert.equal(players.some((player) => player.id === bot?.id), false);
});

test("handleWorkerRequest serves frontend assets for non-api GET requests", async () => {
  const env = {
    ROOM_DURABLE_OBJECT: new FakeRoomNamespace(),
    PIN_SECRET: "test-secret",
    ASSETS: {
      async fetch(request: Request): Promise<Response> {
        return new Response(`asset:${new URL(request.url).pathname}`, { status: 200 });
      }
    }
  };

  const response = await handleWorkerRequest(new Request("https://example.test/", { method: "GET" }), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset:/");
});

test("handleWorkerRequest validates method, JSON, and unknown route", async () => {
  const env = { ROOM_DURABLE_OBJECT: new FakeRoomNamespace(), PIN_SECRET: "test-secret" };

  const methodResponse = await handleWorkerRequest(new Request("https://example.test/api/rooms", { method: "GET" }), env);
  assert.equal(methodResponse.status, 405);

  const jsonResponse = await handleWorkerRequest(new Request("https://example.test/api/rooms", { method: "POST", body: "bad" }), env);
  assert.equal(jsonResponse.status, 400);

  const notFoundResponse = await handleWorkerRequest(jsonRequest("/api/nope", {}), env);
  assert.equal(notFoundResponse.status, 404);
});

test("handleWorkerRequest forwards live WebSocket route to the room Durable Object", async () => {
  const namespace = new RecordingRoomNamespace();
  const env = { ROOM_DURABLE_OBJECT: namespace, PIN_SECRET: "test-secret" };

  const response = await handleWorkerRequest(
    new Request("https://example.test/api/rooms/ABC123/live?playerId=p1&reconnectToken=t1", {
      method: "GET",
      headers: {
        upgrade: "websocket"
      }
    }),
    env
  );

  assert.equal(response.status, 204);
  assert.equal(namespace.requests.length, 1);
  assert.equal(new URL(namespace.requests[0].url).pathname, "/room/live");
  assert.equal(new URL(namespace.requests[0].url).searchParams.get("playerId"), "p1");
  assert.equal(namespace.requests[0].headers.get("upgrade"), "websocket");
});
