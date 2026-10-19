import type { Claim, PrivateGameView, ReactionEvent } from "../shared/index.ts";

export type VisualEvent =
  | {
      id: string;
      kind: "SYNC";
      matchId: string;
      roundNumber: number;
      revision: number;
    }
  | {
      id: string;
      kind: "ROUND_STARTED";
      matchId: string;
      roundNumber: number;
      revision: number;
      startingPlayerId?: string;
    }
  | {
      id: string;
      kind: "CLAIM_ACCEPTED";
      matchId: string;
      roundNumber: number;
      revision: number;
      claim: Claim;
    }
  | {
      id: string;
      kind: "BULLSHIT_CALLED";
      matchId: string;
      roundNumber: number;
      revision: number;
      callerPlayerId?: string;
      claimantPlayerId?: string;
    }
  | {
      id: string;
      kind: "ROUND_REVEALED";
      matchId: string;
      roundNumber: number;
      revision: number;
      resultId: string;
      claimWasTrue?: boolean;
    }
  | {
      id: string;
      kind: "PENALTY_DEALT";
      matchId: string;
      roundNumber: number;
      revision: number;
      playerId: string;
    }
  | {
      id: string;
      kind: "PLAYER_ELIMINATED";
      matchId: string;
      roundNumber: number;
      revision: number;
      playerId: string;
    }
  | {
      id: string;
      kind: "REACTION";
      matchId: string;
      roundNumber: number;
      revision: number;
      reaction: ReactionEvent;
    }
  | {
      id: string;
      kind: "MATCH_ENDED";
      matchId: string;
      roundNumber: number;
      revision: number;
      winnerPlayerId?: string;
    };

export type VisualEventListener = (event: VisualEvent) => void;

function eventId(
  view: PrivateGameView,
  kind: VisualEvent["kind"],
  suffix = "",
): string {
  return [
    view.matchId ?? view.roomId,
    view.roundNumber,
    view.stateRevision,
    kind,
    suffix,
  ]
    .filter(Boolean)
    .join(":");
}

function claimIdentity(claim: Claim | undefined): string | undefined {
  if (!claim) return undefined;
  return claim.id ?? `${claim.sequence ?? ""}:${claim.playerId ?? ""}`;
}

function latestReaction(view: PrivateGameView): ReactionEvent | undefined {
  return view.reactions?.at(-1);
}

export function deriveVisualEvents(
  previous: PrivateGameView | null,
  next: PrivateGameView,
): VisualEvent[] {
  if (
    previous?.roomId === next.roomId &&
    (next.stateRevision < previous.stateRevision ||
      (next.stateRevision === previous.stateRevision &&
        (next.socialRevision ?? 0) <= (previous.socialRevision ?? 0)))
  ) {
    return [];
  }
  const matchId = next.matchId ?? next.roomId;
  const base = {
    matchId,
    roundNumber: next.roundNumber,
    revision: next.stateRevision,
  };

  if (
    !previous ||
    previous.roomId !== next.roomId ||
    previous.matchId !== next.matchId
  ) {
    return [{ id: eventId(next, "SYNC"), kind: "SYNC", ...base }];
  }

  const events: VisualEvent[] = [];
  if (
    previous.roundNumber !== next.roundNumber &&
    next.phase === "RoundActive"
  ) {
    events.push({
      id: eventId(next, "ROUND_STARTED"),
      kind: "ROUND_STARTED",
      ...base,
      startingPlayerId: next.startingPlayerId,
    });
  }

  if (
    next.currentClaim &&
    claimIdentity(previous.currentClaim) !== claimIdentity(next.currentClaim)
  ) {
    events.push({
      id: eventId(next, "CLAIM_ACCEPTED", claimIdentity(next.currentClaim)),
      kind: "CLAIM_ACCEPTED",
      ...base,
      claim: next.currentClaim,
    });
  }

  if (
    next.lastRoundResult &&
    previous.lastRoundResult?.id !== next.lastRoundResult.id
  ) {
    const result = next.lastRoundResult;
    if (result.reason === "BULLSHIT_CALL") {
      events.push({
        id: eventId(next, "BULLSHIT_CALLED", result.id),
        kind: "BULLSHIT_CALLED",
        ...base,
        callerPlayerId: result.callerPlayerId,
        claimantPlayerId: result.claimantPlayerId,
      });
    }
    events.push({
      id: eventId(next, "ROUND_REVEALED", result.id),
      kind: "ROUND_REVEALED",
      ...base,
      resultId: result.id,
      claimWasTrue: result.claimWasTrue,
    });
    if (result.penaltyPlayerId) {
      events.push({
        id: eventId(next, "PENALTY_DEALT", result.penaltyPlayerId),
        kind: "PENALTY_DEALT",
        ...base,
        playerId: result.penaltyPlayerId,
      });
    }
    result.eliminatedPlayerIds.forEach((playerId) => {
      events.push({
        id: eventId(next, "PLAYER_ELIMINATED", playerId),
        kind: "PLAYER_ELIMINATED",
        ...base,
        playerId,
      });
    });
  }

  const priorReaction = latestReaction(previous);
  const reaction = latestReaction(next);
  if (reaction && priorReaction?.id !== reaction.id) {
    events.push({
      id: eventId(next, "REACTION", reaction.id),
      kind: "REACTION",
      ...base,
      reaction,
    });
  }

  if (previous.phase !== "GameOver" && next.phase === "GameOver") {
    events.push({
      id: eventId(next, "MATCH_ENDED", next.winnerPlayerId),
      kind: "MATCH_ENDED",
      ...base,
      winnerPlayerId: next.winnerPlayerId,
    });
  }

  return events;
}

class VisualEventBus {
  private readonly listeners = new Set<VisualEventListener>();
  private readonly deliveredIds = new Set<string>();

  publish(events: readonly VisualEvent[]): void {
    events.forEach((event) => {
      if (this.deliveredIds.has(event.id)) return;
      this.deliveredIds.add(event.id);
      this.listeners.forEach((listener) => {
        try {
          listener(event);
        } catch {
          // A decorative subscriber cannot interrupt authoritative room updates.
          this.listeners.delete(listener);
        }
      });
    });
    if (this.deliveredIds.size > 512) {
      const newest = [...this.deliveredIds].slice(-256);
      this.deliveredIds.clear();
      newest.forEach((id) => this.deliveredIds.add(id));
    }
  }

  subscribe(listener: VisualEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.deliveredIds.clear();
  }
}

export const visualEventBus = new VisualEventBus();
