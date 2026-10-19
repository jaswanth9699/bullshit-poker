export type VisualQualityPreference = "auto" | "full" | "balanced";
export type ResolvedVisualQuality = "full" | "balanced" | "reduced";

export type VisualCapabilities = {
  viewportWidth: number;
  devicePixelRatio: number;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
};

export type VisualQualityConfig = {
  maxDevicePixelRatio: number;
  antialias: boolean;
  textureAnisotropy: number;
  floatingAmplitude: number;
  pointerInfluence: number;
};

export const VISUAL_QUALITY_CONFIG: Record<
  ResolvedVisualQuality,
  VisualQualityConfig
> = {
  full: {
    maxDevicePixelRatio: 2,
    antialias: true,
    textureAnisotropy: 4,
    floatingAmplitude: 0.16,
    pointerInfluence: 1,
  },
  balanced: {
    maxDevicePixelRatio: 1.75,
    antialias: true,
    textureAnisotropy: 2,
    floatingAmplitude: 0.1,
    pointerInfluence: 0.7,
  },
  reduced: {
    maxDevicePixelRatio: 1.75,
    antialias: true,
    textureAnisotropy: 1,
    floatingAmplitude: 0,
    pointerInfluence: 0,
  },
};

export function resolveVisualQuality(input: {
  preference: VisualQualityPreference;
  reducedEffects: boolean;
  capabilities: VisualCapabilities;
}): ResolvedVisualQuality {
  if (input.reducedEffects) return "reduced";
  if (input.preference !== "auto") return input.preference;

  const { viewportWidth, deviceMemoryGb, hardwareConcurrency } =
    input.capabilities;
  if (
    viewportWidth <= 760 ||
    (deviceMemoryGb !== undefined && deviceMemoryGb <= 4) ||
    (hardwareConcurrency !== undefined && hardwareConcurrency <= 4)
  ) {
    return "balanced";
  }

  return "full";
}

export function browserVisualCapabilities(): VisualCapabilities {
  const memoryNavigator = navigator as Navigator & { deviceMemory?: number };
  return {
    viewportWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    deviceMemoryGb: memoryNavigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

export const VISUAL_FRAME_PRIORITY = {
  input: 100,
  world: 300,
  view: 500,
  render: 1_000,
} as const;

export type VisualFrame = {
  now: number;
  deltaMs: number;
  elapsedMs: number;
};

type FrameCallback = (frame: VisualFrame) => void;
type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export class VisualFrameLoop {
  private readonly cancelFrame: CancelFrame;
  private readonly maxDeltaMs: number;
  private readonly requestFrame: RequestFrame;
  private readonly subscribers = new Map<
    number,
    { callback: FrameCallback; priority: number }
  >();
  private elapsedMs = 0;
  private frameHandle: number | null = null;
  private lastNow: number | null = null;
  private nextSubscriberId = 1;
  private running = false;

  constructor(options?: {
    requestFrame?: RequestFrame;
    cancelFrame?: CancelFrame;
    maxDeltaMs?: number;
  }) {
    this.requestFrame =
      options?.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame =
      options?.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.maxDeltaMs = options?.maxDeltaMs ?? 50;
  }

  subscribe(priority: number, callback: FrameCallback): () => void {
    const id = this.nextSubscriberId;
    this.nextSubscriberId += 1;
    this.subscribers.set(id, { callback, priority });
    return () => this.subscribers.delete(id);
  }

  runFrame(now: number): void {
    const rawDelta =
      this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    const deltaMs = Math.min(rawDelta, this.maxDeltaMs);
    this.lastNow = now;
    this.elapsedMs += deltaMs;
    const frame = { now, deltaMs, elapsedMs: this.elapsedMs };
    [...this.subscribers.values()]
      .sort((left, right) => left.priority - right.priority)
      .forEach(({ callback }) => callback(frame));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastNow = null;
    const tick = (now: number) => {
      if (!this.running) return;
      this.runFrame(now);
      this.frameHandle = this.requestFrame(tick);
    };
    this.frameHandle = this.requestFrame(tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.frameHandle !== null) this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
    this.lastNow = null;
  }

  dispose(): void {
    this.stop();
    this.subscribers.clear();
  }
}
