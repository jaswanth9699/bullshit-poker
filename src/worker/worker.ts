import { generateRoomCode, type Rng } from "../shared/index.ts";
import type { DurableObjectStubLike, WorkerEnv } from "./runtimeTypes.ts";

const CREATE_ROOM_MAX_ATTEMPTS = 8;

type WorkerDeps = {
  now: () => number;
  rng: Rng;
  generateRoomId: (code: string, now: number) => string;
};

const defaultDeps: WorkerDeps = {
  now: () => Date.now(),
  rng: () => {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 2 ** 32;
  },
  generateRoomId: (code, now) => `room:${code}:${now}`
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ ok: false, code }, status);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = (await request.json()) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function roomStub(env: WorkerEnv, code: string): DurableObjectStubLike {
  return env.ROOM_DURABLE_OBJECT.get(env.ROOM_DURABLE_OBJECT.idFromName(code));
}

async function forwardToRoom(stub: DurableObjectStubLike, path: string, body: unknown): Promise<Response> {
  return stub.fetch(
    new Request(`https://room.internal${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    })
  );
}

async function forwardLiveToRoom(stub: DurableObjectStubLike, path: string, request: Request): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`https://room.internal${path}`);
  targetUrl.search = sourceUrl.search;

  return stub.fetch(
    new Request(targetUrl, {
      method: request.method,
      headers: request.headers
    })
  );
}

function liveRoomPathFromApi(path: string): { code: string; roomPath: string } | null {
  const match = /^\/api\/rooms\/([^/]+)\/live$/.exec(path);
  if (!match) return null;

  const [, code] = match;
  return { code, roomPath: "/room/live" };
}

function roomPathFromApi(path: string): { code: string; roomPath: string } | null {
  const match = /^\/api\/rooms\/([^/]+)(\/.*)$/.exec(path);
  if (!match) return null;

  const [, code, suffix] = match;
  if (suffix === "/join") return { code, roomPath: "/room/join" };
  if (suffix === "/bots/add") return { code, roomPath: "/room/bots/add" };
  if (suffix === "/bots/remove") return { code, roomPath: "/room/bots/remove" };
  if (suffix === "/start") return { code, roomPath: "/room/start" };
  if (suffix === "/next-round") return { code, roomPath: "/room/next-round" };
  if (suffix === "/actions/submit-claim") return { code, roomPath: "/room/actions/submit-claim" };
  if (suffix === "/actions/call-bullshit") return { code, roomPath: "/room/actions/call-bullshit" };
  if (suffix === "/actions/timeout") return { code, roomPath: "/room/actions/timeout" };
  return null;
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnv,
  deps: Partial<WorkerDeps> = {}
): Promise<Response> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const url = new URL(request.url);
  const livePath = liveRoomPathFromApi(url.pathname);

  if (livePath) {
    return forwardLiveToRoom(roomStub(env, livePath.code), livePath.roomPath, request);
  }

  if (!url.pathname.startsWith("/api/") && env.ASSETS && (request.method === "GET" || request.method === "HEAD")) {
    return env.ASSETS.fetch(request);
  }

  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", 405);
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  if (url.pathname === "/api/rooms") {
    const hostName = stringField(body, "hostName");
    const pin = stringField(body, "pin");
    if (!hostName || !pin) {
      return errorResponse("INVALID_CREATE_ROOM_REQUEST", 400);
    }

    for (let attempt = 0; attempt < CREATE_ROOM_MAX_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode(resolvedDeps.rng);
      const now = resolvedDeps.now();
      const response = await forwardToRoom(roomStub(env, code), "/room/create", {
        roomId: resolvedDeps.generateRoomId(code, now),
        code,
        hostName,
        pin
      });
      const result = (await response.json()) as { ok?: boolean; code?: string };

      if (result.ok || result.code !== "GAME_ALREADY_STARTED") {
        return jsonResponse(result, response.status);
      }
    }

    return errorResponse("ROOM_CODE_COLLISION", 503);
  }

  const roomPath = roomPathFromApi(url.pathname);
  if (!roomPath) {
    return errorResponse("NOT_FOUND", 404);
  }

  return forwardToRoom(roomStub(env, roomPath.code), roomPath.roomPath, body);
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  }
};

export { RoomDurableObject } from "../durable-objects/roomDurableObject.ts";
