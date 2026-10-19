import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { layoutLobbySeatLabels } from "../../src/client/lobbySeatLabels.ts";
import {
  fitSceneCamera,
  LOBBY_SCENE_BOUNDS,
} from "../../src/client/sceneFraming.ts";

test("one through ten table names remain contained and separated at all supported sizes", () => {
  for (const [width, height] of [
    [286, 220],
    [358, 220],
    [734, 340],
    [900, 540],
  ]) {
    const camera = new PerspectiveCamera(34);
    fitSceneCamera(
      camera,
      LOBBY_SCENE_BOUNDS,
      new Vector3(0, -0.35, 0),
      new Vector3(0, 5.9, 6.4),
      width,
      height,
    );
    for (let count = 1; count <= 10; count++) {
      for (const tilt of [-0.035, 0, 0.035]) {
        const anchors = Array.from({ length: count }, (_, index) => {
          const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
          const point = new Vector3(
            Math.cos(angle) * 3.02,
            0.2,
            Math.sin(angle) * 2.1,
          )
            .applyAxisAngle(new Vector3(0, 1, 0), tilt)
            .project(camera);
          return {
            id: String(index),
            x: ((point.x + 1) * width) / 2,
            y: ((1 - point.y) * height) / 2,
          };
        });
        const labels = layoutLobbySeatLabels(anchors, width, height);
        assert.equal(labels.length, count);
        for (const label of labels) {
          assert.ok(label.labelX - label.width / 2 >= 0);
          assert.ok(label.labelX + label.width / 2 <= width);
          assert.ok(label.labelY - 10 >= 0 && label.labelY + 10 <= height);
          for (const other of labels) {
            if (label === other) continue;
            assert.ok(
              Math.abs(label.labelX - other.labelX) >= label.width ||
                Math.abs(label.labelY - other.labelY) >= 20,
            );
          }
        }
      }
    }
  }
});
