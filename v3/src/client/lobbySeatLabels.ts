export type SeatAnchor = {
  id: string;
  x: number;
  y: number;
  nameWidth?: number;
};

// Keep short names centered immediately below their seats. Resolve only actual
// text collisions, instead of moving every name into a separate column.
export function layoutLobbySeatLabels(
  anchors: SeatAnchor[],
  width: number,
  height: number,
) {
  const maxWidth = Math.min(116, width * 0.19);
  const labels = anchors
    .map((anchor) => {
      const labelWidth = Math.min(maxWidth, anchor.nameWidth ?? maxWidth);
      return {
        ...anchor,
        width: labelWidth,
        labelX: Math.max(
          labelWidth / 2 + 4,
          Math.min(width - labelWidth / 2 - 4, anchor.x),
        ),
        labelY: Math.max(
          12,
          Math.min(
            height - 12,
            anchor.y + Math.max(15, Math.min(26, width * 0.028)),
          ),
        ),
      };
    })
    .sort((a, b) => a.labelY - b.labelY);
  for (let i = 0; i < labels.length; i++) {
    for (let j = 0; j < i; j++) {
      if (
        Math.abs(labels[i].labelX - labels[j].labelX) <
          (labels[i].width + labels[j].width) / 2 + 3 &&
        Math.abs(labels[i].labelY - labels[j].labelY) < 22
      ) {
        labels[i].labelY = labels[j].labelY + 22;
      }
    }
  }
  return labels;
}
