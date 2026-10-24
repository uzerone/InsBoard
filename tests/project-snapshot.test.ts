import assert from "node:assert/strict";
import { test } from "node:test";
import { filterLoadingPlaceholdersFromSnapshot } from "../apps/web/src/features/project/snapshot.ts";
import { GENERATION_PLACEHOLDER_TYPE } from "../apps/web/src/features/generation/placeholder-model.ts";

test("legacy cleanup preserves images, prompts and recoverable current jobs", () => {
  const image = { typeName: "shape", type: "image", props: { assetId: "asset:kept", prompt: "原始提示词" } };
  const current = { typeName: "shape", type: GENERATION_PLACEHOLDER_TYPE, props: { status: "loading", requestId: "current-uuid" } };
  const snapshot = { document: { store: { image, current, old: { typeName: "shape", type: "agent-plan-node" }, orphan: { typeName: "shape", type: GENERATION_PLACEHOLDER_TYPE, props: { status: "loading", requestId: "agent-old" } } } } };
  const result = filterLoadingPlaceholdersFromSnapshot(snapshot);
  assert.deepEqual(Object.keys(result.document.store), ["image", "current"]);
  assert.strictEqual(result.document.store.image, image);
  assert.strictEqual(result.document.store.current, current);
  assert.equal(Object.keys(snapshot.document.store).length, 4);
  assert.strictEqual(filterLoadingPlaceholdersFromSnapshot(result), result);
});
