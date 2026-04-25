import { compareClaims } from "../claims/compareClaims.ts";
import { evaluateClaim, findClaimProof } from "../claims/evaluateClaim.ts";
import type { Claim } from "../claims/claimTypes.ts";
import type { GameState, PlayerState, ResolutionResult, RoundResult, RoundResultReason } from "./gameTypes.ts";
import { determineNextRoundStarter } from "./seatOrder.ts";

function activePlayers(players: readonly PlayerState[]): PlayerState[] {
  return players.filter((player) => !player.eliminated && player.leftAt === undefined);
}

function revealedHands(players: readonly PlayerState[]): RoundResult["revealedHands"] {
  return activePlayers(players).map((player) => ({
    playerId: player.id,
    cards: [...player.roundCards]
  }));
}

function activeRoundCards(players: readonly PlayerState[]) {
  return activePlayers(players).flatMap((player) => player.roundCards);
}

function applyPenalty(players: readonly PlayerState[], penaltyPlayerId?: string): PlayerState[] {
  if (!penaltyPlayerId) {
    return players.map((player) => ({ ...player }));
  }

  return players.map((player) => {
    if (player.id !== penaltyPlayerId) {
      return { ...player };
    }

    const cardCount = player.cardCount + 1;
    return {
      ...player,
      cardCount,
      eliminated: cardCount > 5
    };
  });
}

function winnerId(players: readonly PlayerState[]): string | undefined {
  const active = activePlayers(players);
  return active.length === 1 ? active[0].id : undefined;
}

function resultId(state: GameState, reason: RoundResultReason): string {
  return `${state.roomId}:round:${state.roundNumber}:${reason}`;
}

function baseResolvedState(state: GameState, players: PlayerState[], roundResult: RoundResult): GameState {
  const winnerPlayerId = winnerId(players);

  return {
    ...state,
    phase: winnerPlayerId ? "GameOver" : "ResolvingRound",
    stateRevision: state.stateRevision + 1,
    players,
    currentTurnPlayerId: undefined,
    currentTurnId: undefined,
    currentClaim: undefined,
    activeClaimWindow: undefined,
    turnStartedAt: undefined,
    turnExpiresAt: undefined,
    lastRoundResult: roundResult,
    winnerPlayerId
  };
}

function nextStarterAfterResolution(state: GameState, players: readonly PlayerState[]): string | undefined {
  if (!state.startingPlayerId) {
    throw new Error("Cannot resolve round without startingPlayerId");
  }

  return determineNextRoundStarter(players, state.startingPlayerId) ?? undefined;
}

function buildRoundResult(params: {
  state: GameState;
  reason: RoundResultReason;
  claim?: Claim;
  callerPlayerId?: string;
  claimantPlayerId?: string;
  claimWasTrue?: boolean;
  penaltyPlayerId?: string;
  noPenaltyReason?: "TRUE_FINAL_CLAIM";
  proofCardIds?: string[];
  updatedPlayers: PlayerState[];
  now: number;
}): RoundResult {
  const previouslyEliminated = new Set(params.state.players.filter((player) => player.eliminated).map((player) => player.id));
  const eliminatedPlayerIds = params.updatedPlayers
    .filter((player) => player.eliminated && !previouslyEliminated.has(player.id))
    .map((player) => player.id);

  return {
    id: resultId(params.state, params.reason),
    roundNumber: params.state.roundNumber,
    reason: params.reason,
    claim: params.claim,
    finalClaimId: params.reason === "FINAL_CLAIM" ? params.claim?.id : undefined,
    callerPlayerId: params.callerPlayerId,
    claimantPlayerId: params.claimantPlayerId,
    claimWasTrue: params.claimWasTrue,
    penaltyPlayerId: params.penaltyPlayerId,
    noPenaltyReason: params.noPenaltyReason,
    proofCardIds: params.proofCardIds,
    revealedHands: revealedHands(params.state.players),
    eliminatedPlayerIds,
    nextStartingPlayerId: nextStarterAfterResolution(params.state, params.updatedPlayers),
    narrativeKey: narrativeKey(params.reason, params.claimWasTrue, params.noPenaltyReason),
    createdAt: params.now
  };
}

