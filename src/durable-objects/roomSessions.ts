import {
  createPrivateGameView,
  decideBotAction,
  type BotDecision,
  type CallBullshitPayload,
  type ClientActionEnvelope,
  type GameState,
  type LifecycleResult,
  type PrivateGameView,
  type Rng,
  type RoomClientMessage,
  type RoomIdentityProvider,
  type RoundResult,
  type RoomServerMessage,
  type RoomUpdatedReason,
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
  connectPlayer(
    playerId: string,
    reconnectToken: string,
    identity: RoomIdentityProvider,
    now: number,
  ): Promise<LifecycleResult>;
  disconnectPlayer(playerId: string, now: number): Promise<LifecycleResult>;
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
  ): Promise<LifecycleResult>;
  submitClaim(
    envelope: ClientActionEnvelope<SubmitClaimPayload>,
    now: number,
  ): Promise<ServerActionResult>;
  callBullshit(
    envelope: ClientActionEnvelope<CallBullshitPayload>,
    now: number,
  ): Promise<ServerActionResult>;
  timeout(turnId: string, now: number): Promise<ServerActionResult>;
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
};

export type RoomSessionManagerOptions = {
  now?: () => number;
  rng?: Rng;
  botStepLimit?: number;
  autoNextRoundDelayMs?: number;
  botActionMinDelayMs?: number;
  botActionMaxDelayMs?: number;
};

const DEFAULT_BOT_STEP_LIMIT = 20;
const DEFAULT_AUTO_NEXT_ROUND_DELAY_MS = 5_000;
const DEFAULT_BOT_ACTION_MIN_DELAY_MS = 2_000;
const DEFAULT_BOT_ACTION_MAX_DELAY_MS = 3_000;

