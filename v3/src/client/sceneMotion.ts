import type { Group, PerspectiveCamera } from "three";

export const CLAIM_CARD_WIDTH = 1.05;
export const CLAIM_CARD_HEIGHT = 1.5;
export const CLAIM_CARD_SPACING = 0.82;

/** Keep ranks facing the reader throughout idle motion and accepted events. */
export function poseClaim(
  group: Group,
  camera: PerspectiveCamera,
  elapsed: number,
  pulse: number,
  reduced: boolean,
): void {
  group.quaternion.copy(camera.quaternion);
  group.rotateY(reduced ? 0 : Math.sin(elapsed * 0.65) * 0.055);
  group.position.y = 0.8 + (reduced ? 0 : Math.sin(elapsed * 0.85) * 0.045);
  group.scale.setScalar(
    reduced ? 1 : 1 + Math.sin((1 - pulse) * Math.PI) * 0.1,
  );
}
