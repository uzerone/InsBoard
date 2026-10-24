export interface PlacementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectanglesOverlap(a: PlacementRect, b: PlacementRect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

export function boundsOf(rects: PlacementRect[]): PlacementRect {
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, w: Math.max(...rects.map(rect => rect.x + rect.w)) - x, h: Math.max(...rects.map(rect => rect.y + rect.h)) - y };
}

export function findVacantPosition(preferred: PlacementRect, occupied: PlacementRect[], gap = 48): PlacementRect {
  const right = { ...preferred }, below = { ...preferred };
  for (const obstacle of [...occupied].sort((a, b) => a.x - b.x)) {
    if (rectanglesOverlap(right, obstacle, gap)) right.x = obstacle.x + obstacle.w + gap;
  }
  for (const obstacle of [...occupied].sort((a, b) => a.y - b.y)) {
    if (rectanglesOverlap(below, obstacle, gap)) below.y = obstacle.y + obstacle.h + gap;
  }
  return right.x - preferred.x <= below.y - preferred.y ? right : below;
}
