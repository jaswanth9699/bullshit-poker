import assert from "node:assert/strict";
import test from "node:test";
import { Group, PerspectiveCamera, Vector3 } from "three";
import {
  fitSceneCamera,
  TABLE_SCENE_BOUNDS,
} from "../../src/client/sceneFraming.ts";
import {
  CLAIM_CARD_HEIGHT,
  CLAIM_CARD_SPACING,
  CLAIM_CARD_WIDTH,
  poseClaim,
} from "../../src/client/sceneMotion.ts";

test("claim faces remain upright, front-facing and in frame through an hour of motion", () => {
  for (const [width, height] of [
    [288, 230],
    [358, 230],
    [720, 310],
    [360, 240],
  ]) {
    const camera = new PerspectiveCamera(34);
    fitSceneCamera(
      camera,
      TABLE_SCENE_BOUNDS,
      new Vector3(0, -0.35, 0),
      new Vector3(0, 5.25, 6.4),
      width,
      height,
    );
    const cards = new Group();
    cards.position.z = 0.35;
    for (const time of [0, 0.4, 1, 10, 19.6, 40, 120, 3600]) {
      for (const pulse of [0, 0.5, 1]) {
        poseClaim(cards, camera, time, pulse, false);
        cards.updateMatrixWorld(true);
        const normal = new Vector3(0, 0, 1).applyQuaternion(cards.quaternion);
        const facing = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
        assert.ok(
          normal.dot(facing) > 0.99,
          "claim turned edge-on or backwards",
        );
        // The small-phone card face is at least 40 CSS px tall, even at rest.
        const top = new Vector3(0, CLAIM_CARD_HEIGHT / 2, 0)
          .applyMatrix4(cards.matrixWorld)
          .project(camera);
        const bottom = new Vector3(0, -CLAIM_CARD_HEIGHT / 2, 0)
          .applyMatrix4(cards.matrixWorld)
          .project(camera);
        assert.ok(
          ((top.y - bottom.y) * height) / 2 >= 40,
          "claim too small to read",
        );
        for (let index = 0; index < 5; index++) {
          const centered = index - 2;
          for (const x of [-CLAIM_CARD_WIDTH / 2, CLAIM_CARD_WIDTH / 2]) {
            for (const y of [-CLAIM_CARD_HEIGHT / 2, CLAIM_CARD_HEIGHT / 2]) {
              const corner = new Vector3(x, y, 0)
                .applyAxisAngle(new Vector3(0, 0, 1), centered * -0.085)
                .add(
                  new Vector3(
                    centered * CLAIM_CARD_SPACING,
                    Math.abs(centered) * 0.055,
                    index * 0.025,
                  ),
                )
                .applyMatrix4(cards.matrixWorld)
                .project(camera);
              assert.ok(
                Math.abs(corner.x) < 0.93 && Math.abs(corner.y) < 0.93,
                "animated five-card fan clipped",
              );
            }
          }
        }
      }
    }
  }
});

test("Reduced Effects settles the claim with the same readable orientation and size", () => {
  const camera = new PerspectiveCamera(34);
  camera.position.set(0, 5.25, 6.4);
  camera.lookAt(0, 0, 0);
  const cards = new Group();
  poseClaim(cards, camera, 0, 0, true);
  cards.updateMatrix();
  const initial = cards.matrix.clone();
  poseClaim(cards, camera, 3600, 1, true);
  cards.updateMatrix();
  assert.ok(cards.matrix.equals(initial), "reduced scene still animates");
  assert.equal(cards.scale.x, 1);
  assert.ok(cards.quaternion.equals(camera.quaternion));
});
