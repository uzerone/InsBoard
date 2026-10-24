import { boundsOf, findVacantPosition, type PlacementRect } from "../canvas/editor/placement";

export function layoutGenerationBatch(
  count: number,
  size: { width: number; height: number; },
  viewport: PlacementRect,
  occupied: PlacementRect[],
  references: PlacementRect[] = [],
  cameraZoom = 1
): PlacementRect[] {
  if (count <= 0) return [];
  const reference = references.length ? boundsOf(references) : undefined;
  let gap = 48;
  let columns = 1;
  // Choose the arrangement that leaves the largest readable outputs in the
  // available viewport, including reference context when comparing variations.
  for (let pass = 0; pass < 2; pass++) {
    let bestZoom = -1, bestEmpty = Infinity;
    for (let candidate = 1; candidate <= count; candidate++) {
      const rows = Math.ceil(count / candidate);
      const width = candidate * size.width + (candidate - 1) * gap;
      const height = rows * size.height + (rows - 1) * gap;
      const contextWidth = width + (reference ? reference.w + gap : 0);
      const contextHeight = Math.max(height, reference?.h ?? 0);
      const zoom = Math.min(Math.max(1, viewport.w * cameraZoom - 144) / contextWidth, Math.max(1, viewport.h * cameraZoom - 144) / contextHeight);
      const empty = rows * candidate - count;
      if (zoom > bestZoom + 1e-6 || (Math.abs(zoom - bestZoom) < 1e-6 && empty < bestEmpty)) {
        bestZoom = zoom;
        bestEmpty = empty;
        columns = candidate;
      }
    }
    gap = Math.max(48, 28 / Math.max(0.02, bestZoom));
  }
  const rows = Math.ceil(count / columns);
  const w = columns * size.width + (columns - 1) * gap;
  const h = rows * size.height + (rows - 1) * gap;
  const preferred = {
    x: reference ? reference.x + reference.w + gap : viewport.x + (viewport.w - w) / 2,
    y: reference ? reference.y + (reference.h - h) / 2 : viewport.y + (viewport.h - h) / 2,
    w, h
  };
  const origin = findVacantPosition(preferred, [...occupied, ...references], gap);
  return Array.from({ length: count }, (_, index) => ({
    x: origin.x + (index % columns) * (size.width + gap),
    y: origin.y + Math.floor(index / columns) * (size.height + gap),
    w: size.width, h: size.height
  }));
}
