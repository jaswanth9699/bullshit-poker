import type { Card } from "../cards/cardTypes.ts";
import type { Claim } from "../claims/claimTypes.ts";

export type GamePhase = "Lobby" | "Starting" | "RoundActive" | "ResolvingRound" | "GameOver" | "Closed";

export type PlayerState = {
  id: string;
  name: string;
  normalizedName: string;
  seatIndex: number;
  avatarKey: string;
  cardCount: number;
  eliminated: boolean;
  connected: boolean;
  isBot: boolean;
  leftAt?: number;
  roundCards: Card[];
};

export type PlayerCredential = {
  playerId: string;
  normalizedName: string;
  pinVerifier: string;
  reconnectTokenHash: string;
};

export type ClaimResponseWindow = {
  id: string;
  claimId: string;
  roundNumber: number;
  openedByClaimSequence: number;
  status: "OPEN" | "CLOSED";
  openedAt: number;
  closedAt?: number;
  closedBy?: "BULLSHIT_CALL" | "NEXT_CLAIM" | "FINAL_CLAIM" | "TIMEOUT" | "ROUND_CANCELLED";
};

export type RoundResultReason = "BULLSHIT_CALL" | "FINAL_CLAIM" | "TIMEOUT" | "NO_LEGAL_CLAIM";

export type RoundResult = {
  id: string;
  roundNumber: number;
  reason: RoundResultReason;
  claim?: Claim;
  finalClaimId?: string;
  callerPlayerId?: string;
  claimantPlayerId?: string;
  claimWasTrue?: boolean;
  penaltyPlayerId?: string;
  noPenaltyReason?: "TRUE_FINAL_CLAIM";
  acceptedBullShitCallActionId?: string;
  rejectedBullShitCallActionIds?: string[];
  proofCardIds?: string[];
  revealedHands: Array<{
    playerId: string;
    cards: Card[];
  }>;
  eliminatedPlayerIds: string[];
  nextStartingPlayerId?: string;
  narrativeKey: string;
  createdAt: number;
};

export type GameState = {
  roomId: string;
  code: string;
  phase: GamePhase;
  stateRevision: number;
  hostPlayerId: string;
  players: PlayerState[];
  playerCredentials?: PlayerCredential[];
  roundNumber: number;
  startingPlayerId?: string;
  currentTurnPlayerId?: string;
  currentTurnId?: string;
  currentClaim?: Claim;
  activeClaimWindow?: ClaimResponseWindow;
  claimHistory: Claim[];
  turnStartedAt?: number;
  turnExpiresAt?: number;
  turnDurationMs: number;
  lastRoundResult?: RoundResult;
  winnerPlayerId?: string;
};

export type ResolutionResult = {
  state: GameState;
  roundResult: RoundResult;
};
