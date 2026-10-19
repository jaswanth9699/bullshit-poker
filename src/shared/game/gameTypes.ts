import type { Card } from "../cards/cardTypes.ts";
import type { Claim } from "../claims/claimTypes.ts";

export type GamePhase =
  | "Lobby"
  | "Starting"
  | "RoundActive"
  | "ResolvingRound"
  | "GameOver"
  | "Abandoned"
  | "Closed";

export type PlayerDeparture = {
  matchId: string;
  requestId: string;
  leftAt: number;
  reason: "VOLUNTARY";
};

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
  ready?: boolean;
  leftAt?: number;
  departure?: PlayerDeparture;
  roundCards: Card[];
};

export type LeaveReceipt = {
  requestId: string;
  playerId: string;
  matchId: string;
  acceptedAt: number;
  resultingStateRevision: number;
};

export const REACTION_KINDS = [
  "NICE_BLUFF",
  "SUSPICIOUS",
  "BOLD",
  "WOW",
  "GOOD_CALL",
] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export type ReactionEvent = {
  id: string;
  requestId: string;
  playerId: string;
  kind: ReactionKind;
  createdAt: number;
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
  closedBy?:
    | "BULLSHIT_CALL"
    | "NEXT_CLAIM"
    | "FINAL_CLAIM"
    | "TIMEOUT"
    | "ROUND_CANCELLED";
};

export type RoundResultReason =
  | "BULLSHIT_CALL"
  | "FINAL_CLAIM"
  | "TIMEOUT"
  | "NO_LEGAL_CLAIM";

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
  socialRevision?: number;
  matchId?: string;
  hostPlayerId: string;
  players: PlayerState[];
  playerCredentials?: PlayerCredential[];
  roundNumber: number;
  roundParticipantIds?: string[];
  startingPlayerId?: string;
  finalDecisionPlayerId?: string;
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
  matchEndedReason?: "LAST_PLAYER_STANDING" | "HOST_ENDED" | "ABANDONED";
  endedByPlayerId?: string;
  endedAt?: number;
  leaveReceipts?: LeaveReceipt[];
  reactions?: ReactionEvent[];
  matchNumber?: number;
};

export type ResolutionResult = {
  state: GameState;
  roundResult: RoundResult;
};
