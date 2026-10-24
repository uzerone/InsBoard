import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "../apps/web/src/features/canvas/editor/Editor.ts";
import { editWorkflowNode, normalizeWorkflowProps, workflowPortPosition, type WorkflowNode } from "../apps/web/src/features/workflow/model.ts";

function fixture() {
  const editor = new Editor();
  editor.run(() => editor.createShapes(["a", "b"].map((id, index) => ({
    id, type: "workflow-node", x: index * 400, y: 20,
    props: normalizeWorkflowProps({ title: id, prompt: "original", inputIds: index ? ["a"] : [] })
  }))), { history: "ignore" });
  return editor;
}

test("document transactions publish once and undo/redo an imported image atomically", () => {
  const editor = new Editor();
  let saves = 0;
  editor.store.listen(() => saves++);
  editor.run(() => {
    editor.createAssets([{ id: "asset:one", typeName: "asset", type: "image", props: { src: "/one.png", w: 100, h: 100, name: "one", mimeType: "image/png" } }]);
    editor.createShapes([{ id: "image", type: "image", x: 1, y: 2, props: { assetId: "asset:one", w: 100, h: 100 } }]);
    editor.select("image");
  });
  assert.equal(saves, 1);
  editor.undo();
  assert.equal(editor.getShape("image"), undefined);
  assert.ok(editor.getAsset("asset:one"), "resource retained for redo and prompt provenance");
  assert.equal(editor.canUndo(), false);
  editor.redo();
  assert.equal(editor.getShape("image")?.x, 1);
  assert.deepEqual(editor.getSelectedShapeIds(), ["image"]);
});

test("one drag is one undo and a new edit clears redo", () => {
  const editor = fixture();
  editor.beginHistoryGroup();
  for (let i = 0; i < 20; i++) editor.moveShapes(["a"], 5, 2);
  editor.endHistoryGroup();
  editor.undo();
  assert.equal(editor.getShape("a")?.x, 0);
  assert.equal(editor.getShape("a")?.y, 20);
  assert.equal(editor.canUndo(), false);
  editor.redo();
  assert.equal(editor.getShape("a")?.x, 100);
  editor.undo();
  editor.moveShapes(["b"], 1, 0);
  assert.equal(editor.canRedo(), false);
});

test("undo restores a deleted upstream node, connections, outputs and selection", () => {
  const editor = fixture();
  editor.select("a");
  const before = editor.getSnapshot();
  editor.deleteShapes(["a"]);
  assert.deepEqual(editor.getShape<WorkflowNode>("b")?.props.inputIds, []);
  editor.undo();
  assert.deepEqual(editor.getSnapshot(), before);
  assert.deepEqual(editor.getSelectedShapeIds(), ["a"]);
  editor.redo();
  assert.equal(editor.getShape("a"), undefined);
});

test("prompt invalidation is undone with the edit, and a typing session is grouped", () => {
  const editor = fixture();
  editor.run(() => editor.updateShapes([{ id: "b", props: { status: "succeeded", outputs: [{ id: "output", status: "succeeded" }] } }]), { history: "ignore" });
  editor.beginHistoryGroup();
  for (const prompt of ["n", "ne", "new"]) editWorkflowNode(editor, "a", { prompt });
  editor.endHistoryGroup();
  assert.equal(editor.getShape<WorkflowNode>("b")?.props.status, "draft");
  editor.undo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.prompt, "original");
  assert.equal(editor.getShape<WorkflowNode>("b")?.props.status, "succeeded");
  assert.equal(editor.canUndo(), false);
});

test("undoing a drag never rewinds background generation or removes a new result", () => {
  const editor = fixture();
  editor.beginHistoryGroup();
  editor.moveShapes(["a"], 10, 0);
  editor.run(() => {
    editor.updateShapes([{ id: "a", props: { status: "succeeded", outputs: [{ id: "new-output" }] } }]);
    editor.createShapes([{ id: "new-result", type: "image", x: 10, y: 10, props: { w: 50, h: 50 } }]);
  }, { history: "ignore" });
  editor.moveShapes(["a"], 10, 0);
  editor.endHistoryGroup();
  editor.undo();
  assert.equal(editor.getShape("a")?.x, 0);
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.status, "succeeded");
  assert.deepEqual(editor.getShape<WorkflowNode>("a")?.props.outputs, [{ id: "new-output" }]);
  assert.ok(editor.getShape("new-result"));
  editor.redo();
  assert.equal(editor.getShape("a")?.x, 20);
});

test("active runs block history, and redo retains completed results instead of reviving a run", () => {
  const editor = new Editor();
  editor.createShapes([{ id: "a", type: "workflow-node", props: normalizeWorkflowProps({ title: "a" }) }]);
  editor.run(() => editor.updateShapes([{ id: "a", props: { runId: "active", status: "running" } }]), { history: "ignore" });
  editor.undo();
  assert.ok(editor.getShape("a"));
  editor.run(() => editor.updateShapes([{ id: "a", props: { runId: "", status: "succeeded", outputs: [{ id: "done" }] } }]), { history: "ignore" });
  editor.undo();
  assert.equal(editor.getShape("a"), undefined);
  editor.redo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.runId, "");
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.status, "succeeded");
});

