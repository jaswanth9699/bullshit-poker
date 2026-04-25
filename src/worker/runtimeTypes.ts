import type { DurableObjectStorageLike } from "../durable-objects/index.ts";

export type DurableObjectIdLike = {
  toString(): string;
};

export type DurableObjectStubLike = {
  fetch(request: Request): Promise<Response>;
};

export type DurableObjectNamespaceLike = {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
};

export type AssetBindingLike = {
  fetch(request: Request): Promise<Response>;
};

export type DurableObjectStateLike = {
  storage: DurableObjectStorageLike;
};

export type WorkerEnv = {
  ROOM_DURABLE_OBJECT: DurableObjectNamespaceLike;
  PIN_SECRET?: string;
  ASSETS?: AssetBindingLike;
};

export type WorkerExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};
