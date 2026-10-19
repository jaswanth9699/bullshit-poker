import assert from "node:assert/strict";
import test from "node:test";
import { connectRoomSocket, sendRoomMessage } from "../../src/client/api.ts";

test("replacement close is terminal while ordinary network closes remain reconnectable", () => {
  const callbacks = new Map<string, (event: any) => void>();
  const originalSocket = globalThis.WebSocket;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  class SocketStub {
    static OPEN = 1;
    constructor() {}
    addEventListener(kind: string, callback: (event: any) => void) {
      callbacks.set(kind, callback);
    }
  }
  Object.defineProperty(globalThis, "WebSocket", {
    value: SocketStub,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: { location: { protocol: "http:", host: "localhost:8791" } },
    configurable: true,
  });
  try {
    const statuses: string[] = [];
    connectRoomSocket(
      { code: "ROOM01", playerId: "a", reconnectToken: "token", name: "A" },
      () => undefined,
      (status) => statuses.push(status),
    );
    callbacks.get("open")!({});
    callbacks.get("close")!({ code: 4000, reason: "SESSION_REPLACED" });
    callbacks.get("close")!({ code: 1006, reason: "" });
    assert.deepEqual(statuses, ["connecting", "open", "replaced", "closed"]);
  } finally {
    globalThis.WebSocket = originalSocket;
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a socket closing during send reports failure instead of throwing through controls", () => {
  const socket = {
    readyState: WebSocket.OPEN,
    send() {
      throw new Error("closed");
    },
  } as unknown as WebSocket;
  assert.equal(
    sendRoomMessage(socket, { type: "PING", requestId: "test" }),
    false,
  );
  assert.equal(
    sendRoomMessage(null, { type: "PING", requestId: "test" }),
    false,
  );
});
