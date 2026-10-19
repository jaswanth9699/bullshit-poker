import {
  REACTION_KINDS,
  createPrivateGameView,
  decideBotAction,
  type BotDecision,
  type CallBullshitPayload,
  type ClientActionEnvelope,
  type GameState,
  type JoinRoomInput,
  type LifecycleResult,
  type PrivateGameView,
  type Rng,
  type RoomClientMessage,
  type RoomIdentityProvider,
  type RoundResult,
  type RoomServerMessage,
  type RoomUpdatedReason,
  type ReactionKind,
  type ServerActionResult,
  type ServerErrorCode,
  type SubmitClaimPayload,
} from "../shared/index.ts";

export type RoomSocketEvent = {
  data?: unknown;
};

export type RoomSocketLike = {
  accept?: () => void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (
    type: "message" | "close" | "error",
    listener: (event: RoomSocketEvent) => void,
  ) => void;
};

export type RoomSessionAuthority = {
  getState(): Promise<GameState | undefined>;
  joinRoom(input: JoinRoomInput): Promise<LifecycleResult>;
  deleteRoom?(): Promise<void>;
  connectPlayer(
    playerId: string,
    reconnectToken: string,
    identity: RoomIdentityProvider,
    now: number,
  ): Promise<LifecycleResult>;
  disconnectPlayer(playerId: string, now: number): Promise<LifecycleResult>;
  leaveGame(input: {
    playerId: string;
    requestId: string;
    matchId: string;
    now: number;
  }): Promise<LifecycleResult>;
  setReady(input: {
    playerId: string;
    ready: boolean;
  }): Promise<LifecycleResult>;
  endGame(input: {
    playerId: string;
    requestId: string;
    matchId: string;
    now: number;
  }): Promise<LifecycleResult>;
  startRematch(input: {
    playerId: string;
    requestId: string;
    matchId: string;
    now: number;
  }): Promise<LifecycleResult>;
  sendReaction(input: {
    playerId: string;
    requestId: string;
    kind: ReactionKind;
    now: number;
  }): Promise<LifecycleResult>;
  advanceToNextRound(now: number, rng: Rng): Promise<LifecycleResult>;
  addBot(input: {
    hostPlayerId: string;
    name?: string;
    now: number;
    identity: RoomIdentityProvider;
  }): Promise<LifecycleResult>;
  removePlayer(input: {
    hostPlayerId: string;
    targetPlayerId: string;
    now: number;
  }): Promise<LifecycleResult>;
  startGame(
    hostPlayerId: string,
    now: number,
    rng: Rng,
    enforceReady?: boolean,
  ): Promise<LifecycleResult>;
  submitClaim(
    envelope: ClientActionEnvelope<SubmitClaimPayload>,
    now: number,
    rng: Rng,
  ): Promise<ServerActionResult>;
  callBullshit(
    envelope: ClientActionEnvelope<CallBullshitPayload>,
    now: number,
    rng: Rng,
  ): Promise<ServerActionResult>;
};

export type SessionConnectResult =
  | {
      ok: true;
      sessionId: string;
      view: PrivateGameView;
    }
  | {
      ok: false;
      code: ServerErrorCode;
      latestStateRevision: number;
    };

type SessionRecord = {
  id: string;
  playerId: string;
  socket: RoomSocketLike;
  identity: RoomIdentityProvider;
  acceptedRequests: Map<string, string>;
  activeRequest?: { requestId: string; fingerprint: string };
};

export type RoomSessionManagerOptions = {
  now?: () => number;
  rng?: Rng;
  botStepLimit?: number;
  botActionMinDelayMs?: number;
  botActionMaxDelayMs?: number;
};

const DEFAULT_BOT_STEP_LIMIT = 20;
const MAX_ACCEPTED_REQUESTS_PER_SESSION = 128;
const DEFAULT_BOT_ACTION_MIN_DELAY_MS = 2_000;
const DEFAULT_BOT_ACTION_MAX_DELAY_MS = 3_000;

function rawMessageData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in raw) {
    return (raw as RoomSocketEvent).data;
  }
  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && !Array.isArray(value) && typeof value === "object");
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasRequestId(value: Record<string, unknown>): boolean {
  return isString(value.requestId);
}

