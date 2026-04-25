import type { ServerErrorCode } from "./errors.ts";
import type { PrivateGameView } from "./views.ts";
import type {
  CallBullshitPayload,
  ClientActionEnvelope,
  SubmitClaimPayload,
} from "./protocol.ts";
import type { RoundResult } from "./gameTypes.ts";

export type SubmitClaimClientMessage = {
  type: "SUBMIT_CLAIM";
  envelope: ClientActionEnvelope<SubmitClaimPayload>;
};

export type CallBullShitClientMessage = {
  type: "CALL_BULLSHIT";
  envelope: ClientActionEnvelope<CallBullshitPayload>;
};

export type ExpireTurnClientMessage = {
  type: "EXPIRE_TURN";
  requestId: string;
  turnId: string;
};

export type RequestSyncClientMessage = {
  type: "REQUEST_SYNC";
  requestId: string;
};

export type AddBotClientMessage = {
  type: "ADD_BOT";
  requestId: string;
  name?: string;
};

export type RemoveBotClientMessage = {
  type: "REMOVE_BOT";
  requestId: string;
  botPlayerId: string;
};

export type RemovePlayerClientMessage = {
  type: "REMOVE_PLAYER";
  requestId: string;
  targetPlayerId: string;
};

export type StartGameClientMessage = {
  type: "START_GAME";
  requestId: string;
};

export type StartNextRoundClientMessage = {
  type: "START_NEXT_ROUND";
  requestId: string;
};

export type ClientPingMessage = {
  type: "PING";
  requestId: string;
};

export type RoomClientMessage =
  | SubmitClaimClientMessage
  | CallBullShitClientMessage
  | ExpireTurnClientMessage
  | RequestSyncClientMessage
  | AddBotClientMessage
  | RemoveBotClientMessage
  | RemovePlayerClientMessage
  | StartGameClientMessage
  | StartNextRoundClientMessage
  | ClientPingMessage;

export type SessionAcceptedServerMessage = {
  type: "SESSION_ACCEPTED";
  sessionId: string;
  playerId: string;
  view: PrivateGameView;
};

export type SessionRejectedServerMessage = {
  type: "SESSION_REJECTED";
  code: ServerErrorCode;
  latestStateRevision: number;
};

export type RoomUpdatedReason =
  | "CONNECTED"
  | "DISCONNECTED"
  | "ACTION_ACCEPTED"
  | "TURN_TIMEOUT"
  | "AUTO_NEXT_ROUND"
  | "SYNC_REQUESTED";

export type RoomUpdatedServerMessage = {
  type: "ROOM_UPDATED";
  reason: RoomUpdatedReason;
  requestId?: string;
  acceptedByPlayerId?: string;
  roundResult?: RoundResult;
  view: PrivateGameView;
};

export type ActionRejectedServerMessage = {
  type: "ACTION_REJECTED";
  requestId?: string;
  code: ServerErrorCode;
  latestStateRevision: number;
  view?: PrivateGameView;
};

export type PongServerMessage = {
  type: "PONG";
  requestId: string;
};

export type RoomServerMessage =
  | SessionAcceptedServerMessage
  | SessionRejectedServerMessage
  | RoomUpdatedServerMessage
  | ActionRejectedServerMessage
  | PongServerMessage;
