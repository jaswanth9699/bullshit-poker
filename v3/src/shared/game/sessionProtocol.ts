import type { ServerErrorCode } from "./errors.ts";
import type { PrivateGameView } from "./views.ts";
import type {
  CallBullshitPayload,
  ClientActionEnvelope,
  SubmitClaimPayload,
} from "./protocol.ts";
import type { RoundResult } from "./gameTypes.ts";
import type { ReactionKind } from "./gameTypes.ts";

export type SubmitClaimClientMessage = {
  type: "SUBMIT_CLAIM";
  envelope: ClientActionEnvelope<SubmitClaimPayload>;
};

export type CallBullShitClientMessage = {
  type: "CALL_BULLSHIT";
  envelope: ClientActionEnvelope<CallBullshitPayload>;
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

export type LeaveGameClientMessage = {
  type: "LEAVE_GAME";
  requestId: string;
  matchId: string;
};

export type SetReadyClientMessage = {
  type: "SET_READY";
  requestId: string;
  ready: boolean;
};

export type EndGameClientMessage = {
  type: "END_GAME";
  requestId: string;
  matchId: string;
};

export type StartRematchClientMessage = {
  type: "START_REMATCH";
  requestId: string;
  matchId: string;
};

export type SendReactionClientMessage = {
  type: "SEND_REACTION";
  requestId: string;
  kind: ReactionKind;
};

export type ClientPingMessage = {
  type: "PING";
  requestId: string;
};

export type RoomClientMessage =
  | SubmitClaimClientMessage
  | CallBullShitClientMessage
  | RequestSyncClientMessage
  | AddBotClientMessage
  | RemoveBotClientMessage
  | RemovePlayerClientMessage
  | StartGameClientMessage
  | StartNextRoundClientMessage
  | LeaveGameClientMessage
  | SetReadyClientMessage
  | EndGameClientMessage
  | StartRematchClientMessage
  | SendReactionClientMessage
  | ClientPingMessage;

export type LeaveAcceptedServerMessage = {
  type: "LEAVE_ACCEPTED";
  requestId: string;
  matchId: string;
  roomAbandoned: boolean;
};

export type SeatRemovedServerMessage = {
  type: "SEAT_REMOVED";
  reason: "HOST_REMOVED";
};

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
  | "PLAYER_LEFT"
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
  | LeaveAcceptedServerMessage
  | SeatRemovedServerMessage
  | PongServerMessage;
