import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationRecord } from "@insboard/shared";
import { Editor } from "../apps/web/src/features/canvas/editor/Editor.ts";
import { boundsForShape } from "../apps/web/src/features/canvas/editor/geometry.ts";
import { findVacantPosition, rectanglesOverlap, type PlacementRect } from "../apps/web/src/features/canvas/editor/placement.ts";
import type { ReferenceSelectionItem } from "../apps/web/src/features/canvas/references.ts";
import { layoutGenerationBatch } from "../apps/web/src/features/generation/layout.ts";
import { createGenerationPlaceholders, generationContextBounds, replaceGenerationPlaceholders } from "../apps/web/src/features/generation/placeholders.ts";
import type { GenerationSubmitInput } from "../apps/web/src/features/generation/types.ts";
import type { Translate } from "../apps/web/src/shared/i18n/types.ts";

const t = (() => "test") as Translate;
const input: GenerationSubmitInput = { prompt: "variation", presetId: "none", sizePresetId: "square-1k", size: { width: 1024, height: 1024 }, quality: "medium", outputFormat: "png", count: 2 };

function fixture() {
  const editor = new Editor();
  editor.setContainer({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1080, height: 844 }) } as HTMLElement);
  editor.run(() => {
    editor.createAssets([{ id: "asset:reference", typeName: "asset", type: "image", props: { src: "/api/assets/reference", w: 1536, h: 1024, name: "reference", mimeType: "image/png" } }]);
    editor.createShapes([{ id: "reference", type: "image", x: -100, y: -100, props: { assetId: "asset:reference", w: 300, h: 200 } }]);
    editor.select("reference");
  }, { history: "ignore" });
  const references: ReferenceSelectionItem[] = [{ nodeNumber: 1, assetId: "asset:reference", localAssetId: "reference", name: "reference", sourceUrl: "/api/assets/reference", width: 1536, height: 1024, canvasX: -100, canvasY: -100, canvasWidth: 300, canvasHeight: 200 }];
  return { editor, references };
}

function successfulRecord(width = 1024, height = 1024): GenerationRecord {
  return {
    id: "request", mode: "edit", prompt: "variation", effectivePrompt: "variation", presetId: "none", size: input.size,
    quality: "medium", outputFormat: "png", count: 2, status: "succeeded", createdAt: new Date(0).toISOString(),
    outputs: [0, 1].map(index => ({ id: `output-${index}`, status: "succeeded", asset: { id: `result-${index}`, url: `/api/assets/result-${index}`, fileName: `result-${index}.png`, mimeType: "image/png", width, height, prompt: "variation", effectivePrompt: "variation" } }))
  };
}

function assertClear(rects: PlacementRect[], occupied: PlacementRect[]) {
  rects.forEach((rect, index) => {
    for (const obstacle of [...occupied, ...rects.slice(0, index)]) assert.equal(rectanglesOverlap(rect, obstacle), false);
  });
}

test("vacancy search avoids a dense canvas without changing any existing object", () => {
  const occupied = Array.from({ length: 2000 }, (_, index) => ({ x: (index % 50) * 350, y: Math.floor(index / 50) * 450, w: 300, h: 400 }));
  const before = JSON.stringify(occupied);
  const result = findVacantPosition({ x: 0, y: 0, w: 1536, h: 1024 }, occupied);
  assertClear([result], occupied);
  assert.equal(JSON.stringify(occupied), before);
});

test("every supported batch remains clear of references, prior results and other slots", () => {
  const reference = { x: -600, y: -200, w: 500, h: 900 };
  const occupied = [reference, { x: 100, y: -200, w: 1500, h: 1800 }, { x: 1800, y: 2000, w: 1400, h: 1000 }];
  for (const count of [1, 2, 4, 8, 16]) {
    for (const size of [{ width: 1024, height: 1024 }, { width: 2160, height: 3840 }, { width: 3840, height: 2160 }]) {
      const batch = layoutGenerationBatch(count, size, { x: -1000, y: -500, w: 1080, h: 844 }, occupied, [reference]);
      assert.equal(batch.length, count);
      assertClear(batch, occupied);
      for (const rect of batch) assert.ok(rect.x >= reference.x + reference.w + 48);
    }
  }
});

