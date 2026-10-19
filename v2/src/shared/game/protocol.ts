import type { Claim } from "../claims/claimTypes.ts";
import type { GameState, RoundResult } from "./gameTypes.ts";
import type { ServerErrorCode } from "./errors.ts";

export type ClientActionEnvelope<TPayload> = {
  requestId: string;
  roomId: string;
  playerId: string;
  stateRevision: number;
  turnId?: string;
  claimWindowId?: string;
  payload: TPayload;
};

export type SubmitClaimPayload = {
  claim: Claim;
};

export type CallBullshitPayload = Record<string, never>;

export type ServerActionResult =
  | {
      ok: true;
      state: GameState;
      newStateRevision: number;
      roundResult?: RoundResult;
    }
  | {
      ok: false;
      code: ServerErrorCode;
      latestStateRevision: number;
    };
