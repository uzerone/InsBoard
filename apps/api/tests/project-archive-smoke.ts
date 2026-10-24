import { sql } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const dataDir = resolve("../../.codex-temp", `archive-smoke-${process.pid}`);
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
mkdirSync(dataDir, { recursive: true });
const { db, closeDatabase } = await import("../src/infrastructure/database.js");
const { generationRecords, generationOutputs } = await import("../src/infrastructure/schema.js");
const { saveReferenceImageInput, readStoredAsset } = await import("../src/domain/generation/image-generation.js");
const { saveProjectSnapshot, getProjectState } = await import("../src/domain/project/project-store.js");
const { exportProjectArchive, importProjectArchive } = await import("../src/domain/project/project-archive.js");
const { saveProviderConfig } = await import("../src/domain/providers/provider-config.js");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
try {
  saveProviderConfig({ sourceOrder: ["local-openai", "env-openai"], localOpenAI: { apiKey: "secret-excluded-from-project" } });
  const asset = await saveReferenceImageInput({ dataUrl: `data:image/png;base64,${png}` });
  const snapshot = {
    store: {
      [`asset:${asset.id}`]: { id: `asset:${asset.id}`, typeName: "asset", type: "image", props: { src: asset.url, w: 1, h: 1 } },
      "shape:image": { id: "shape:image", typeName: "shape", type: "image", x: 0, y: 0, props: { assetId: `asset:${asset.id}`, w: 300, h: 300 } },
      "shape:workflow-a": { id: "shape:workflow-a", typeName: "shape", type: "workflow-node", x: 400, y: 0, props: { title: "图像 A", prompt: "中文提示词", w: 300, h: 420, inputIds: ["shape:image"], status: "succeeded", outputs: [{ id: "output", status: "succeeded", asset }] } },
      "shape:workflow-b": { id: "shape:workflow-b", typeName: "shape", type: "workflow-node", x: 800, y: 0, props: { title: "B", prompt: "continue", w: 300, h: 420, inputIds: ["shape:workflow-a"], status: "running", runId: "old-run", connectionId: "old-session", outputs: [] } }
    }
  };
  saveProjectSnapshot({ name: "测试工程", snapshotJson: JSON.stringify(snapshot) });
  const archive = await exportProjectArchive();
  const entries = unzipSync(archive);
  assert.equal(Object.keys(entries).length, 2);
  assert.equal(strFromU8(entries["manifest.json"]).includes("secret-excluded-from-project"), false);
  assert.deepEqual(Buffer.from(entries["images/0.png"]), Buffer.from(png, "base64"));
  const imported = await importProjectArchive(archive);
  const store = (imported.snapshot as typeof snapshot).store;
  const result = store["shape:workflow-a"].props.outputs[0].asset;
  assert.notEqual(result.id, asset.id);
  assert.deepEqual((await readStoredAsset(result.id))?.bytes, Buffer.from(png, "base64"));
  assert.equal(store["shape:workflow-a"].props.prompt, "中文提示词");
  assert.equal(store["shape:workflow-b"].props.status, "cancelled");
  assert.equal(store["shape:workflow-b"].props.runId, "");
  assert.deepEqual(store["shape:workflow-b"].props.inputIds, ["shape:workflow-a"]);
  assert.equal(readdirSync(join(dataDir, "project-archives")).length, 1);
  const roundTrip = await exportProjectArchive();
  assert.equal(Object.keys(unzipSync(roundTrip)).length, 2);
  const unchanged = JSON.stringify(getProjectState().snapshot);
  const corrupt = { ...entries, "images/0.png": new Uint8Array([1, 2, 3]) };
  await assert.rejects(importProjectArchive(zipSync(corrupt)), /failed verification/u);
  await assert.rejects(importProjectArchive(zipSync({ ...entries, "../outside.png": strToU8("bad") })), /structure/u);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  manifest.version = 99;
  await assert.rejects(importProjectArchive(zipSync({ ...entries, "manifest.json": strToU8(JSON.stringify(manifest)) })), /supported/u);
  await assert.rejects(importProjectArchive(new Uint8Array([1, 2, 3])), /damaged/u);
  assert.equal(JSON.stringify(getProjectState().snapshot), unchanged);
  db.transaction((tx) => {
    for (let index = 0; index < 2100; index += 1) {
      const id = `large-${index}`;
      const createdAt = new Date().toISOString();
      tx.insert(generationRecords).values({
        id, mode: "generate", prompt: "test", effectivePrompt: "test", presetId: "none", width: 1024, height: 1024,
        quality: "low", outputFormat: "png", count: 16, status: "succeeded", createdAt
      }).run();
      for (let output = 0; output < 16; output += 1) tx.insert(generationOutputs).values({ id: `${id}-${output}`, generationId: id, status: "succeeded", assetId: result.id, createdAt }).run();
    }
  });
  const largeManifest = JSON.parse(strFromU8(unzipSync(await exportProjectArchive())["manifest.json"]));
  assert.equal(largeManifest.project.history.length, 2100);
  assert.equal(largeManifest.project.history.flatMap((record: { outputs: unknown[]; }) => record.outputs).length, 33600);
  db.run(sql`DROP TABLE generation_outputs`);
  await assert.rejects(exportProjectArchive());
  console.log("IDB round-trip, embedded images, links, CJK, interrupted runs, backups, secret exclusion, corrupt input, large history and strict read checks passed");
} finally {
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
}
