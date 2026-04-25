import type { GameState } from "../shared/index.ts";
import type { RoomStateStore } from "./roomAuthority.ts";

export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export const ROOM_STATE_STORAGE_KEY = "roomState";

export class DurableObjectRoomStateStore implements RoomStateStore {
  private readonly storage: DurableObjectStorageLike;
  private readonly key: string;

  constructor(storage: DurableObjectStorageLike, key = ROOM_STATE_STORAGE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  async getState(): Promise<GameState | undefined> {
    return this.storage.get<GameState>(this.key);
  }

  async putState(state: GameState): Promise<void> {
    await this.storage.put(this.key, state);
  }
}
