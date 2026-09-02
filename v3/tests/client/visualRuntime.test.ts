import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveVisualQuality,
  VisualFrameLoop,
  VISUAL_FRAME_PRIORITY,
} from "../../src/client/visualRuntime.ts";

test("visual quality respects reduced effects before every other preference", () => {
  assert.equal(
    resolveVisualQuality({
      preference: "full",
      reducedEffects: true,
      capabilities: { viewportWidth: 1440, devicePixelRatio: 2 },
    }),
    "reduced",
  );
});

test("automatic visual quality selects balanced for mobile and constrained hardware", () => {
  assert.equal(
    resolveVisualQuality({
      preference: "auto",
      reducedEffects: false,
      capabilities: { viewportWidth: 390, devicePixelRatio: 3 },
    }),
    "balanced",
  );
  assert.equal(
    resolveVisualQuality({
      preference: "auto",
      reducedEffects: false,
      capabilities: {
        viewportWidth: 1440,
        devicePixelRatio: 1,
        deviceMemoryGb: 4,
      },
    }),
    "balanced",
  );
  assert.equal(
    resolveVisualQuality({
      preference: "auto",
      reducedEffects: false,
      capabilities: {
        viewportWidth: 1440,
        devicePixelRatio: 1,
        deviceMemoryGb: 8,
        hardwareConcurrency: 8,
      },
    }),
    "full",
  );
});

test("visual frame loop orders stages and clamps resumed-tab delta", () => {
  const order: string[] = [];
  const deltas: number[] = [];
  const loop = new VisualFrameLoop({ maxDeltaMs: 40 });
  loop.subscribe(VISUAL_FRAME_PRIORITY.render, (frame) => {
    order.push("render");
    deltas.push(frame.deltaMs);
  });
  loop.subscribe(VISUAL_FRAME_PRIORITY.input, () => order.push("input"));
  loop.subscribe(VISUAL_FRAME_PRIORITY.world, () => order.push("world"));

  loop.runFrame(100);
  loop.runFrame(1_100);

  assert.deepEqual(order, [
    "input",
    "world",
    "render",
    "input",
    "world",
    "render",
  ]);
  assert.deepEqual(deltas, [0, 40]);
  loop.dispose();
});
