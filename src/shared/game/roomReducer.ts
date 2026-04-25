import { compareClaims, normalizeClaimShape, validateClaimShape } from "../claims/compareClaims.ts";
import type { Claim } from "../claims/claimTypes.ts";
import { resolveBullshitCall, resolveFinalClaim, resolveTimeout } from "./roundResolution.ts";
import { advanceToNextActivePlayer } from "./seatOrder.ts";
import type { ClientActionEnvelope, ServerActionResult, SubmitClaimPayload, CallBullshitPayload } from "./protocol.ts";
import type { GameState, PlayerState, ResolutionResult } from "./gameTypes.ts";
import type { ServerErrorCode } from "./errors.ts";

export const DEFAULT_TURN_DURATION_MS = 120_000;

function error(state: GameState, code: ServerErrorCode): ServerActionResult {
  return {
    ok: false,
    code,
    latestStateRevision: state.stateRevision
  };
}

function success(state: GameState, roundResult?: ResolutionResult["roundResult"]): ServerActionResult {
  return {
    ok: true,
    state,
    newStateRevision: state.stateRevision,
    roundResult
  };
}

function isActivePlayer(player: PlayerState | undefined): player is PlayerState {
  return Boolean(player && !player.eliminated && player.leftAt === undefined);
}

function findPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

function ensureBaseActionIsValid<TPayload>(
  state: GameState,
  envelope: ClientActionEnvelope<TPayload>
): ServerErrorCode | null {
  if (state.phase === "GameOver" || state.phase === "Closed" || state.phase === "ResolvingRound") {
    return "ROUND_ALREADY_RESOLVED";
  }
  if (state.phase !== "RoundActive") {
    return "INTERNAL_ERROR";
  }
  if (envelope.roomId !== state.roomId) {
    return "ROOM_NOT_FOUND";
  }
  if (envelope.stateRevision !== state.stateRevision) {
    return "STALE_STATE_REVISION";
  }

  const actor = findPlayer(state, envelope.playerId);
  if (!actor) {
    return "ROOM_NOT_FOUND";
  }
  if (actor.eliminated || actor.leftAt !== undefined) {
    return actor.eliminated ? "PLAYER_ELIMINATED" : "ROOM_NOT_FOUND";
  }

  return null;
}

function ensureTurnActionIsValid<TPayload>(
  state: GameState,
  envelope: ClientActionEnvelope<TPayload>,
  now: number
): ServerErrorCode | null {
  const baseError = ensureBaseActionIsValid(state, envelope);
  if (baseError) return baseError;

  if (state.currentTurnPlayerId !== envelope.playerId) {
    return "NOT_CURRENT_TURN";
  }
  if (!state.currentTurnId || envelope.turnId !== state.currentTurnId) {
    return "STALE_TURN";
  }
  if (state.turnExpiresAt !== undefined && now >= state.turnExpiresAt) {
    return "TURN_EXPIRED";
  }
  return null;
}

function activeClaimWindowMatches(state: GameState, claimWindowId: string | undefined): boolean {
  return Boolean(state.activeClaimWindow && state.activeClaimWindow.status === "OPEN" && state.activeClaimWindow.id === claimWindowId);
}

function claimId(state: GameState, sequence: number): string {
  return `${state.roomId}:round:${state.roundNumber}:claim:${sequence}`;
}

function claimWindowId(state: GameState, claim: Claim): string {
  return `${state.roomId}:round:${state.roundNumber}:window:${claim.sequence}:${claim.id}`;
}

function turnId(state: GameState, playerId: string, sequence: number): string {
  return `${state.roomId}:round:${state.roundNumber}:turn:${playerId}:${sequence}`;
}

function stampClaim(state: GameState, actorPlayerId: string, claim: Claim, now: number): Claim {
  const normalized = normalizeClaimShape(claim);
  const sequence = state.claimHistory.length + 1;

  return {
    ...normalized,
    id: normalized.id ?? claimId(state, sequence),
    sequence,
    playerId: actorPlayerId,
    createdAt: now
  };
}

