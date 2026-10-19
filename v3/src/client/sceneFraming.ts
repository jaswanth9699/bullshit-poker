import { Box3, PerspectiveCamera, Vector3 } from "three";

// Stable envelopes include the outer edges and the full range of cosmetic
// motion, so an accepted claim or pointer movement never changes the camera.
// Fit the round footprint instead of the empty corners of a square. Those
// corners previously pushed the camera back until cards became thumbnail-sized.
export const TABLE_SCENE_BOUNDS = [
  ...[-0.04, 0, 0.04].flatMap((rotation) =>
    Array.from({ length: 6 }, (_, index) => {
      const angle = (index / 6) * Math.PI * 2 + rotation;
      return [-0.4, 0.1].map(
        (y) => new Vector3(Math.cos(angle) * 3.6, y, Math.sin(angle) * 3.6),
      );
    }).flat(),
  ),
  ...Array.from({ length: 64 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    return [0, 0.46].map(
      (y) => new Vector3(Math.cos(angle) * 3.65, y, Math.sin(angle) * 2.86),
    );
  }).flat(),
  ...boxCorners(
    new Box3(new Vector3(-2.65, -0.2, -0.6), new Vector3(2.65, 1.7, 1.1)),
  ),
];
export const LOBBY_SCENE_BOUNDS = Array.from({ length: 64 }, (_, index) => {
  const angle = (index / 64) * Math.PI * 2;
  return [-0.4, 0.5].map(
    (y) => new Vector3(Math.cos(angle) * 3.65, y, Math.sin(angle) * 2.6),
  );
}).flat();
export const ENTRY_SCENE_BOUNDS = new Box3(
  new Vector3(-3.65, -3.1, -1.9),
  new Vector3(3.65, 3.1, 1.9),
);

export function boxCorners(bounds: Box3): Vector3[] {
  return [bounds.min.x, bounds.max.x].flatMap((x) =>
    [bounds.min.y, bounds.max.y].flatMap((y) =>
      [bounds.min.z, bounds.max.z].map((z) => new Vector3(x, y, z)),
    ),
  );
}

type SceneBounds = Box3 | readonly Vector3[];

function scenePoints(bounds: SceneBounds): Vector3[] {
  return bounds instanceof Box3
    ? boxCorners(bounds)
    : bounds.map((point) => point.clone());
}

export function projectedSceneBounds(
  camera: PerspectiveCamera,
  bounds: SceneBounds,
) {
  const points = scenePoints(bounds).map((point) => point.project(camera));
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.min(...points.map((point) => point.y)),
    top: Math.max(...points.map((point) => point.y)),
  };
}

/** Fit all corners in perspective, including each corner's camera-space depth. */
export function fitSceneCamera(
  camera: PerspectiveCamera,
  bounds: SceneBounds,
  target: Vector3,
  direction: Vector3,
  width: number,
  height: number,
  padding = 0.08,
) {
  camera.aspect = Math.max(1, width) / Math.max(1, height);
  camera.position.copy(target).add(direction.clone().normalize());
  camera.lookAt(target);
  const inverseRotation = camera.quaternion.clone().invert();
  const points = scenePoints(bounds).map((point) =>
    point.sub(target).applyQuaternion(inverseRotation),
  );
  const verticalTangent = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
  const horizontalTangent = verticalTangent * camera.aspect;
  const visibleFraction = 1 - padding;
  const distance = Math.max(
    ...points.map((point) =>
      Math.max(
        point.z + Math.abs(point.x) / (horizontalTangent * visibleFraction),
        point.z + Math.abs(point.y) / (verticalTangent * visibleFraction),
        point.z + camera.near * 2,
      ),
    ),
  );
  camera.position
    .copy(target)
    .addScaledVector(direction.clone().normalize(), distance);
  camera.far = Math.max(
    50,
    distance - Math.min(...points.map((point) => point.z)) + 10,
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return projectedSceneBounds(camera, bounds);
}