test("workflow scale persists and wire ports follow the scaled card", () => {
  const editor = fixture();
  editor.updateShapes([{ id: "a", props: { w: 600, h: 840 } }]);
  assert.deepEqual(workflowPortPosition(editor.getShape("a")!), { x: 600, y: 176 });
  assert.deepEqual(workflowPortPosition(editor.getShape("a")!, true), { x: 0, y: 176 });
  const restored = new Editor();
  restored.loadSnapshot(editor.getSnapshot());
  assert.equal(restored.getShape("a")?.props.w, 600);
  assert.equal(restored.getShape("a")?.props.h, 840);
  assert.equal(restored.canUndo(), false);
  editor.undo();
  assert.equal(editor.getShape("a")?.props.w, 300);
  editor.redo();
  assert.equal(editor.getShape("a")?.props.w, 600);
});

test("in-flight placeholders cannot be deleted by user edits or replayed from history", () => {
  const editor = new Editor();
  editor.run(() => editor.createShapes([{ id: "loading", type: "generation-placeholder", props: { w: 100, h: 100, status: "loading" } }]), { history: "ignore" });
  editor.deleteShapes(["loading"]);
  assert.ok(editor.getShape("loading"));
  assert.equal(editor.canUndo(), false);
  editor.run(() => editor.deleteShapes(["loading"]), { history: "ignore" });
  assert.equal(editor.getShape("loading"), undefined);
  assert.equal(editor.canUndo(), false);
});

test("history is bounded and selection-only changes never consume an undo step", () => {
  const editor = fixture();
  editor.select("a");
  assert.equal(editor.canUndo(), false);
  for (let i = 0; i < 110; i++) editor.moveShapes(["a"], 1, 0);
  for (let i = 0; i < 100; i++) editor.undo();
  assert.equal(editor.getShape("a")?.x, 10);
  assert.equal(editor.canUndo(), false);
});

test("grid snapping preference round-trips without consuming document undo", () => {
  const editor = fixture();
  editor.setSnapToGrid(true);
  assert.equal(editor.canUndo(), false);
  const restored = new Editor();
  restored.loadSnapshot(editor.getSnapshot());
  assert.equal(restored.isSnapToGridEnabled(), true);
  restored.loadSnapshot({ store: {} });
  assert.equal(restored.isSnapToGridEnabled(), false);
});

test("undo of a definition after generation never pairs an old prompt with new outputs", () => {
  const editor = fixture();
  editWorkflowNode(editor, "a", { prompt: "new prompt" });
  editor.run(() => editor.updateShapes([{ id: "a", props: { status: "succeeded", outputs: [{ id: "new-prompt-result" }] } }]), { history: "ignore" });
  editor.undo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.prompt, "original");
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.status, "draft");
  assert.deepEqual(editor.getShape<WorkflowNode>("a")?.props.outputs, []);
  assert.deepEqual(editor.getShape<WorkflowNode>("b")?.props.outputs, []);
  editor.redo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.prompt, "new prompt");
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.runId, "");
});

test("undo can restore an earlier output belonging to the earlier prompt", () => {
  const editor = fixture();
  editor.run(() => editor.updateShapes([{ id: "a", props: { status: "succeeded", outputs: [{ id: "original-output" }] } }]), { history: "ignore" });
  editWorkflowNode(editor, "a", { prompt: "new prompt" });
  editor.run(() => editor.updateShapes([{ id: "a", props: { status: "succeeded", outputs: [{ id: "new-output" }] } }]), { history: "ignore" });
  editor.undo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.prompt, "original");
  assert.deepEqual(editor.getShape<WorkflowNode>("a")?.props.outputs, [{ id: "original-output" }]);
  editor.redo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.prompt, "new prompt");
  assert.deepEqual(editor.getShape<WorkflowNode>("a")?.props.outputs, [{ id: "new-output" }]);
});

test("disconnect target stays outside scaled port hit areas on short connections", async () => {
  const { workflowDisconnectPosition } = await import("../apps/web/src/features/workflow/model.ts");
  const editor = fixture();
  editor.updateShapes([{ id: "a", props: { w: 480, h: 672 } }, { id: "b", x: 510 }]);
  const from = editor.getShape("a")!, to = editor.getShape("b")!;
  const button = workflowDisconnectPosition(from, to);
  for (const port of [workflowPortPosition(from), workflowPortPosition(to, true)]) {
    assert.ok(Math.hypot(button.x - port.x, button.y - port.y) >= 60 - 1e-6);
  }
});