export function applySubmitClaim(
  state: GameState,
  envelope: ClientActionEnvelope<SubmitClaimPayload>,
  now: number
): ServerActionResult {
  const validationError = ensureTurnActionIsValid(state, envelope, now);
  if (validationError) return error(state, validationError);

  if (state.currentClaim && !activeClaimWindowMatches(state, envelope.claimWindowId)) {
    return error(state, state.activeClaimWindow?.status === "CLOSED" ? "CLAIM_WINDOW_CLOSED" : "STALE_CLAIM_WINDOW");
  }

  let submittedClaim: Claim;
  try {
    submittedClaim = stampClaim(state, envelope.playerId, envelope.payload.claim, now);
    validateClaimShape(submittedClaim);
  } catch {
    return error(state, "INVALID_CLAIM_SHAPE");
  }

  if (state.currentClaim && compareClaims(submittedClaim, state.currentClaim) !== 1) {
    return error(state, "CLAIM_NOT_HIGHER");
  }

  const isFinalClaim = Boolean(state.currentClaim && state.startingPlayerId === envelope.playerId);
  if (isFinalClaim) {
    try {
      const result = resolveFinalClaim(state, submittedClaim, now);
      return success(result.state, result.roundResult);
    } catch {
      return error(state, "INTERNAL_ERROR");
    }
  }

  const nextTurnPlayerId = advanceToNextActivePlayer(state.players, envelope.playerId);
  if (!nextTurnPlayerId) {
    return error(state, "INTERNAL_ERROR");
  }

  const nextTurnSequence = submittedClaim.sequence ?? state.claimHistory.length + 1;
  const nextTurnId = turnId(state, nextTurnPlayerId, nextTurnSequence);

  const nextState: GameState = {
    ...state,
    stateRevision: state.stateRevision + 1,
    currentClaim: submittedClaim,
    activeClaimWindow: {
      id: claimWindowId(state, submittedClaim),
      claimId: submittedClaim.id!,
      roundNumber: state.roundNumber,
      openedByClaimSequence: submittedClaim.sequence!,
      status: "OPEN",
      openedAt: now
    },
    claimHistory: [...state.claimHistory, submittedClaim],
    currentTurnPlayerId: nextTurnPlayerId,
    currentTurnId: nextTurnId,
    turnStartedAt: now,
    turnExpiresAt: now + state.turnDurationMs
  };

  return success(nextState);
}

export function applyCallBullshit(
  state: GameState,
  envelope: ClientActionEnvelope<CallBullshitPayload>,
  now: number
): ServerActionResult {
  const validationError = ensureBaseActionIsValid(state, envelope);
  if (validationError) return error(state, validationError);
  if (!state.currentClaim) return error(state, "NO_CURRENT_CLAIM");
  if (state.currentClaim.playerId === envelope.playerId) return error(state, "CLAIMANT_CANNOT_CALL");
  if (!activeClaimWindowMatches(state, envelope.claimWindowId)) {
    return error(state, state.activeClaimWindow?.status === "CLOSED" ? "CLAIM_WINDOW_CLOSED" : "STALE_CLAIM_WINDOW");
  }

  try {
    const result = resolveBullshitCall(state, envelope.playerId, now);
    return success(result.state, result.roundResult);
  } catch {
    return error(state, "INTERNAL_ERROR");
  }
}

export function applyTimeout(state: GameState, turnIdToExpire: string, now: number): ServerActionResult {
  if (state.phase !== "RoundActive") {
    return error(state, "ROUND_ALREADY_RESOLVED");
  }
  if (state.currentTurnId !== turnIdToExpire) {
    return error(state, "STALE_TURN");
  }
  if (state.turnExpiresAt !== undefined && now < state.turnExpiresAt) {
    return error(state, "STALE_TURN");
  }

  const result = resolveTimeout(state, now);
  return success(result.state, result.roundResult);
}
