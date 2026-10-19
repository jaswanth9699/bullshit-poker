import {
  applyCallBullshit,
  applySubmitClaim,
  addBotToRoom,
  advanceToNextRound,
  connectPlayer,
  createRoomWithHost,
  disconnectPlayer,
  endGame,
  joinRoom,
  leaveGame,
  removePlayerFromRoom,
  sendReaction,
  setPlayerReady,
  startRematch,
  startGame,
  type CallBullshitPayload,
  type AddBotInput,
  type ClientActionEnvelope,
  type CreateRoomInput,
  type GameState,
  type JoinRoomInput,
  type LifecycleResult,
  type LeaveGameInput,
  type EndGameInput,
  type SendReactionInput,
  type SetReadyInput,
  type StartRematchInput,
  type RemovePlayerInput,
  type Rng,
  type RoomIdentityProvider,
  type ServerActionResult,
  type SubmitClaimPayload,
} from "../shared/index.ts";

export interface RoomStateStore {
  getState(): Promise<GameState | undefined>;
  putState(state: GameState): Promise<void>;
  deleteState?(): Promise<void>;
}

export class RoomAuthority {
  private readonly store: RoomStateStore;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(store: RoomStateStore) {
    this.store = store;
  }

  async getState(): Promise<GameState | undefined> {
    await this.operationTail;
    return this.store.getState();
  }

  async initialize(state: GameState): Promise<void> {
    return this.runExclusive(async () => {
      const existingState = await this.store.getState();
      if (existingState) {
        throw new Error(`Room is already initialized: ${state.roomId}`);
      }
      await this.store.putState(state);
    });
  }

  async deleteRoom(): Promise<void> {
    return this.runExclusive(async () => {
      await this.store.deleteState?.();
    });
  }

  async createRoom(input: CreateRoomInput): Promise<LifecycleResult> {
    return this.runExclusive(async () => {
      const existingState = await this.store.getState();
      if (existingState) {
        return {
          ok: false,
          code: "GAME_ALREADY_STARTED",
          latestStateRevision: existingState.stateRevision,
        };
      }

      const result = createRoomWithHost(input);
      if (result.ok) {
        await this.store.putState(result.state);
      }
      return result;
    });
  }

  async joinRoom(input: JoinRoomInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => joinRoom(state, input));
  }

  async addBot(input: AddBotInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => addBotToRoom(state, input));
  }

  async removePlayer(input: RemovePlayerInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => removePlayerFromRoom(state, input));
  }

  async startGame(
    hostPlayerId: string,
    now: number,
    rng: Rng,
    enforceReady = false,
  ): Promise<LifecycleResult> {
    return this.applyLifecycle((state) =>
      startGame(state, { hostPlayerId, now, rng, enforceReady }),
    );
  }

  async connectPlayer(
    playerId: string,
    reconnectToken: string,
    identity: RoomIdentityProvider,
    now: number,
  ): Promise<LifecycleResult> {
    return this.applyLifecycle((state) =>
      connectPlayer(state, { playerId, reconnectToken, identity, now }),
    );
  }

  async disconnectPlayer(
    playerId: string,
    now: number,
  ): Promise<LifecycleResult> {
    return this.applyLifecycle((state) =>
      disconnectPlayer(state, { playerId, now }),
    );
  }

  async leaveGame(input: LeaveGameInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => leaveGame(state, input));
  }

  async setReady(input: SetReadyInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => setPlayerReady(state, input));
  }

  async endGame(input: EndGameInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => endGame(state, input));
  }

  async startRematch(input: StartRematchInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => startRematch(state, input));
  }

  async sendReaction(input: SendReactionInput): Promise<LifecycleResult> {
    return this.applyLifecycle((state) => sendReaction(state, input));
  }

  async advanceToNextRound(now: number, rng: Rng): Promise<LifecycleResult> {
    return this.applyLifecycle((state) =>
      advanceToNextRound(state, { now, rng }),
    );
  }

  async submitClaim(
    envelope: ClientActionEnvelope<SubmitClaimPayload>,
    now: number,
    rng: Rng,
  ): Promise<ServerActionResult> {
    return this.applyAction(
      (state) => applySubmitClaim(state, envelope, now),
      now,
      rng,
    );
  }

  async callBullshit(
    envelope: ClientActionEnvelope<CallBullshitPayload>,
    now: number,
    rng: Rng,
  ): Promise<ServerActionResult> {
    return this.applyAction(
      (state) => applyCallBullshit(state, envelope, now),
      now,
      rng,
    );
  }

  private async applyAction(
    reducer: (state: GameState) => ServerActionResult,
    now: number,
    rng: Rng,
  ): Promise<ServerActionResult> {
    return this.runExclusive(async () => {
      const state = await this.store.getState();
      if (!state) {
        return {
          ok: false,
          code: "ROOM_NOT_FOUND",
          latestStateRevision: 0,
        };
      }

      const reduced = reducer(state);
      if (!reduced.ok) return reduced;

      let result = reduced;
      if (reduced.roundResult && reduced.state.phase === "ResolvingRound") {
        const advanced = advanceToNextRound(reduced.state, { now, rng });
        if (!advanced.ok) {
          return {
            ok: false,
            code: "INTERNAL_ERROR",
            latestStateRevision: state.stateRevision,
          };
        }
        result = {
          ...reduced,
          state: advanced.state,
          newStateRevision: advanced.state.stateRevision,
        };
      }

      await this.store.putState(result.state);
      return result;
    });
  }

  private async applyLifecycle(
    reducer: (state: GameState) => LifecycleResult,
  ): Promise<LifecycleResult> {
    return this.runExclusive(async () => {
      const state = await this.store.getState();
      if (!state) {
        return {
          ok: false,
          code: "ROOM_NOT_FOUND",
          latestStateRevision: 0,
        };
      }

      const result = reducer(state);
      if (result.ok) {
        await this.store.putState(result.state);
      }

      return result;
    });
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

export class MemoryRoomStateStore implements RoomStateStore {
  private state?: GameState;

  constructor(initialState?: GameState) {
    this.state = initialState ? structuredClone(initialState) : undefined;
  }

  async getState(): Promise<GameState | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async putState(state: GameState): Promise<void> {
    this.state = structuredClone(state);
  }

  async deleteState(): Promise<void> {
    this.state = undefined;
  }
}