function rawMessageData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in raw) {
    return (raw as RoomSocketEvent).data;
  }
  return raw;
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
    if (typeof (value as { type?: unknown }).type !== "string") {
      return null;
    }
    return value as RoomClientMessage;
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
  private readonly autoNextRoundDelayMs: number;
  private readonly botActionMinDelayMs: number;
  private readonly botActionMaxDelayMs: number;
  private readonly sessions = new Map<string, SessionRecord>();
  private sessionCounter = 0;
  private processingBots = false;
  private autoNextRoundTimer?: ReturnType<typeof setTimeout>;
  private autoNextRoundRevision?: number;
  private botActionTimer?: ReturnType<typeof setTimeout>;
  private botActionKey?: string;
  private turnTimeoutTimer?: ReturnType<typeof setTimeout>;
  private turnTimeoutKey?: string;

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
      this.autoNextRoundDelayMs = DEFAULT_AUTO_NEXT_ROUND_DELAY_MS;
      this.botActionMinDelayMs = DEFAULT_BOT_ACTION_MIN_DELAY_MS;
      this.botActionMaxDelayMs = DEFAULT_BOT_ACTION_MAX_DELAY_MS;
    } else {
      this.now = nowOrOptions.now ?? (() => Date.now());
      this.rng = nowOrOptions.rng ?? (() => Math.random());
      this.botStepLimit = nowOrOptions.botStepLimit ?? DEFAULT_BOT_STEP_LIMIT;
      this.autoNextRoundDelayMs =
        nowOrOptions.autoNextRoundDelayMs ?? DEFAULT_AUTO_NEXT_ROUND_DELAY_MS;
      this.botActionMinDelayMs =
        nowOrOptions.botActionMinDelayMs ?? DEFAULT_BOT_ACTION_MIN_DELAY_MS;
      this.botActionMaxDelayMs =
        nowOrOptions.botActionMaxDelayMs ?? DEFAULT_BOT_ACTION_MAX_DELAY_MS;
    }
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  async connectSocket(params: {
    socket: RoomSocketLike;
    playerId: string;
    reconnectToken: string;
    identity: RoomIdentityProvider;
    now?: number;
  }): Promise<SessionConnectResult> {
    params.socket.accept?.();

    const connected = await this.authority.connectPlayer(
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

    this.sessionCounter += 1;
    const session: SessionRecord = {
      id: `session-${this.sessionCounter}`,
      playerId: params.playerId,
      socket: params.socket,
      identity: params.identity,
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
    this.scheduleAutoNextRound(connected.state);
    this.scheduleTurnTimeout(connected.state);
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
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const message = parseClientMessage(raw);
    if (!message) {
      await this.reject(session, {
        requestId: undefined,
        code: "INVALID_MESSAGE",
        latestStateRevision: await this.latestRevision(),
      });
      return;
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
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.removePlayer({
            hostPlayerId: session.playerId,
            targetPlayerId: message.targetPlayerId,
            now,
          }),
        );
        return;

      case "START_GAME":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.startGame(session.playerId, now, this.rng),
        );
        return;

      case "START_NEXT_ROUND":
        await this.handleLifecycleResult(
          session,
          message.requestId,
          await this.authority.advanceToNextRound(now, this.rng),
        );
        return;

      case "SUBMIT_CLAIM":
        await this.handleSubmitClaim(session, message.envelope, now);
        return;

      case "CALL_BULLSHIT":
        await this.handleCallBullshit(session, message.envelope, now);
        return;

      case "EXPIRE_TURN":
        await this.handleTimeout(
          session,
          message.requestId,
          message.turnId,
          now,
        );
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
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    if (this.hasOpenSessionForPlayer(session.playerId)) {
      return;
    }

    const result = await this.authority.disconnectPlayer(session.playerId, now);
    if (result.ok) {
      await this.broadcastState("DISCONNECTED", result.state);
      this.scheduleAutoNextRound(result.state);
      this.scheduleTurnTimeout(result.state);
      await this.processBots();
    }
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
      await this.authority.submitClaim(envelope, now),
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
      await this.authority.callBullshit(envelope, now),
    );
  }

  private async handleTimeout(
    session: SessionRecord,
    requestId: string,
    turnId: string,
    now: number,
  ): Promise<void> {
    const result = await this.authority.timeout(turnId, now);
    await this.handleActionResult(session, requestId, result);
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
    this.scheduleAutoNextRound(result.state);
    this.scheduleTurnTimeout(result.state);
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
    this.scheduleAutoNextRound(result.state);
    this.scheduleTurnTimeout(result.state);
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
      void this.runScheduledBotAction(state.stateRevision, actionKey);
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
    let shouldContinue = false;

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
      this.scheduleAutoNextRound(result.state);
      this.scheduleTurnTimeout(result.state);
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
      );
    }

    return Promise.resolve({
      ok: false,
      code: "INTERNAL_ERROR",
      latestStateRevision: state.stateRevision,
    });
  }

  private clearAutoNextRound(): void {
    if (this.autoNextRoundTimer !== undefined) {
      clearTimeout(this.autoNextRoundTimer);
    }
    this.autoNextRoundTimer = undefined;
    this.autoNextRoundRevision = undefined;
  }

  private scheduleAutoNextRound(state: GameState): void {
    if (state.phase !== "ResolvingRound") {
      this.clearAutoNextRound();
      return;
    }

    if (
      this.autoNextRoundRevision === state.stateRevision &&
      this.autoNextRoundTimer !== undefined
    ) {
      return;
    }

    this.clearAutoNextRound();
    this.autoNextRoundRevision = state.stateRevision;
    this.autoNextRoundTimer = setTimeout(() => {
      void this.advanceAutomaticallyFromRoundReview(state.stateRevision);
    }, this.autoNextRoundDelayMs);

    const timer = this.autoNextRoundTimer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    };
    timer.unref?.();
  }

  private async advanceAutomaticallyFromRoundReview(
    expectedRevision: number,
  ): Promise<void> {
    this.autoNextRoundTimer = undefined;
    this.autoNextRoundRevision = undefined;

    const state = await this.authority.getState();
    if (
      !state ||
      state.phase !== "ResolvingRound" ||
      state.stateRevision !== expectedRevision
    ) {
      return;
    }

    const result = await this.authority.advanceToNextRound(
      this.now(),
      this.rng,
    );
    if (!result.ok) {
      return;
    }

    await this.broadcastState("AUTO_NEXT_ROUND", result.state, {
      requestId: `auto-next-round:${expectedRevision}`,
    });
    this.scheduleAutoNextRound(result.state);
    this.scheduleTurnTimeout(result.state);
    await this.processBots();
  }

  private turnTimeoutScheduleKey(state: GameState): string | undefined {
    if (
      state.phase !== "RoundActive" ||
      !state.currentTurnId ||
      state.turnExpiresAt === undefined
    ) {
      return undefined;
    }
    return `${state.stateRevision}:${state.currentTurnId}:${state.turnExpiresAt}`;
  }

  private clearTurnTimeout(): void {
    if (this.turnTimeoutTimer !== undefined) {
      clearTimeout(this.turnTimeoutTimer);
    }
    this.turnTimeoutTimer = undefined;
    this.turnTimeoutKey = undefined;
  }

  private scheduleTurnTimeout(state: GameState): void {
    const timeoutKey = this.turnTimeoutScheduleKey(state);
    if (!timeoutKey) {
      this.clearTurnTimeout();
      return;
    }

    if (
      this.turnTimeoutKey === timeoutKey &&
      this.turnTimeoutTimer !== undefined
    ) {
      return;
    }

    this.clearTurnTimeout();
    this.turnTimeoutKey = timeoutKey;
    const delayMs = Math.max(0, state.turnExpiresAt! - this.now());

    this.turnTimeoutTimer = setTimeout(() => {
      void this.runScheduledTurnTimeout(
        timeoutKey,
        state.stateRevision,
        state.currentTurnId!,
      );
    }, delayMs);

    const timer = this.turnTimeoutTimer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    };
    timer.unref?.();
  }

  private async runScheduledTurnTimeout(
    expectedTimeoutKey: string,
    expectedRevision: number,
    expectedTurnId: string,
  ): Promise<void> {
    if (this.turnTimeoutKey !== expectedTimeoutKey) {
      return;
    }

    this.turnTimeoutTimer = undefined;
    this.turnTimeoutKey = undefined;

    const state = await this.authority.getState();
    if (
      !state ||
      state.phase !== "RoundActive" ||
      state.stateRevision !== expectedRevision
    ) {
      if (state) this.scheduleTurnTimeout(state);
      return;
    }
    if (
      state.currentTurnId !== expectedTurnId ||
      state.turnExpiresAt === undefined
    ) {
      this.scheduleTurnTimeout(state);
      return;
    }

    const now = this.now();
    if (now < state.turnExpiresAt) {
      this.scheduleTurnTimeout(state);
      return;
    }

    const result = await this.authority.timeout(expectedTurnId, now);
    if (!result.ok) {
      const latestState = await this.authority.getState();
      if (latestState) this.scheduleTurnTimeout(latestState);
      return;
    }

    await this.broadcastState("TURN_TIMEOUT", result.state, {
      requestId: `turn-timeout:${expectedTurnId}`,
      acceptedByPlayerId: state.currentTurnPlayerId,
      roundResult: result.roundResult,
    });
    this.scheduleAutoNextRound(result.state);
    this.scheduleTurnTimeout(result.state);
    await this.processBots();
  }

  private send(session: SessionRecord, message: RoomServerMessage): void {
    this.sendSocket(session.socket, message);
  }

  private sendSocket(socket: RoomSocketLike, message: RoomServerMessage): void {
    socket.send(JSON.stringify(message));
  }
}
