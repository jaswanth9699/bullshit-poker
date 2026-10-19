// A closed, eased 16-second sequence; geometry never depends on frame rate.
export const ENTRY_CYCLE_SECONDS = 16;

function ease(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function entryChoreography(seconds: number, reduced = false) {
  const phase = reduced
    ? 0.36
    : (((seconds % ENTRY_CYCLE_SECONDS) + ENTRY_CYCLE_SECONDS) %
        ENTRY_CYCLE_SECONDS) /
      ENTRY_CYCLE_SECONDS;
  const fan = ease(0.035, 0.23, phase) * (1 - ease(0.61, 0.82, phase));
  const orbit = phase * Math.PI * 2;
  return {
    phase,
    fan,
    orbit,
    lift: reduced ? 0 : Math.sin(orbit) * 0.1,
    label: reduced
      ? "still"
      : phase < 0.23
        ? "unfold"
        : phase < 0.61
          ? "suspend"
          : phase < 0.82
            ? "gather"
            : "rest",
  };
}

export function entryLayerPose(index: number, fan: number, orbit = 0) {
  const centered = (index - 6) / 6;
  return {
    x: centered * (0.21 + fan * 1.0),
    y:
      centered * -0.132 -
      Math.abs(centered) * fan * 0.2 +
      Math.sin(orbit * 2 + centered * 2) * fan * 0.1,
    z:
      centered * -0.36 -
      fan * Math.abs(centered) * 0.08 +
      Math.sin(orbit + centered * 2) * fan * 0.18,
    roll: centered * (0.084 + fan * 0.34),
  };
}

export function entrySatellitePose(index: number, orbit: number) {
  const angle = orbit + (index * Math.PI) / 2;
  return {
    x: Math.cos(angle) * 2.62,
    y: Math.sin(angle) * 1.88,
    z: 0.95 + Math.sin(angle) * 0.18,
    roll: Math.sin(angle + Math.PI / 4) * 0.2,
  };
}

// Sample the card's own orbit behind it; taper instead of scattering particles.
export function entryTrailPose(
  card: number,
  point: number,
  count: number,
  orbit: number,
) {
  const progress = (point + 1) / count;
  const satellite = entrySatellitePose(card, orbit - 0.22 - progress * 0.62);
  return {
    x: satellite.x,
    y: satellite.y,
    z: satellite.z - 0.22,
    scale: 1.45 * (1 - progress * 0.82),
    roll: orbit + (card * Math.PI) / 2 - progress,
  };
}