function isActionEnvelope(
  value: unknown,
  action: "SUBMIT_CLAIM" | "CALL_BULLSHIT",
): value is ClientActionEnvelope<SubmitClaimPayload | CallBullshitPayload> {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  if (
    !isString(value.requestId) ||
    !isString(value.roomId) ||
    !isString(value.playerId) ||
    typeof value.stateRevision !== "number" ||
    !Number.isSafeInteger(value.stateRevision) ||
    value.stateRevision < 0
  ) {
    return false;
  }
  if (value.turnId !== undefined && !isString(value.turnId)) return false;
  if (value.claimWindowId !== undefined && !isString(value.claimWindowId)) {
    return false;
  }
  return action === "CALL_BULLSHIT" || isRecord(value.payload.claim);
}

function parseClientMessage(raw: unknown): RoomClientMessage | null {
  const data = rawMessageData(raw);
  if (typeof data !== "string") {
    return null;
  }

  try {
    const value = JSON.parse(data) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    switch (record.type) {
      case "PING":
      case "REQUEST_SYNC":
      case "START_GAME":
      case "START_NEXT_ROUND":
        return hasRequestId(record) ? (record as RoomClientMessage) : null;
      case "ADD_BOT":
        return hasRequestId(record) &&
          (record.name === undefined || typeof record.name === "string")
          ? (record as RoomClientMessage)
          : null;
      case "REMOVE_BOT":
        return hasRequestId(record) && isString(record.botPlayerId)
          ? (record as RoomClientMessage)
          : null;
      case "REMOVE_PLAYER":
        return hasRequestId(record) && isString(record.targetPlayerId)
          ? (record as RoomClientMessage)
          : null;
      case "LEAVE_GAME":
      case "END_GAME":
      case "START_REMATCH":
        return hasRequestId(record) && isString(record.matchId)
          ? (record as RoomClientMessage)
          : null;
      case "SET_READY":
        return hasRequestId(record) && typeof record.ready === "boolean"
          ? (record as RoomClientMessage)
          : null;
      case "SEND_REACTION":
        return hasRequestId(record) &&
          typeof record.kind === "string" &&
          REACTION_KINDS.includes(record.kind as ReactionKind)
          ? (record as RoomClientMessage)
          : null;
      case "SUBMIT_CLAIM":
      case "CALL_BULLSHIT":
        return isActionEnvelope(record.envelope, record.type)
          ? (record as RoomClientMessage)
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function messageRequestId(
  message: RoomClientMessage | null,
): string | undefined {
  if (!message) return undefined;
  if ("requestId" in message && typeof message.requestId === "string")
    return message.requestId;
  if ("envelope" in message && typeof message.envelope?.requestId === "string")
    return message.envelope.requestId;
  return undefined;
}

export class RoomSessionManager {
  private readonly authority: RoomSessionAuthority;
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly botStepLimit: number;
  private readonly botActionMinDelayMs: number;
  private readonly botActionMaxDelayMs: number;
  private readonly sessions = new Map<string, SessionRecord>();
  private sessionCounter = 0;
  private processingBots = false;
  private botActionTimer?: ReturnType<typeof setTimeout>;
  private botActionKey?: string;
  private readonly lastReactionAtByPlayer = new Map<string, number>();
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    authority: RoomSessionAuthority,
    nowOrOptions: (() => number) | RoomSessionManagerOptions = () => Date.now(),
    rng?: Rng,
  ) {
    this.authority = authority;
    if (typeof nowOrOptions === "function") {
      this.now = nowOrOptions;
      this.rng = rng ?? (() => Math.random());
      this.botStepLimit = DEFAULT_BOT_STEP_LIMIT;
      this.botActionMinDelayMs = DEFAULT_BOT_ACTION_MIN_DELAY_MS;
      this.botActionMaxDelayMs = DEFAULT_BOT_ACTION_MAX_DELAY_MS;
    } else {
      this.now = nowOrOptions.now ?? (() => Date.now());
      this.rng = nowOrOptions.rng ?? (() => Math.random());
      this.botStepLimit = nowOrOptions.botStepLimit ?? DEFAULT_BOT_STEP_LIMIT;
      this.botActionMinDelayMs =
        nowOrOptions.botActionMinDelayMs ?? DEFAULT_BOT_ACTION_MIN_DELAY_MS;
      this.botActionMaxDelayMs =
        nowOrOptions.botActionMaxDelayMs ?? DEFAULT_BOT_ACTION_MAX_DELAY_MS;
    }
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  async joinRoom(input: JoinRoomInput): Promise<LifecycleResult> {
    return this.runExclusive(async () => {
      const result = await this.authority.joinRoom(input);
      if (!result.ok) return result;

      // PIN reclaim rotates the credential. Retire its previous connection in
      // the same queue as gameplay, before it can act on the reclaimed seat.
      if (result.reclaimed && result.playerId) {
        this.replaceOpenSessionsForPlayer(result.playerId);
      }
      await this.broadcastState("CONNECTED", result.state);
      await this.processBots();
      return result;
    });
  }

  async connectSocket(params: {
    socket: RoomSocketLike;
    playerId: string;
    reconnectToken: string;
    identity: RoomIdentityProvider;
    now?: number;
  }): Promise<SessionConnectResult> {
    return this.runExclusive(() => this.connectSocketInternal(params));
  }

  private async connectSocketInternal(params: {
    socket: RoomSocketLike;
    playerId: string;
    reconnectToken: string;
    identity: RoomIdentityProvider;
    now?: number;
  }): Promise<SessionConnectResult> {
    params.socket.accept?.();

    let connected = await this.authority.connectPlayer(
      params.playerId,
      params.reconnectToken,
      params.identity,
      params.now ?? this.now(),
    );

    if (!connected.ok) {
      this.sendSocket(params.socket, {
        type: "SESSION_REJECTED",
        code: connected.code,
        latestStateRevision: connected.latestStateRevision,
      });
      params.socket.close?.(1008, connected.code);
      return connected;
    }

    if (connected.state.phase === "ResolvingRound") {
      const recovered = await this.authority.advanceToNextRound(
        params.now ?? this.now(),
        this.rng,
      );
      if (recovered.ok) {
        connected = { ...connected, state: recovered.state };
      }
    }

    this.replaceOpenSessionsForPlayer(params.playerId);

    this.sessionCounter += 1;
    const session: SessionRecord = {
      id: `session-${this.sessionCounter}`,
      playerId: params.playerId,
      socket: params.socket,
      identity: params.identity,
      acceptedRequests: new Map(),
    };

    this.sessions.set(session.id, session);
    this.bindSocket(session);

    const view = createPrivateGameView(connected.state, params.playerId);
    this.send(session, {
      type: "SESSION_ACCEPTED",
      sessionId: session.id,
      playerId: params.playerId,
      view,
    });
    await this.broadcastState("CONNECTED", connected.state, {
      excludeSessionId: session.id,
    });
    await this.processBots();

    return {
      ok: true,
      sessionId: session.id,
      view,
    };
  }

  async handleSocketMessage(
    sessionId: string,
    raw: unknown,
    now: number = this.now(),
  ): Promise<void> {
    return this.runExclusive(async () => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      try {
        await this.handleSocketMessageInternal(session, raw, now);
      } catch {
        if (!this.sessions.has(session.id)) return;
        await this.rejectWithCurrentView(
          session,
          session.activeRequest?.requestId,
          "INTERNAL_ERROR",
        );
      } finally {
        session.activeRequest = undefined;
      }
    });
  }

  private async handleSocketMessageInternal(
    session: SessionRecord,
    raw: unknown,
    now: number,
  ): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) {
      await this.reject(session, {
        requestId: undefined,
        code: "INVALID_MESSAGE",
        latestStateRevision: await this.latestRevision(),
      });
      return;
    }

    if (message.type !== "PING" && message.type !== "REQUEST_SYNC") {
      const requestId = messageRequestId(message)!;
      const fingerprint = JSON.stringify(message);
      const accepted = session.acceptedRequests.get(requestId);
      if (accepted !== undefined) {
        if (accepted !== fingerprint) {
          await this.rejectWithCurrentView(
            session,
            requestId,
            "REQUEST_ID_REUSED",
          );
        } else {
          const view = await this.privateView(session.playerId);
          if (view) {
            this.send(session, {
              type: "ROOM_UPDATED",
              reason: "ACTION_ACCEPTED",
              requestId,
              acceptedByPlayerId: session.playerId,
              view,
            });
          }
        }
        return;
      }
      session.activeRequest = { requestId, fingerprint };
    }

    switch (message.type) {
      case "PING":
        this.send(session, {
          type: "PONG",
          requestId: message.requestId,
        });
        return;

      case "REQUEST_SYNC":
        await this.sendStateToSession(
          session,
          "SYNC_REQUESTED",
          message.requestId,
        );
        return;

      case "ADD_BOT":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.addBot({
            hostPlayerId: session.playerId,
            name: message.name,
            now,
            identity: session.identity,
          }),
        );
        return;

      case "REMOVE_BOT":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.removePlayer({
            hostPlayerId: session.playerId,
            targetPlayerId: message.botPlayerId,
            now,
          }),
        );
        return;

      case "REMOVE_PLAYER":
        await this.handleRemovePlayer(
          session,
          message.requestId,
          message.targetPlayerId,
          now,
        );
        return;

      case "START_GAME":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.startGame(session.playerId, now, this.rng, true),
        );
        return;

      case "START_NEXT_ROUND":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.advanceToNextRound(now, this.rng),
        );
        return;

      case "LEAVE_GAME":
        await this.handleLeaveGame(
          session,
          message.requestId,
          message.matchId,
          now,
        );
        return;

      case "SET_READY":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.setReady({
            playerId: session.playerId,
            ready: message.ready,
          }),
        );
        return;

      case "END_GAME":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.endGame({
            playerId: session.playerId,
            requestId: message.requestId,
            matchId: message.matchId,
            now,
          }),
        );
        return;

      case "START_REMATCH":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.startRematch({
            playerId: session.playerId,
            requestId: message.requestId,
            matchId: message.matchId,
            now,
          }),
        );
        return;

      case "SEND_REACTION":
        await this.handleReaction(
          session,
          message.requestId,
          message.kind,
          now,
        );
        return;

      case "SUBMIT_CLAIM":
        await this.handleSubmitClaim(session, message.envelope, now);
        return;

      case "CALL_BULLSHIT":
        await this.handleCallBullshit(session, message.envelope, now);
        return;

      default:
        await this.reject(session, {
          requestId: messageRequestId(message),
          code: "INVALID_MESSAGE",
          latestStateRevision: await this.latestRevision(),
        });
    }
  }

  async disconnectSession(
    sessionId: string,
    now: number = this.now(),
  ): Promise<void> {
    return this.runExclusive(() =>
      this.disconnectSessionInternal(sessionId, now),
    );
  }

  private async disconnectSessionInternal(
    sessionId: string,
    now: number,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    if (this.hasOpenSessionForPlayer(session.playerId)) {
      return;
    }

    const result = await this.authority.disconnectPlayer(session.playerId, now);
    if (result.ok) {
      await this.broadcastState("DISCONNECTED", result.state);
      await this.processBots();
    }
  }

  private async handleLeaveGame(
    session: SessionRecord,
    requestId: string,
    matchId: string,
    now: number,
  ): Promise<void> {
    const result = await this.authority.leaveGame({
      playerId: session.playerId,
      requestId,
      matchId,
      now,
    });
    if (!result.ok) {
      await this.rejectWithCurrentView(
        session,
        requestId,
        result.code,
        result.latestStateRevision,
      );
      return;
    }

    this.send(session, {
      type: "LEAVE_ACCEPTED",
      requestId,
      matchId,
      roomAbandoned: result.state.phase === "Abandoned",
    });
    this.sessions.delete(session.id);
    await this.broadcastState("PLAYER_LEFT", result.state);
    session.socket.close?.(1000, "PLAYER_LEFT");
    if (result.state.phase === "Abandoned") {
      await this.authority.deleteRoom?.();
    }
    await this.processBots();
  }

  private async handleRemovePlayer(
    session: SessionRecord,
    requestId: string,
    targetPlayerId: string,
    now: number,
  ): Promise<void> {
    const result = await this.authority.removePlayer({
      hostPlayerId: session.playerId,
      targetPlayerId,
      now,
    });
    if (!result.ok) {
      await this.rejectWithCurrentView(
        session,
        requestId,
        result.code,
        result.latestStateRevision,
      );
      return;
    }

    for (const targetSession of [...this.sessions.values()]) {
      if (targetSession.playerId !== targetPlayerId) continue;
      this.sendSocket(targetSession.socket, {
        type: "SEAT_REMOVED",
        reason: "HOST_REMOVED",
      });
      this.sessions.delete(targetSession.id);
      targetSession.socket.close?.(1000, "SEAT_REMOVED");
    }

    await this.broadcastState("ACTION_ACCEPTED", result.state, {
      requestId,
      acceptedByPlayerId: session.playerId,
    });
  }

  private async handleReaction(
    session: SessionRecord,
    requestId: string,
    kind: ReactionKind,
    now: number,
  ): Promise<void> {
    const lastReactionAt = this.lastReactionAtByPlayer.get(session.playerId);
    if (lastReactionAt !== undefined && now - lastReactionAt < 750) {
      await this.rejectWithCurrentView(
        session,
        requestId,
        "REACTION_RATE_LIMITED",
      );
      return;
    }

    const result = await this.authority.sendReaction({
      playerId: session.playerId,
      requestId,
      kind,
      now,
    });
    if (result.ok) {
      this.lastReactionAtByPlayer.set(session.playerId, now);
    }
    await this.handleLifecycleResult(session, requestId, result);
  }

  private async handleSubmitClaim(
    session: SessionRecord,
    envelope: ClientActionEnvelope<SubmitClaimPayload>,
    now: number,
  ): Promise<void> {
    const envelopeRequestId = envelope.requestId;
    if (!this.envelopeBelongsToSession(session, envelope)) {
      await this.rejectWithCurrentView(
        session,
        envelopeRequestId,
        "PLAYER_SESSION_MISMATCH",
      );
      return;
    }

    await this.handleActionResult(
      session,
      envelope.requestId,
      await this.authority.submitClaim(envelope, now, this.rng),
    );
  }

  private async handleCallBullshit(
    session: SessionRecord,
    envelope: ClientActionEnvelope<CallBullshitPayload>,
    now: number,
  ): Promise<void> {
    const envelopeRequestId = envelope.requestId;
    if (!this.envelopeBelongsToSession(session, envelope)) {
      await this.rejectWithCurrentView(
        session,
        envelopeRequestId,
        "PLAYER_SESSION_MISMATCH",
      );
      return;
    }

    await this.handleActionResult(
      session,
      envelope.requestId,
      await this.authority.callBullshit(envelope, now, this.rng),
    );
  }

  private async handleActionResult(
    session: SessionRecord,
    requestId: string | undefined,
    result: ServerActionResult,
  ): Promise<void> {
    if (!result.ok) {
      await this.rejectWithCurrentView(
        session,
        requestId,
        result.code,
        result.latestStateRevision,
      );
      return;
    }

    await this.broadcastState("ACTION_ACCEPTED", result.state, {
      requestId,
      acceptedByPlayerId: session.playerId,
      roundResult: result.roundResult,
    });
    await this.processBots();
  }

  private async handleLifecycleResult(
    session: SessionRecord,
    requestId: string | undefined,
    result: LifecycleResult,
  ): Promise<void> {
    if (!result.ok) {
      await this.rejectWithCurrentView(
        session,
        requestId,
        result.code,
        result.latestStateRevision,
      );
      return;
    }

    await this.broadcastState("ACTION_ACCEPTED", result.state, {
      requestId,
      acceptedByPlayerId: session.playerId,
    });
    await this.processBots();
  }

  private envelopeBelongsToSession<TPayload>(
    session: SessionRecord,
    envelope: ClientActionEnvelope<TPayload> | undefined,
  ): envelope is ClientActionEnvelope<TPayload> {
    return Boolean(envelope && envelope.playerId === session.playerId);
  }

  private bindSocket(session: SessionRecord): void {
    session.socket.addEventListener?.("message", (event) => {
      void this.handleSocketMessage(session.id, event);
    });
    session.socket.addEventListener?.("close", () => {
      void this.disconnectSession(session.id);
    });
    session.socket.addEventListener?.("error", () => {
      void this.disconnectSession(session.id);
    });
  }

  private hasOpenSessionForPlayer(playerId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.playerId === playerId) return true;
    }
    return false;
  }

  private replaceOpenSessionsForPlayer(playerId: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.playerId !== playerId) continue;
      this.sessions.delete(session.id);
      session.socket.close?.(4000, "SESSION_REPLACED");
    }
  }

  private async latestRevision(): Promise<number> {
    return (await this.authority.getState())?.stateRevision ?? 0;
  }

  private async rejectWithCurrentView(
    session: SessionRecord,
    requestId: string | undefined,
    code: ServerErrorCode,
    latestStateRevision?: number,
  ): Promise<void> {
    await this.reject(session, {
      requestId,
      code,
      latestStateRevision: latestStateRevision ?? (await this.latestRevision()),
      view: await this.privateView(session.playerId),
    });
  }

  private async reject(
    session: SessionRecord,
    message: {
      requestId?: string;
      code: ServerErrorCode;
      latestStateRevision: number;
      view?: PrivateGameView;
    },
  ): Promise<void> {
    this.send(session, {
      type: "ACTION_REJECTED",
      requestId: message.requestId,
      code: message.code,
      latestStateRevision: message.latestStateRevision,
      view: message.view,
    });
  }

  private async privateView(
    playerId: string,
  ): Promise<PrivateGameView | undefined> {
    const state = await this.authority.getState();
    return state ? createPrivateGameView(state, playerId) : undefined;
  }

  private async sendStateToSession(
    session: SessionRecord,
    reason: RoomUpdatedReason,
    requestId?: string,
  ): Promise<void> {
    const view = await this.privateView(session.playerId);
    if (!view) {
      await this.reject(session, {
        requestId,
        code: "ROOM_NOT_FOUND",
        latestStateRevision: 0,
      });
      return;
    }

    this.send(session, {
      type: "ROOM_UPDATED",
      reason,
      requestId,
      view,
    });
  }

  private async broadcastState(
    reason: RoomUpdatedReason,
    state: GameState,
    options: {
      excludeSessionId?: string;
      requestId?: string;
      acceptedByPlayerId?: string;
      roundResult?: RoundResult;
    } = {},
  ): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.id === options.excludeSessionId) continue;
      this.send(session, {
        type: "ROOM_UPDATED",
        reason,
        requestId: options.requestId,
        acceptedByPlayerId: options.acceptedByPlayerId,
        roundResult: options.roundResult,
        view: createPrivateGameView(state, session.playerId),
      });
    }
  }

  private async processBots(
    remainingSteps: number = this.botStepLimit,
  ): Promise<void> {
    if (remainingSteps <= 0 || this.processingBots) return;

    const state = await this.authority.getState();
    if (!state || state.phase !== "RoundActive") {
      this.clearScheduledBotAction();
      return;
    }

    const decision = this.nextBotDecision(state);
    if (!decision) {
      this.clearScheduledBotAction();
      return;
    }

    const actionKey = this.botDecisionKey(state, decision);
    if (this.botActionKey === actionKey && this.botActionTimer !== undefined) {
      return;
    }

    this.clearScheduledBotAction();
    this.botActionKey = actionKey;

    const delayMs = this.botActionDelayMs();
    if (delayMs <= 0) {
      await this.runScheduledBotAction(
        state.stateRevision,
        actionKey,
        remainingSteps,
      );
      return;
    }

    this.botActionTimer = setTimeout(() => {
      void this.runExclusive(() =>
        this.runScheduledBotAction(state.stateRevision, actionKey),
      );
    }, delayMs);

    const timer = this.botActionTimer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    };
    timer.unref?.();
  }

  private nextBotDecision(
    state: GameState,
  ): ({ botPlayerId: string } & BotDecision) | null {
    const activeBots = [...state.players]
      .filter(
        (player) =>
          player.isBot && !player.eliminated && player.leftAt === undefined,
      )
      .sort((left, right) => left.seatIndex - right.seatIndex);

    for (const bot of activeBots) {
      const decision = decideBotAction(state, bot.id);
      if (decision.type !== "WAIT") {
        return {
          ...decision,
          botPlayerId: bot.id,
        };
      }
    }

    return null;
  }

  private botDecisionKey(
    state: GameState,
    decision: { botPlayerId: string } & BotDecision,
  ): string {
    const actionId =
      decision.type === "SUBMIT_CLAIM"
        ? decision.turnId
        : decision.type === "CALL_BULLSHIT"
          ? decision.claimWindowId
          : "wait";
    return `${state.stateRevision}:${decision.botPlayerId}:${decision.type}:${actionId ?? "none"}`;
  }

  private botActionDelayMs(): number {
    const minDelay = Math.max(0, this.botActionMinDelayMs);
    const maxDelay = Math.max(minDelay, this.botActionMaxDelayMs);
    if (maxDelay === minDelay) return minDelay;
    return minDelay + Math.floor(this.rng() * (maxDelay - minDelay + 1));
  }

  private clearScheduledBotAction(): void {
    if (this.botActionTimer !== undefined) {
      clearTimeout(this.botActionTimer);
    }
    this.botActionTimer = undefined;
    this.botActionKey = undefined;
  }

  private async runScheduledBotAction(
    expectedRevision: number,
    expectedActionKey: string,
    remainingSteps: number = this.botStepLimit,
  ): Promise<void> {
    if (this.botActionKey && this.botActionKey !== expectedActionKey) {
      return;
    }

    this.clearScheduledBotAction();
    if (this.processingBots) return;

    this.processingBots = true;
    let shouldContinue: boolean;

    try {
      const state = await this.authority.getState();
      if (
        !state ||
        state.phase !== "RoundActive" ||
        state.stateRevision !== expectedRevision
      ) {
        return;
      }

      const decision = this.nextBotDecision(state);
      if (
        !decision ||
        this.botDecisionKey(state, decision) !== expectedActionKey
      ) {
        return;
      }

      const result = await this.applyBotDecision(state, decision, this.now());
      if (!result.ok) return;

      await this.broadcastState("ACTION_ACCEPTED", result.state, {
        requestId: `bot:${decision.botPlayerId}:${state.stateRevision}`,
        acceptedByPlayerId: decision.botPlayerId,
        roundResult: result.roundResult,
      });
      shouldContinue = result.state.phase === "RoundActive";
    } finally {
      this.processingBots = false;
    }

    if (shouldContinue) {
      await this.processBots(remainingSteps - 1);
    }
  }

  private applyBotDecision(
    state: GameState,
    decision: { botPlayerId: string } & BotDecision,
    now: number,
  ): Promise<ServerActionResult> {
    const requestId = `bot:${decision.botPlayerId}:${state.stateRevision}`;

    if (decision.type === "SUBMIT_CLAIM") {
      return this.authority.submitClaim(
        {
          requestId,
          roomId: state.roomId,
          playerId: decision.botPlayerId,
          stateRevision: state.stateRevision,
          turnId: decision.turnId,
          claimWindowId: decision.claimWindowId,
          payload: {
            claim: decision.claim,
          },
        },
        now,
        this.rng,
      );
    }

    if (decision.type === "CALL_BULLSHIT") {
      return this.authority.callBullshit(
        {
          requestId,
          roomId: state.roomId,
          playerId: decision.botPlayerId,
          stateRevision: state.stateRevision,
          claimWindowId: decision.claimWindowId,
          payload: {},
        },
        now,
        this.rng,
      );
    }

    return Promise.resolve({
      ok: false,
      code: "INTERNAL_ERROR",
      latestStateRevision: state.stateRevision,
    });
  }

  private send(session: SessionRecord, message: RoomServerMessage): boolean {
    if (
      session.activeRequest &&
      message.type === "ROOM_UPDATED" &&
      message.reason === "ACTION_ACCEPTED" &&
      message.acceptedByPlayerId === session.playerId &&
      message.requestId === session.activeRequest.requestId
    ) {
      session.acceptedRequests.set(
        session.activeRequest.requestId,
        session.activeRequest.fingerprint,
      );
      if (session.acceptedRequests.size > MAX_ACCEPTED_REQUESTS_PER_SESSION) {
        session.acceptedRequests.delete(
          session.acceptedRequests.keys().next().value!,
        );
      }
    }
    const sent = this.sendSocket(session.socket, message);
    if (!sent && this.sessions.has(session.id)) {
      session.socket.close?.(1011, "SEND_FAILED");
      void this.disconnectSession(session.id);
    }
    return sent;
  }

  private sendSocket(
    socket: RoomSocketLike,
    message: RoomServerMessage,
  ): boolean {
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private runExclusive<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