test("reference generations reserve separate groups and fit source plus outputs", () => {
  const { editor, references } = fixture();
  const original = editor.getShape("reference");
  const first = createGenerationPlaceholders(editor, input, "first", { references, selectPlaceholders: false });
  const second = createGenerationPlaceholders(editor, input, "second", { references, selectPlaceholders: false });
  const shapes = editor.getCurrentPageShapes().map(boundsForShape);
  assertClear(shapes, []);
  assert.strictEqual(editor.getShape("reference"), original);
  assert.deepEqual(editor.getSelectedShapeIds(), ["reference"]);
  const context = generationContextBounds(editor, first.placements, references);
  for (const rect of [boundsForShape(original!), ...first.placements.map(p => ({ x: p.x, y: p.y, w: p.width, h: p.height }))]) {
    assert.ok(context.x <= rect.x && context.y <= rect.y);
    assert.ok(context.x + context.w >= rect.x + rect.w && context.y + context.h >= rect.y + rect.h);
  }
  assert.equal(second.placements.length, 2);
  assert.equal(editor.canUndo(), false);
});

test("text generation avoids images already in the center of the viewport", () => {
  const { editor } = fixture();
  editor.updateShapes([{ id: "reference", x: 0, y: 0, props: { w: 1536, h: 1024 } }]);
  const placeholders = createGenerationPlaceholders(editor, input, "text");
  assertClear(placeholders.placements.map(p => ({ x: p.x, y: p.y, w: p.width, h: p.height })), [boundsForShape(editor.getShape("reference")!)]);
});

test("larger provider outputs and references moved during generation are rechecked on arrival", () => {
  const { editor, references } = fixture();
  const pending = createGenerationPlaceholders(editor, input, "request", { references, selectPlaceholders: false });
  editor.run(() => editor.updateShapes([{ id: "reference", x: pending.placements[0].x, y: pending.placements[0].y }]), { history: "ignore" });
  const reference = editor.getShape("reference");
  assert.equal(replaceGenerationPlaceholders(editor, pending, successfulRecord(2000, 2400), t), 2);
  assertClear(editor.getCurrentPageShapes().map(boundsForShape), []);
  assert.strictEqual(editor.getShape("reference"), reference);
  assert.deepEqual(editor.getSelectedShapeIds(), ["reference"], "background completion keeps the user's current selection");
  assert.equal(editor.getAsset("asset:result-0")?.meta?.prompt, "variation");
  assert.equal(editor.canUndo(), false);
});

test("selected placeholders transfer selection to results, while unrelated selection stays intact", () => {
  const { editor } = fixture();
  const pending = createGenerationPlaceholders(editor, input, "request");
  replaceGenerationPlaceholders(editor, pending, successfulRecord(), t);
  assert.equal(editor.getSelectedShapes().length, 2);
  assert.ok(editor.getSelectedShapes().every(shape => shape.type === "image"));
  const second = createGenerationPlaceholders(editor, input, "second");
  editor.select("reference");
  replaceGenerationPlaceholders(editor, second, successfulRecord(), t);
  assert.deepEqual(editor.getSelectedShapeIds(), ["reference"]);
});

test("batch readability depends on screen dimensions rather than the previous camera zoom", () => {
  const references = [{ x: -300, y: 10, w: 500, h: 800 }];
  const size = { width: 2160, height: 3840 };
  const normal = layoutGenerationBatch(8, size, { x: 0, y: 0, w: 1080, h: 844 }, references, references, 1);
  const zoomedOut = layoutGenerationBatch(8, size, { x: -4860, y: -3798, w: 10800, h: 8440 }, references, references, 0.1);
  assert.deepEqual(zoomedOut, normal);
});
