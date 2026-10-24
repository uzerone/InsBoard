import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "../apps/web/src/features/canvas/editor/Editor.ts";
import { buildWorkflowPlan, connectWorkflowNodes, editWorkflowNode, normalizeWorkflowProps, workflowBusy, type WorkflowNode } from "../apps/web/src/features/workflow/model.ts";
import { WorkflowRunner } from "../apps/web/src/features/workflow/runner.ts";

function fixture() {
  const editor = new Editor();
  editor.createShapes(["a", "b", "c"].map((id) => ({ id, typeName: "shape", type: "workflow-node", x: 0, y: 0, props: normalizeWorkflowProps({ title: id, prompt: `Generate ${id}` }) })));
  return editor;
}

test("connections reject cycles, duplicate links and missing sources", () => {
  const editor = fixture();
  assert.equal(connectWorkflowNodes(editor, "a", "b"), null);
  assert.equal(connectWorkflowNodes(editor, "b", "c"), null);
  assert.equal(connectWorkflowNodes(editor, "c", "a"), "cycle");
  assert.equal(connectWorkflowNodes(editor, "a", "b"), "duplicate");
  assert.equal(connectWorkflowNodes(editor, "a", "a"), "self");
  assert.equal(connectWorkflowNodes(editor, "absent", "a"), "missing");
  const result = buildWorkflowPlan(editor, "Test");
  assert.ok("plan" in result);
  assert.equal(result.plan.createdBy, "user");
  assert.deepEqual(result.plan.jobs[1].references, [{ kind: "generated_output", usage: "subject", nodeNumber: 1, jobId: "a" }]);
  assert.equal(result.plan.edges.length, 2);
  const restored = new Editor();
  restored.loadSnapshot(editor.getSnapshot());
  assert.deepEqual(restored.getShape<WorkflowNode>("b")?.props.inputIds, ["a"]);
});

test("editing or deleting upstream nodes invalidates dependent output and removes dangling links", () => {
  const editor = fixture();
  connectWorkflowNodes(editor, "a", "b");
  connectWorkflowNodes(editor, "b", "c");
  editor.updateShapes(["a", "b", "c"].map((id) => ({ id, props: { status: "succeeded", outputs: [{ id: "result", status: "succeeded" }] } })));
  editWorkflowNode(editor, "a", { prompt: "New subject" });
  for (const id of ["a", "b", "c"]) assert.equal(editor.getShape<WorkflowNode>(id)?.props.status, "draft");
  editor.deleteShapes(["b"]);
  assert.deepEqual(editor.getShape<WorkflowNode>("c")?.props.inputIds, []);
});

test("reference limits, stored image mapping and retry status", () => {
  const editor = fixture();
  for (let i = 0; i < 17; i++) {
    editor.createAssets([{ id: `asset:${i}`, typeName: "asset", type: "image", props: { src: `/api/assets/image-${i}`, w: 10, h: 10, name: `image-${i}`, mimeType: "image/png" } }]);
    editor.createShapes([{ id: `image:${i}`, typeName: "shape", type: "image", x: 0, y: 0, props: { w: 10, h: 10, assetId: `asset:${i}` } }]);
  }
  for (let i = 0; i < 16; i++) assert.equal(connectWorkflowNodes(editor, `image:${i}`, "a"), null);
  assert.equal(connectWorkflowNodes(editor, "image:16", "a"), "inputs");
  editor.updateShapes([{ id: "a", props: { status: "succeeded" } }, { id: "b", props: { status: "failed" } }]);
  const result = buildWorkflowPlan(editor, "Retry", true);
  assert.ok("plan" in result);
  assert.equal(result.plan.jobs[0].status, "succeeded");
  assert.equal(result.plan.jobs[1].status, "queued");
  assert.equal(result.plan.jobs[0].references[0].assetId, "image-0");
  editor.updateShapes([{ id: "a", props: { runId: "running" } }]);
  editor.deleteShapes(["a", "image:0"]);
  assert.ok(editor.getShape("a"));
  assert.ok(editor.getShape("image:0"));
});

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(public url: URL) { FakeSocket.instances.push(this); }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

test("runner restores without resubmission, handles expired sessions and cancels before dispatch", () => {
  const oldSocket = globalThis.WebSocket;
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { WebSocket: FakeSocket, window: { location: { href: "http://localhost:5173" } } });
  let runner: WorkflowRunner | undefined;
  try {
    const editor = fixture();
    const result = buildWorkflowPlan(editor, "Run");
    assert.ok("plan" in result);
    runner = new WorkflowRunner(editor, () => {});
    runner.start(result.plan, false);
    const first = FakeSocket.instances.at(-1)!;
    assert.equal(first.url.pathname, "/api/workflow/ws");
    first.open();
    const sent = JSON.parse(first.sent[0]);
    assert.equal(sent.type, "execute_plan");
    first.receive({ type: "connected", connectionId: "session" });
    const saved = editor.getSnapshot();
    runner.dispose();
    const restored = new Editor();
    restored.loadSnapshot(saved);
    runner = new WorkflowRunner(restored, () => {});
    const resumed = FakeSocket.instances.at(-1)!;
    resumed.open();
    assert.equal(resumed.url.searchParams.get("runId"), sent.runId);
    assert.equal(resumed.url.searchParams.get("connectionId"), "session");
    assert.equal(resumed.sent.length, 0);
    resumed.receive({ type: "error", code: "workflow_session_expired", runId: sent.runId });
    assert.equal(workflowBusy(restored), false);
    assert.equal(restored.getShape<WorkflowNode>("a")?.props.status, "failed");
    runner.start(result.plan, false);
    runner.cancel();
    assert.equal(workflowBusy(restored), false);
    assert.equal(restored.getShape<WorkflowNode>("a")?.props.status, "cancelled");
  } finally {
    runner?.dispose();
    Object.assign(globalThis, { WebSocket: oldSocket, window: oldWindow });
  }
});


test("model edits survive snapshots and undo while invalidating dependent results", () => {
  const editor = fixture();
  connectWorkflowNodes(editor, "a", "b");
  editor.updateShapes([{ id: "b", props: { status: "succeeded" } }]);
  editWorkflowNode(editor, "a", { model: "gpt-image-2.5-flare" });
  const result = buildWorkflowPlan(editor, "Models");
  assert.ok("plan" in result);
  assert.equal(result.plan.jobs[0].model, "gpt-image-2.5-flare");
  assert.equal(editor.getShape<WorkflowNode>("b")?.props.status, "draft");
  const restored = new Editor();
  restored.loadSnapshot(editor.getSnapshot());
  assert.equal(restored.getShape<WorkflowNode>("a")?.props.model, "gpt-image-2.5-flare");
  editor.undo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.model, "gpt-image-2");
  editor.redo();
  assert.equal(editor.getShape<WorkflowNode>("a")?.props.model, "gpt-image-2.5-flare");
});
