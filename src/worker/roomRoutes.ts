import {
  createPrivateGameView,
  createPublicGameView,
} from "../shared/index.ts";
import type {
  AddBotInput,
  CallBullshitPayload,
  ClientActionEnvelope,
  CreateRoomInput,
  JoinRoomInput,
  LifecycleResult,
  RemovePlayerInput,
  Rng,
  RoomIdentityProvider,
  ServerActionResult,
  StartGameInput,
  SubmitClaimPayload,
} from "../shared/index.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RoomRouteAuthority = {
  createRoom(input: CreateRoomInput): Promise<LifecycleResult>;
  joinRoom(input: JoinRoomInput): Promise<LifecycleResult>;
  addBot(input: AddBotInput): Promise<LifecycleResult>;
  removePlayer(input: RemovePlayerInput): Promise<LifecycleResult>;
  startGame(
    hostPlayerId: string,
    now: number,
    rng: Rng,
  ): Promise<LifecycleResult>;
  advanceToNextRound(now: number, rng: Rng): Promise<LifecycleResult>;
  submitClaim(
    envelope: ClientActionEnvelope<SubmitClaimPayload>,
    now: number,
  ): Promise<ServerActionResult>;
  callBullshit(
    envelope: ClientActionEnvelope<CallBullshitPayload>,
    now: number,
  ): Promise<ServerActionResult>;
  timeout(turnId: string, now: number): Promise<ServerActionResult>;
};

export type RoomRouteContext = {
  authority: RoomRouteAuthority;
  identity: RoomIdentityProvider;
  now: () => number;
  rng: Rng;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ ok: false, code }, status);
}

function lifecycleWireResult(
  result: LifecycleResult,
  viewerPlayerId?: string,
): unknown {
  if (!result.ok) return result;

  const { state, ...rest } = result;
  return {
    ...rest,
    view: viewerPlayerId
      ? createPrivateGameView(state, viewerPlayerId)
      : createPublicGameView(state),
  };
}

function actionWireResult(
  result: ServerActionResult,
  viewerPlayerId?: string,
): unknown {
  if (!result.ok) return result;

  const { state, ...rest } = result;
  return {
    ...rest,
    view: viewerPlayerId
      ? createPrivateGameView(state, viewerPlayerId)
      : createPublicGameView(state),
  };
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value = (await request.json()) as JsonValue;
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

export async function handleRoomHttpRequest(
  request: Request,
  context: RoomRouteContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", 405);
  }

  const body = await readJsonObject(request);
  if (!body) {
    return errorResponse("INVALID_JSON", 400);
  }

  const path = new URL(request.url).pathname;
  const now = context.now();

  switch (path) {
    case "/room/create": {
      const roomId = stringField(body, "roomId");
      const code = stringField(body, "code");
      const hostName = stringField(body, "hostName");
      const pin = stringField(body, "pin");
      if (!roomId || !code || !hostName || !pin) {
        return errorResponse("INVALID_CREATE_ROOM_REQUEST", 400);
      }

      const result = await context.authority.createRoom({
        roomId,
        code,
        hostName,
        pin,
        now,
        identity: context.identity,
      });
      return jsonResponse(
        lifecycleWireResult(result, result.ok ? result.playerId : undefined),
      );
    }

    case "/room/join": {
      const name = stringField(body, "name");
      const pin = stringField(body, "pin");
      if (!name || !pin) {
        return errorResponse("INVALID_JOIN_ROOM_REQUEST", 400);
      }

      const result = await context.authority.joinRoom({
        name,
        pin,
        now,
        identity: context.identity,
      });
      return jsonResponse(
        lifecycleWireResult(result, result.ok ? result.playerId : undefined),
      );
    }

    case "/room/bots/add": {
      const hostPlayerId = stringField(body, "hostPlayerId");
      if (!hostPlayerId) {
        return errorResponse("INVALID_ADD_BOT_REQUEST", 400);
      }

      const result = await context.authority.addBot({
        hostPlayerId,
        name: stringField(body, "name") ?? undefined,
        now,
        identity: context.identity,
      });
      return jsonResponse(lifecycleWireResult(result, hostPlayerId));
    }

    case "/room/bots/remove": {
      const hostPlayerId = stringField(body, "hostPlayerId");
      const botPlayerId = stringField(body, "botPlayerId");
      if (!hostPlayerId || !botPlayerId) {
        return errorResponse("INVALID_REMOVE_BOT_REQUEST", 400);
      }

      const result = await context.authority.removePlayer({
        hostPlayerId,
        targetPlayerId: botPlayerId,
        now,
      });
      return jsonResponse(lifecycleWireResult(result, hostPlayerId));
    }

    case "/room/players/remove": {
      const hostPlayerId = stringField(body, "hostPlayerId");
      const targetPlayerId = stringField(body, "targetPlayerId");
      if (!hostPlayerId || !targetPlayerId) {
        return errorResponse("INVALID_REMOVE_PLAYER_REQUEST", 400);
      }

      const result = await context.authority.removePlayer({
        hostPlayerId,
        targetPlayerId,
        now,
      });
      return jsonResponse(lifecycleWireResult(result, hostPlayerId));
    }

    case "/room/start": {
      const hostPlayerId = stringField(body, "hostPlayerId");
      if (!hostPlayerId) {
        return errorResponse("INVALID_START_GAME_REQUEST", 400);
      }

      const result = await context.authority.startGame(
        hostPlayerId,
        now,
        context.rng,
      );
      return jsonResponse(lifecycleWireResult(result, hostPlayerId));
    }

    case "/room/next-round": {
      const playerId = stringField(body, "playerId");
      const result = await context.authority.advanceToNextRound(
        now,
        context.rng,
      );
      return jsonResponse(lifecycleWireResult(result, playerId ?? undefined));
    }

    case "/room/actions/submit-claim": {
      const envelope =
        body.envelope as ClientActionEnvelope<SubmitClaimPayload>;
      return jsonResponse(
        actionWireResult(
          await context.authority.submitClaim(envelope, now),
          envelope?.playerId,
        ),
      );
    }

    case "/room/actions/call-bullshit": {
      const envelope =
        body.envelope as ClientActionEnvelope<CallBullshitPayload>;
      return jsonResponse(
        actionWireResult(
          await context.authority.callBullshit(envelope, now),
          envelope?.playerId,
        ),
      );
    }

    case "/room/actions/timeout": {
      const turnId = stringField(body, "turnId");
      if (!turnId) {
        return errorResponse("INVALID_TIMEOUT_REQUEST", 400);
      }

      return jsonResponse(
        actionWireResult(await context.authority.timeout(turnId, now)),
      );
    }

    default:
      return errorResponse("NOT_FOUND", 404);
  }
}
