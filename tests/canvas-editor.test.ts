import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "../apps/web/src/features/canvas/editor/Editor.ts";
import { normalizeWorkflowProps } from "../apps/web/src/features/workflow/model.ts";

test("selection updates observers without triggering document autosave", () => {
  const editor = new Editor();
  editor.createShapes([{ id: "shape:one", type: "workflow-node", x: 0, y: 0, props: normalizeWorkflowProps({ title: "第一步", prompt: "test" }) }]);
  let changes = 0;
  let saves = 0;
  const unsubscribe = editor.subscribe(() => changes++);
  const unsubscribeDocument = editor.store.listen(() => saves++);
  editor.select("shape:one");
  assert.deepEqual(editor.getSelectedShapeIds(), ["shape:one"]);
  assert.equal(changes, 1);
  assert.equal(saves, 0);
  editor.selectNone();
  assert.deepEqual(editor.getSelectedShapeIds(), []);
  assert.equal(changes, 2);
  assert.equal(saves, 0);
  editor.updateShapes([{ id: "shape:one", x: 20 }]);
  assert.equal(changes, 3);
  assert.equal(saves, 1);
  unsubscribe();
  unsubscribeDocument();
  editor.select("shape:one");
  assert.equal(changes, 3);
});

test("editor snapshot round-trip retains image dimensions, metadata and workflow props", () => {
  const editor = new Editor();
  editor.createAssets([{ id: "asset:one", typeName: "asset", type: "image", props: { src: "/api/assets/one", w: 2160, h: 3840, name: "图片", mimeType: "image/png" }, meta: { prompt: "保留原始提示词" } }]);
  editor.createShapes([{ id: "shape:image", type: "image", x: 4, y: 8, props: { assetId: "asset:one", w: 2160, h: 3840 } }]);
  const restored = new Editor();
  restored.loadSnapshot(editor.getSnapshot());
  assert.equal(restored.getAsset("asset:one")?.meta?.prompt, "保留原始提示词");
  assert.equal(restored.getShape("shape:image")?.props.w, 2160);
  assert.equal(restored.getShape("shape:image")?.props.h, 3840);
});