function narrativeKey(
  reason: RoundResultReason,
  claimWasTrue?: boolean,
  noPenaltyReason?: "TRUE_FINAL_CLAIM"
): string {
  if (reason === "BULLSHIT_CALL") {
    return claimWasTrue ? "PLAYER_CALLED_BULLSHIT_AND_CLAIM_WAS_TRUE" : "PLAYER_CALLED_BULLSHIT_AND_CLAIM_WAS_FALSE";
  }
  if (reason === "FINAL_CLAIM") {
    return noPenaltyReason === "TRUE_FINAL_CLAIM" ? "FINAL_CLAIM_TRUE_NO_PENALTY" : "FINAL_CLAIM_FALSE";
  }
  if (reason === "TIMEOUT") {
    return "PLAYER_TIMED_OUT";
  }
  return "NO_LEGAL_CLAIM";
}

export function resolveBullshitCall(state: GameState, callerPlayerId: string, now: number): ResolutionResult {
  if (!state.currentClaim) {
    throw new Error("Cannot call BullShit without a current claim");
  }
  if (!state.activeClaimWindow || state.activeClaimWindow.status !== "OPEN") {
    throw new Error("Cannot call BullShit without an open claim response window");
  }
  if (state.currentClaim.playerId === callerPlayerId) {
    throw new Error("Claimant cannot call BullShit on their own claim");
  }
  if (!activePlayers(state.players).some((player) => player.id === callerPlayerId)) {
    throw new Error("Only an active player can call BullShit");
  }

  const cards = activeRoundCards(state.players);
  const claimWasTrue = evaluateClaim(state.currentClaim, cards);
  const penaltyPlayerId = claimWasTrue ? callerPlayerId : state.currentClaim.playerId;
  const updatedPlayers = applyPenalty(state.players, penaltyPlayerId);
  const proof = claimWasTrue ? findClaimProof(state.currentClaim, cards) : null;

  const roundResult = buildRoundResult({
    state,
    reason: "BULLSHIT_CALL",
    claim: state.currentClaim,
    callerPlayerId,
    claimantPlayerId: state.currentClaim.playerId,
    claimWasTrue,
    penaltyPlayerId,
    proofCardIds: proof?.map((card) => card.id),
    updatedPlayers,
    now
  });

  return {
    state: baseResolvedState(state, updatedPlayers, roundResult),
    roundResult
  };
}

export function resolveFinalClaim(state: GameState, finalClaim: Claim, now: number): ResolutionResult {
  if (!state.currentClaim) {
    throw new Error("Cannot make final claim without a current claim");
  }
  if (!state.startingPlayerId || state.currentTurnPlayerId !== state.startingPlayerId) {
    throw new Error("Only the round starting player can make a final claim");
  }
  if (finalClaim.playerId !== state.startingPlayerId) {
    throw new Error("Final claim must be submitted by the round starting player");
  }
  if (compareClaims(finalClaim, state.currentClaim) !== 1) {
    throw new Error("Final claim must be strictly higher than current claim");
  }

  const cards = activeRoundCards(state.players);
  const claimWasTrue = evaluateClaim(finalClaim, cards);
  const penaltyPlayerId = claimWasTrue ? undefined : finalClaim.playerId;
  const updatedPlayers = applyPenalty(state.players, penaltyPlayerId);
  const proof = claimWasTrue ? findClaimProof(finalClaim, cards) : null;

  const roundResult = buildRoundResult({
    state,
    reason: "FINAL_CLAIM",
    claim: finalClaim,
    claimantPlayerId: finalClaim.playerId,
    claimWasTrue,
    penaltyPlayerId,
    noPenaltyReason: claimWasTrue ? "TRUE_FINAL_CLAIM" : undefined,
    proofCardIds: proof?.map((card) => card.id),
    updatedPlayers,
    now
  });

  return {
    state: baseResolvedState(state, updatedPlayers, roundResult),
    roundResult
  };
}

export function resolveTimeout(state: GameState, now: number): ResolutionResult {
  if (!state.currentTurnPlayerId) {
    throw new Error("Cannot resolve timeout without currentTurnPlayerId");
  }

  const updatedPlayers = applyPenalty(state.players, state.currentTurnPlayerId);
  const roundResult = buildRoundResult({
    state,
    reason: "TIMEOUT",
    penaltyPlayerId: state.currentTurnPlayerId,
    updatedPlayers,
    now
  });

  return {
    state: baseResolvedState(state, updatedPlayers, roundResult),
    roundResult
  };
}
