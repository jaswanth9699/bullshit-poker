import { RoomAuthority } from "./roomAuthority.ts";
import { DurableObjectRoomStateStore } from "./roomStorage.ts";
import { RoomSessionManager, type RoomSocketLike } from "./roomSessions.ts";
import { handleRoomHttpRequest } from "../worker/roomRoutes.ts";
import { createCryptoRng, createRuntimeIdentityProvider } from "../worker/runtimeIdentity.ts";
import type { DurableObjectStateLike, WorkerEnv } from "../worker/runtimeTypes.ts";

type WebSocketPairConstructor = new () => {
  0: RoomSocketLike;
  1: RoomSocketLike;
};

function isWebSocketUpgrade(request: Request): boolean {
  return request.method === "GET" && request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function createWebSocketPair(): { client: RoomSocketLike; server: RoomSocketLike } {
  const constructor = (globalThis as unknown as { WebSocketPair?: WebSocketPairConstructor }).WebSocketPair;
  if (!constructor) {
    throw new Error("WebSocketPair is not available in this runtime");
  }

  const pair = new constructor();
  return {
    client: pair[0],
    server: pair[1]
  };
}

export class RoomDurableObject {
  private readonly authority: RoomAuthority;
  private readonly env: WorkerEnv;
  private readonly sessions: RoomSessionManager;

  constructor(state: DurableObjectStateLike, env: WorkerEnv) {
    this.env = env;
    this.authority = new RoomAuthority(new DurableObjectRoomStateStore(state.storage));
    this.sessions = new RoomSessionManager(this.authority, () => Date.now(), createCryptoRng());
  }

  async fetch(request: Request): Promise<Response> {
    const rng = createCryptoRng();
    const identity = createRuntimeIdentityProvider(this.env.PIN_SECRET ?? "local-dev-secret", rng);

    if (isWebSocketUpgrade(request) && new URL(request.url).pathname === "/room/live") {
      const url = new URL(request.url);
      const playerId = url.searchParams.get("playerId");
      const reconnectToken = url.searchParams.get("reconnectToken");
      if (!playerId || !reconnectToken) {
        return new Response(JSON.stringify({ ok: false, code: "RECONNECT_TOKEN_INVALID" }), {
          status: 401,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        });
      }

      const pair = createWebSocketPair();
      await this.sessions.connectSocket({
        socket: pair.server,
        playerId,
        reconnectToken,
        identity,
        now: Date.now()
      });

      return new Response(null, {
        status: 101,
        webSocket: pair.client
      } as ResponseInit & { webSocket: RoomSocketLike });
    }

    return handleRoomHttpRequest(request, {
      authority: this.authority,
      identity,
      now: () => Date.now(),
      rng
    });
  }
}
