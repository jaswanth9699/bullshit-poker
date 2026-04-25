import {
  applyCallBullshit,
  applySubmitClaim,
  applyTimeout,
  addBotToRoom,
  advanceToNextRound,
  connectPlayer,
  createRoomWithHost,
  disconnectPlayer,
  joinRoom,
  removePlayerFromRoom,
  startGame,
  type CallBullshitPayload,
  type AddBotInput,
  type ClientActionEnvelope,
  type CreateRoomInput,
  type GameState,
  type JoinRoomInput,
  type LifecycleResult,
  type RemovePlayerInput,
  type Rng,
  type RoomIdentityProvider,
  type ServerActionResult,
  type StartGameInput,
  type SubmitClaimPayload,
} from "../shared/index.ts";

export interface RoomStateStore {
  getState(): Promise<GameState | undefined>;
  putState(state: GameState): Promise<void>;
}

export class RoomAuthority {
  private readonly store: RoomStateStore;

  constructor(store: RoomStateStore) {
    this.store = store;
  }

  async getState(): Promise<GameState | undefined> {
    return this.store.getState();
  }

  async initialize(state: GameState): Promise<void> {
    const existingState = await this.store.getState();
    if (existingState) {
      throw new Error(`Room is already initialized: ${state.roomId}`);
    }
    await this.store.putState(state);
  }

  async createRoom(input: CreateRoomInput): Promise<LifecycleResult> {
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
  ): Promise<LifecycleResult> {
    return this.applyLifecycle((state) =>
      startGame(state, { hostPlayerId, now, rng }),
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

  async advanceToNextRound(now: number, rng: Rng): Promise<LifecycleResult> {
    return this.applyLifecycle((state) =>
      advanceToNextRound(state, { now, rng }),
    );
  }

  async submitClaim(
    envelope: ClientActionEnvelope<SubmitClaimPayload>,
    now: number,
  ): Promise<ServerActionResult> {
    return this.apply((state) => applySubmitClaim(state, envelope, now));
  }

  async callBullshit(
    envelope: ClientActionEnvelope<CallBullshitPayload>,
    now: number,
  ): Promise<ServerActionResult> {
    return this.apply((state) => applyCallBullshit(state, envelope, now));
  }

  async timeout(turnId: string, now: number): Promise<ServerActionResult> {
    return this.apply((state) => applyTimeout(state, turnId, now));
  }

  private async apply(
    reducer: (state: GameState) => ServerActionResult,
  ): Promise<ServerActionResult> {
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
  }

  private async applyLifecycle(
    reducer: (state: GameState) => LifecycleResult,
  ): Promise<LifecycleResult> {
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
}
