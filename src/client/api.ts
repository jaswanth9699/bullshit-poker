import type {
  ClientActionEnvelope,
  PrivateGameView,
  RoomClientMessage,
  RoomServerMessage,
  SubmitClaimPayload,
  CallBullshitPayload,
} from "../shared/index.ts";

export type SeatCredential = {
  code: string;
  playerId: string;
  reconnectToken: string;
  name: string;
};

export type LifecycleWireResult =
  | {
      ok: true;
      view: PrivateGameView;
      playerId?: string;
      reconnectToken?: string;
      reclaimed?: boolean;
    }
  | {
      ok: false;
      code: string;
      latestStateRevision: number;
    };

export type ActionWireResult =
  | {
      ok: true;
      view: PrivateGameView;
      newStateRevision: number;
    }
  | {
      ok: false;
      code: string;
      latestStateRevision: number;
    };

async function postJson<TResponse>(
  path: string,
  body: unknown,
): Promise<TResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = (await response.json()) as TResponse;
  if (!response.ok) {
    return result;
  }
  return result;
}

export function createRoom(
  hostName: string,
  pin: string,
): Promise<LifecycleWireResult> {
  return postJson("/api/rooms", { hostName, pin });
}

export function joinRoom(
  code: string,
  name: string,
  pin: string,
): Promise<LifecycleWireResult> {
  return postJson(`/api/rooms/${encodeURIComponent(code)}/join`, { name, pin });
}

export function addBotHttp(
  code: string,
  hostPlayerId: string,
  name?: string,
): Promise<LifecycleWireResult> {
  return postJson(`/api/rooms/${encodeURIComponent(code)}/bots/add`, {
    hostPlayerId,
    name,
  });
}

export function removePlayerHttp(
  code: string,
  hostPlayerId: string,
  targetPlayerId: string,
): Promise<LifecycleWireResult> {
  return postJson(`/api/rooms/${encodeURIComponent(code)}/players/remove`, {
    hostPlayerId,
    targetPlayerId,
  });
}

export function startGameHttp(
  code: string,
  hostPlayerId: string,
): Promise<LifecycleWireResult> {
  return postJson(`/api/rooms/${encodeURIComponent(code)}/start`, {
    hostPlayerId,
  });
}

export function nextRoundHttp(
  code: string,
  playerId: string,
): Promise<LifecycleWireResult> {
  return postJson(`/api/rooms/${encodeURIComponent(code)}/next-round`, {
    playerId,
  });
}

export function submitClaimHttp(
  code: string,
  envelope: ClientActionEnvelope<SubmitClaimPayload>,
): Promise<ActionWireResult> {
  return postJson(
    `/api/rooms/${encodeURIComponent(code)}/actions/submit-claim`,
    { envelope },
  );
}

export function callBullshitHttp(
  code: string,
  envelope: ClientActionEnvelope<CallBullshitPayload>,
): Promise<ActionWireResult> {
  return postJson(
    `/api/rooms/${encodeURIComponent(code)}/actions/call-bullshit`,
    { envelope },
  );
}

export function connectRoomSocket(
  credential: SeatCredential,
  onMessage: (message: RoomServerMessage) => void,
  onStatus: (status: "connecting" | "open" | "closed" | "error") => void,
): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(
    `${protocol}//${window.location.host}/api/rooms/${encodeURIComponent(credential.code)}/live`,
  );
  url.searchParams.set("playerId", credential.playerId);
  url.searchParams.set("reconnectToken", credential.reconnectToken);

  onStatus("connecting");
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => onStatus("open"));
  socket.addEventListener("close", () => onStatus("closed"));
  socket.addEventListener("error", () => onStatus("error"));
  socket.addEventListener("message", (event) => {
    try {
      onMessage(JSON.parse(event.data) as RoomServerMessage);
    } catch {
      onStatus("error");
    }
  });
  return socket;
}

export function sendRoomMessage(
  socket: WebSocket | null,
  message: RoomClientMessage,
): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}
