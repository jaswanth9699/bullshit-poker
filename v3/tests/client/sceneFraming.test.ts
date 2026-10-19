import assert from "node:assert/strict";
import test from "node:test";
import { CylinderGeometry, Euler, PerspectiveCamera, Vector3 } from "three";
import {
  boxCorners,
  ENTRY_SCENE_BOUNDS,
  fitSceneCamera,
  TABLE_SCENE_BOUNDS,
} from "../../src/client/sceneFraming.ts";

const sizes = [
  [280, 420],
  [320, 600],
  [390, 360],
  [430, 760],
  [720, 360],
  [768, 680],
  [1024, 420],
  [1440, 600],
  [2400, 320],
] as const;

function assertVisible(
  point: Vector3,
  camera: PerspectiveCamera,
  limit = 0.921,
) {
  const projected = point.clone().project(camera);
  assert.ok(Math.abs(projected.x) <= limit, `horizontal crop: ${projected.x}`);
  assert.ok(Math.abs(projected.y) <= limit, `vertical crop: ${projected.y}`);
  assert.ok(projected.z > -1 && projected.z < 1, "point outside depth range");
}

test("lobby and game fit full animated table bounds in every container shape", () => {
  for (const [width, height] of sizes) {
    for (const elevation of [5.9, 5.25]) {
      const camera = new PerspectiveCamera(34, 1, 0.1, 34);
      fitSceneCamera(
        camera,
        TABLE_SCENE_BOUNDS,
        new Vector3(0, -0.35, 0),
        new Vector3(0, elevation, 6.4),
        width,
        height,
      );
      for (const point of TABLE_SCENE_BOUNDS) assertVisible(point, camera);
      assert.equal(camera.aspect, width / height);
    }
  }
});

test("actual platform vertices and all ten seat rings stay visible during pointer motion", () => {
  const geometry = new CylinderGeometry(3.52, 3.52, 0.2, 6);
  const vertices = geometry.getAttribute("position");
  for (const [width, height] of sizes) {
    const camera = new PerspectiveCamera(34);
    fitSceneCamera(
      camera,
      TABLE_SCENE_BOUNDS,
      new Vector3(0, -0.35, 0),
      new Vector3(0, 5.25, 6.4),
      width,
      height,
    );
    for (const rotation of [-0.035, 0, 0.035]) {
      for (let index = 0; index < vertices.count; index += 1) {
        const point = new Vector3().fromBufferAttribute(vertices, index);
        point.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 6 + rotation);
        point.y -= 0.23;
        assertVisible(point, camera);
      }
      for (let seat = 0; seat < 10; seat += 1) {
        const angle = -Math.PI / 2 + (seat / 10) * Math.PI * 2;
        for (let ring = 0; ring < 12; ring += 1) {
          const ringAngle = (ring / 12) * Math.PI * 2;
          const point = new Vector3(
            Math.cos(angle) * 3.22 + Math.cos(ringAngle) * 0.378,
            0.185,
            Math.sin(angle) * 2.38 + Math.sin(ringAngle) * 0.378,
          ).applyAxisAngle(new Vector3(0, 1, 0), rotation);
          assertVisible(point, camera);
        }
      }
    }
  }
  geometry.dispose();
});

test("entry fitting contains its centered artwork and orbit motion on phones and desktop", () => {
  for (const [width, height] of sizes) {
    const scale = 1;
    const position = new Vector3();
    const bounds = ENTRY_SCENE_BOUNDS.clone();
    bounds.min.multiplyScalar(scale).add(position);
    bounds.max.multiplyScalar(scale).add(position);
    const camera = new PerspectiveCamera(36);
    fitSceneCamera(
      camera,
      bounds,
      new Vector3(),
      new Vector3(0, 0, 1),
      width,
      height,
    );
    for (const point of boxCorners(bounds)) assertVisible(point, camera);
    for (const tilt of [-1, 1]) {
      for (let segment = 0; segment < 128; segment += 1) {
        const angle = (segment / 128) * Math.PI * 2;
        const point = new Vector3(
          Math.cos(angle) * 3.532 * 0.78,
          Math.sin(angle) * 3.532 * 0.78,
          0,
        )
          .applyEuler(new Euler(0.5, 0.22, angle))
          .applyEuler(new Euler(tilt * 0.068, tilt * 0.1925, 0))
          .multiplyScalar(scale)
          .add(position);
        assertVisible(point, camera);
      }
    }
  }
});

test("resize recomputes projection and far plane even for extreme and initially empty containers", () => {
  const camera = new PerspectiveCamera(34, 1, 0.1, 34);
  for (const [width, height] of [
    [0, 0],
    [1, 1200],
    [1200, 1],
    [320, 600],
    [1440, 600],
  ]) {
    fitSceneCamera(
      camera,
      TABLE_SCENE_BOUNDS,
      new Vector3(0, -0.35, 0),
      new Vector3(0, 5.9, 6.4),
      width,
      height,
    );
    assert.ok(Number.isFinite(camera.position.length()));
    for (const point of TABLE_SCENE_BOUNDS) assertVisible(point, camera);
  }
});
