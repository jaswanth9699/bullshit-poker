import assert from "node:assert/strict";
import test from "node:test";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import {
  entryChoreography,
  entryLayerPose,
  entrySatellitePose,
  entryTrailPose,
} from "../../src/client/entryChoreography.ts";
import {
  ENTRY_SCENE_BOUNDS,
  fitSceneCamera,
} from "../../src/client/sceneFraming.ts";

test("entry sequence eases open, holds, gathers, and closes without a loop discontinuity", () => {
  assert.equal(entryChoreography(0).fan, 0);
  assert.equal(entryChoreography(5).fan, 1);
  assert.equal(entryChoreography(15).fan, 0);
  assert.deepEqual(entryChoreography(0), entryChoreography(16));
  let last = entryChoreography(0).fan;
  for (let frame = 1; frame <= 960; frame++) {
    const next = entryChoreography(frame / 60).fan;
    assert.ok(next >= 0 && next <= 1);
    assert.ok(Math.abs(next - last) < 0.012, "fan jumped between frames");
    last = next;
  }
  for (let card = 0; card < 4; card++) {
    const first = entrySatellitePose(card, 0);
    const last = entrySatellitePose(card, Math.PI * 2);
    for (const key of ["x", "y", "z", "roll"] as const)
      assert.ok(Math.abs(first[key] - last[key]) < 1e-12);
  }
});

test("full deck fan and four orbital faces stay readable and inside the camera throughout the sequence", () => {
  for (const [width, height] of [
    [278, 210],
    [348, 210],
    [695, 520],
    [404, 340],
  ]) {
    const camera = new PerspectiveCamera(36);
    fitSceneCamera(
      camera,
      ENTRY_SCENE_BOUNDS,
      new Vector3(),
      new Vector3(0, 0, 1),
      width,
      height,
    );
    const check = (point: Vector3) => {
      const p = point.project(camera);
      assert.ok(
        Math.abs(p.x) <= 0.94 && Math.abs(p.y) <= 0.94,
        `clipped ${p.x},${p.y}`,
      );
    };
    for (let step = 0; step <= 160; step++) {
      const pose = entryChoreography(step / 10);
      for (const direction of [-1, 0, 1]) {
        const tilt = new Euler(-direction * 0.06, direction * 0.12, 0);
        for (let index = 0; index < 13; index++) {
          const layer = entryLayerPose(index, pose.fan, pose.orbit);
          assert.ok(Math.abs(layer.roll) < 0.5, "fan ranks rotated too far");
          for (const x of [-0.86, 0.86])
            for (const y of [-1.23, 1.23])
              for (const z of [-0.04, 0.04]) {
                check(
                  new Vector3(x, y, z)
                    .applyAxisAngle(new Vector3(0, 0, 1), layer.roll)
                    .add(new Vector3(layer.x, layer.y, layer.z))
                    .multiplyScalar(1.4)
                    .applyAxisAngle(new Vector3(0, 0, 1), pose.lift * 0.35)
                    .add(new Vector3(0, pose.lift, 0))
                    .applyEuler(tilt),
                );
              }
        }
        for (let index = 0; index < 4; index++) {
          const card = entrySatellitePose(index, pose.orbit);
          for (const x of [-0.56, 0.56])
            for (const y of [-0.79, 0.79]) {
              check(
                new Vector3(x, y, 0)
                  .applyAxisAngle(new Vector3(0, 0, 1), card.roll)
                  .add(new Vector3(card.x, card.y, card.z))
                  .applyEuler(tilt),
              );
            }
        }
      }
    }
  }
});

test("Reduced Effects always shows the same open fan", () => {
  const still = entryChoreography(0, true);
  assert.equal(still.fan, 1);
  assert.equal(still.lift, 0);
  for (const time of [1, 8, 16, 10000])
    assert.deepEqual(entryChoreography(time, true), still);
});

test("card wakes follow prior orbital positions, taper and remain within the scene bounds", () => {
  for (const count of [3, 6]) {
    for (let step = 0; step <= 160; step++) {
      const orbit = entryChoreography(step / 10).orbit;
      for (let card = 0; card < 4; card++) {
        let previousScale = 2;
        for (let point = 0; point < count; point++) {
          const trail = entryTrailPose(card, point, count, orbit);
          const prior = entrySatellitePose(
            card,
            orbit - 0.22 - ((point + 1) / count) * 0.62,
          );
          assert.equal(trail.x, prior.x);
          assert.equal(trail.y, prior.y);
          assert.ok(trail.z < prior.z);
          assert.ok(trail.scale > 0 && trail.scale < previousScale);
          previousScale = trail.scale;
          for (const offset of [-0.1, 0.1])
            assert.ok(
              ENTRY_SCENE_BOUNDS.containsPoint(
                new Vector3(
                  trail.x + offset,
                  trail.y + offset,
                  trail.z + offset,
                ),
              ),
            );
        }
      }
    }
  }
});
