import assert from "node:assert/strict";
import { test } from "node:test";
import { gridBackground } from "../apps/web/src/features/canvas/editor/geometry.ts";

test("viewport grid stays aligned with world coordinates at every supported zoom", () => {
  for (const zoom of [0.02, 0.1, 0.5, 1, 2, 4]) {
    for (const x of [-1e9, -37, 0, 123, 1e9]) {
      const style = gridBackground({ x, y: -x, zoom });
      const [offsetX, offsetY] = style.backgroundPosition.split(" ").map(parseFloat);
      const step = parseFloat(style.backgroundSize);
      assert.equal(step, 24 * zoom);
      assert.ok(Math.abs(offsetX) < step);
      assert.ok(Math.abs(offsetY) < step);
      assert.ok(Math.abs((x - offsetX) / step - Math.round((x - offsetX) / step)) < 1e-5);
    }
  }
});

test("snapping uses the gesture origin and preserves group offsets", async () => {
  const { dragTranslation } = await import("../apps/web/src/features/canvas/editor/geometry.ts");
  const origin = { x: 5, y: -7 };
  const delta = dragTranslation(origin, { x: 31, y: -32 }, true);
  assert.deepEqual({ x: origin.x + delta.x, y: origin.y + delta.y }, { x: 48, y: -48 });
  const sibling = { x: 105, y: 43 };
  assert.equal(sibling.x + delta.x - (origin.x + delta.x), 100);
  assert.equal(sibling.y + delta.y - (origin.y + delta.y), 50);
  assert.deepEqual(dragTranslation(origin, { x: 31, y: -32 }, false), { x: 31, y: -32 });
});
