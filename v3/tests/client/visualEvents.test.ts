import assert from "node:assert/strict";
import test from "node:test";
import type { PrivateGameView } from "../../src/shared/index.ts";
import {
  deriveVisualEvents,
  visualEventBus,
} from "../../src/client/visualEvents.ts";

function view(overrides: Partial<PrivateGameView> = {}): PrivateGameView {
  return {
    roomId: "room-v3",
    code: "V3ROOM",
    phase: "RoundActive",
    stateRevision: 1,
    socialRevision: 0,
    matchId: "room-v3:match:1",
    hostPlayerId: "a",
    players: [],
    roundNumber: 1,
    claimHistory: [],
    turnDurationMs: 0,
    viewerPlayerId: "a",
    viewerCards: [],
    isViewerHost: true,
    canViewerAct: true,
    canViewerCallBullShit: false,
    ...overrides,
  };
}

test("first visual snapshot synchronizes without replaying historical actions", () => {
  const events = deriveVisualEvents(
    null,
    view({
      currentClaim: {
        id: "claim-old",
        handType: "PAIR",
        primaryRank: "8",
      },
    }),
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    ["SYNC"],
  );
});

test("accepted claim produces one deterministic claim event", () => {
  const previous = view();
  const next = view({
    stateRevision: 2,
    currentClaim: {
      id: "claim-2",
      sequence: 1,
      playerId: "b",
      handType: "THREE_OF_A_KIND",
      primaryRank: "A",
    },
  });
  const events = deriveVisualEvents(previous, next);
  assert.deepEqual(
    events.map((event) => event.kind),
    ["CLAIM_ACCEPTED"],
  );
  assert.match(events[0].id, /claim-2/);
});

test("BullShit resolution emits impact, reveal, penalty, elimination, and winner", () => {
  const previous = view();
  const next = view({
    phase: "GameOver",
    stateRevision: 4,
    winnerPlayerId: "a",
    lastRoundResult: {
      id: "result-1",
      roundNumber: 1,
      reason: "BULLSHIT_CALL",
      callerPlayerId: "a",
      claimantPlayerId: "b",
      claimWasTrue: false,
      penaltyPlayerId: "b",
      revealedHands: [],
      eliminatedPlayerIds: ["b"],
      narrativeKey: "FALSE_CLAIM",
      createdAt: 1,
    },
  });
  assert.deepEqual(
    deriveVisualEvents(previous, next).map((event) => event.kind),
    [
      "BULLSHIT_CALLED",
      "ROUND_REVEALED",
      "PENALTY_DEALT",
      "PLAYER_ELIMINATED",
      "MATCH_ENDED",
    ],
  );
});

test("visual event bus delivers each event id only once", () => {
  visualEventBus.reset();
  const received: string[] = [];
  const unsubscribe = visualEventBus.subscribe((event) =>
    received.push(event.id),
  );
  const event = deriveVisualEvents(null, view())[0];
  visualEventBus.publish([event, event]);
  visualEventBus.publish([event]);
  unsubscribe();
  assert.deepEqual(received, [event.id]);
});

test("duplicate and stale snapshots cannot replay claim or reaction events", () => {
  const current = view({ stateRevision: 5, socialRevision: 3 });
  const staleClaim = {
    id: "old",
    handType: "PAIR" as const,
    primaryRank: "2" as const,
  };
  assert.deepEqual(
    deriveVisualEvents(
      current,
      view({ stateRevision: 4, currentClaim: staleClaim }),
    ),
    [],
  );
  assert.deepEqual(
    deriveVisualEvents(
      current,
      view({ stateRevision: 5, socialRevision: 2, currentClaim: staleClaim }),
    ),
    [],
  );
  assert.deepEqual(deriveVisualEvents(current, { ...current }), []);
});

test("reactions require a new social revision and rematches only synchronize", () => {
  const current = view({ stateRevision: 5, socialRevision: 1 });
  const reacted = view({
    stateRevision: 5,
    socialRevision: 2,
    reactions: [
      {
        id: "reaction-2",
        requestId: "react",
        kind: "WOW",
        playerId: "a",
        createdAt: 100,
      },
    ],
  });
  assert.deepEqual(
    deriveVisualEvents(current, reacted).map((event) => event.kind),
    ["REACTION"],
  );
  assert.deepEqual(
    deriveVisualEvents(reacted, { ...reacted, stateRevision: 6 }).map(
      (event) => event.kind,
    ),
    [],
  );
  assert.deepEqual(
    deriveVisualEvents(reacted, {
      ...reacted,
      stateRevision: 6,
      matchId: "new-match",
    }).map((event) => event.kind),
    ["SYNC"],
  );
});

test("failing decorative subscribers cannot stop other listeners or room updates", () => {
  visualEventBus.reset();
  const received: string[] = [];
  const failing = visualEventBus.subscribe(() => {
    throw new Error("renderer failure");
  });
  const working = visualEventBus.subscribe((event) => received.push(event.id));
  const event = deriveVisualEvents(null, view())[0];
  assert.doesNotThrow(() => visualEventBus.publish([event]));
  assert.deepEqual(received, [event.id]);
  failing();
  working();
});
