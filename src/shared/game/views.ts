import type { Card } from "../cards/cardTypes.ts";
import type { GameState, PlayerState } from "./gameTypes.ts";

export type PublicPlayerView = Omit<
  PlayerState,
  "normalizedName" | "roundCards" | "departure"
>;

export type PublicGameView = Omit<
  GameState,
  "players" | "playerCredentials" | "leaveReceipts"
> & {
  players: PublicPlayerView[];
};

export type PrivateGameView = PublicGameView & {
  viewerPlayerId: string;
  viewerCards: Card[];
  isViewerHost: boolean;
  canViewerAct: boolean;
  canViewerCallBullShit: boolean;
};

function publicPlayerView(player: PlayerState): PublicPlayerView {
  return {
    id: player.id,
    name: player.name,
    seatIndex: player.seatIndex,
    avatarKey: player.avatarKey,
    cardCount: player.cardCount,
    eliminated: player.eliminated,
    connected: player.connected,
    isBot: player.isBot,
    ready: player.ready,
    leftAt: player.leftAt,
  };
}

export function createPublicGameView(state: GameState): PublicGameView {
  const visiblePlayers =
    state.phase === "Lobby"
      ? state.players.filter((player) => player.leftAt === undefined)
      : state.players;

  return {
    roomId: state.roomId,
    code: state.code,
    phase: state.phase,
    stateRevision: state.stateRevision,
    socialRevision: state.socialRevision,
    matchId: state.matchId,
    matchNumber: state.matchNumber,
    hostPlayerId: state.hostPlayerId,
    players: visiblePlayers.map(publicPlayerView),
    roundNumber: state.roundNumber,
    roundParticipantIds: state.roundParticipantIds,
    startingPlayerId: state.startingPlayerId,
    finalDecisionPlayerId: state.finalDecisionPlayerId,
    currentTurnPlayerId: state.currentTurnPlayerId,
    currentTurnId: state.currentTurnId,
    currentClaim: state.currentClaim,
    activeClaimWindow: state.activeClaimWindow,
    claimHistory: [...state.claimHistory],
    turnStartedAt: state.turnStartedAt,
    turnExpiresAt: state.turnExpiresAt,
    turnDurationMs: state.turnDurationMs,
    lastRoundResult: state.lastRoundResult,
    winnerPlayerId: state.winnerPlayerId,
    matchEndedReason: state.matchEndedReason,
    endedByPlayerId: state.endedByPlayerId,
    endedAt: state.endedAt,
    reactions: state.reactions,
  };
}

export function createPrivateGameView(
  state: GameState,
  viewerPlayerId: string,
): PrivateGameView {
  const viewer = state.players.find((player) => player.id === viewerPlayerId);
  const currentClaim = state.currentClaim;
  const viewerIsActive = Boolean(
    viewer && !viewer.eliminated && viewer.leftAt === undefined,
  );

  return {
    ...createPublicGameView(state),
    viewerPlayerId,
    viewerCards: viewer ? [...viewer.roundCards] : [],
    isViewerHost: state.hostPlayerId === viewerPlayerId,
    canViewerAct:
      viewerIsActive &&
      state.phase === "RoundActive" &&
      state.currentTurnPlayerId === viewerPlayerId,
    canViewerCallBullShit: Boolean(
      state.phase === "RoundActive" &&
      currentClaim &&
      currentClaim.playerId !== viewerPlayerId &&
      state.activeClaimWindow?.status === "OPEN" &&
      viewerIsActive,
    ),
  };
}
