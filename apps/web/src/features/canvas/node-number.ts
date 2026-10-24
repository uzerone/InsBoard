export function canvasNodeNumber(shape: { meta?: Record<string, unknown>; } | undefined): number {
  const number = shape?.meta?.nodeNumber;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : 0;
}
