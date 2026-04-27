import type { Card } from "../cards/cardTypes.ts";
import type { GameState, PlayerState } from "./gameTypes.ts";

export type PublicPlayerView = Omit<PlayerState, "normalizedName" | "roundCards">;

export type PublicGameView = Omit<GameState, "players" | "playerCredentials"> & {
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
    leftAt: player.leftAt
  };
}

export function createPublicGameView(state: GameState): PublicGameView {
  return {
    roomId: state.roomId,
    code: state.code,
    phase: state.phase,
    stateRevision: state.stateRevision,
    hostPlayerId: state.hostPlayerId,
    players: state.players.map(publicPlayerView),
    roundNumber: state.roundNumber,
    startingPlayerId: state.startingPlayerId,
    currentTurnPlayerId: state.currentTurnPlayerId,
    currentTurnId: state.currentTurnId,
    currentClaim: state.currentClaim,
    activeClaimWindow: state.activeClaimWindow,
    claimHistory: [...state.claimHistory],
    turnStartedAt: state.turnStartedAt,
    turnExpiresAt: state.turnExpiresAt,
    turnDurationMs: state.turnDurationMs,
    lastRoundResult: state.lastRoundResult,
    winnerPlayerId: state.winnerPlayerId
  };
}

export function createPrivateGameView(state: GameState, viewerPlayerId: string): PrivateGameView {
  const viewer = state.players.find((player) => player.id === viewerPlayerId);
  const currentClaim = state.currentClaim;
  const viewerIsActive = Boolean(
    viewer && !viewer.eliminated && viewer.leftAt === undefined
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
        viewerIsActive
    )
  };
}
