import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ImageProvider, ImageProviderInput } from "../src/infrastructure/providers/image-provider.js";

const dataDir = resolve("../../.codex-temp", `history-smoke-${process.pid}`);
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
mkdirSync(resolve(dataDir, "assets"), { recursive: true });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const originalPrompt = "玻璃瓶产品摄影\n柔和侧光，保留中文与换行。";
const effectivePrompt = `${originalPrompt}\nPhotorealistic studio lighting.`;
const legacy = new Database(resolve(dataDir, "gpt-image-canvas.sqlite"));
legacy.exec(`
  CREATE TABLE assets (id TEXT PRIMARY KEY, file_name TEXT NOT NULL, relative_path TEXT NOT NULL, mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE generation_records (id TEXT PRIMARY KEY, mode TEXT NOT NULL, prompt TEXT NOT NULL, effective_prompt TEXT NOT NULL, preset_id TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, quality TEXT NOT NULL, output_format TEXT NOT NULL, count INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, reference_asset_id TEXT REFERENCES assets(id), created_at TEXT NOT NULL);
  CREATE TABLE generation_outputs (id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE, status TEXT NOT NULL, asset_id TEXT REFERENCES assets(id), error TEXT, created_at TEXT NOT NULL);
  INSERT INTO assets VALUES ('legacy-image', 'legacy.png', 'assets/legacy.png', 'image/png', 1, 1, '2026-01-01');
`);
legacy.prepare("INSERT INTO generation_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
  .run("legacy-record", "generate", originalPrompt, effectivePrompt, "none", 1024, 1024, "low", "png", 1, "succeeded", null, null, "2026-01-01");
legacy.exec("INSERT INTO generation_outputs VALUES ('legacy-output', 'legacy-record', 'succeeded', 'legacy-image', NULL, '2026-01-01')");
legacy.close();
writeFileSync(resolve(dataDir, "assets/legacy.png"), Buffer.from(png, "base64"));

const { db, closeDatabase } = await import("../src/infrastructure/database.js");
const { assets, generationRecords, generationOutputs, generationReferenceAssets } = await import("../src/infrastructure/schema.js");
const { runTextToImageGeneration, createRunningTextToImageGeneration, finishTextToImageGeneration, readStoredAssetMetadata, readStoredAsset } = await import("../src/domain/generation/image-generation.js");
const { getProjectState, saveProjectSnapshot } = await import("../src/domain/project/project-store.js");
const { registerImageRoutes } = await import("../src/server/routes/images.js");
const { exportProjectArchive, importProjectArchive } = await import("../src/domain/project/project-archive.js");
const app = new Hono();
registerImageRoutes(app);
const input: ImageProviderInput = { originalPrompt, prompt: effectivePrompt, presetId: "none", size: { width: 1024, height: 1024 }, sizeApiValue: "1024x1024", quality: "low", outputFormat: "png", count: 1 };
const provider: ImageProvider = {
  generate: async () => ({ model: "test", size: "1024x1024", images: [{ b64Json: png }] }),
  edit: async () => ({ model: "test", size: "1024x1024", images: [{ b64Json: png }] })
};

try {
  assert.equal((await readStoredAssetMetadata("legacy-image"))?.prompt, originalPrompt);
  assert.equal((await readStoredAssetMetadata("legacy-image"))?.effectivePrompt, effectivePrompt);
  const { record } = await runTextToImageGeneration(input, provider);
  const asset = record.outputs[0].asset!;
  assert.equal(asset.prompt, originalPrompt);
  assert.equal((await readStoredAssetMetadata(asset.id))?.effectivePrompt, effectivePrompt);
  const running = createRunningTextToImageGeneration(input);
  const finished = await finishTextToImageGeneration(running.id, input, provider);
  assert.equal((await readStoredAssetMetadata(finished.outputs[0].asset!.id))?.prompt, originalPrompt);

  const snapshot = {
    store: {
      [`asset:${asset.id}`]: { id: `asset:${asset.id}`, typeName: "asset", type: "image", props: { src: asset.url, w: 1, h: 1, name: asset.fileName, mimeType: asset.mimeType } },
      "shape:keep": { id: "shape:keep", typeName: "shape", type: "image", x: 0, y: 0, props: { assetId: `asset:${asset.id}`, w: 300, h: 300 } }
    }
  };
  saveProjectSnapshot({ snapshotJson: JSON.stringify(snapshot) });
  db.insert(generationReferenceAssets).values({ generationId: record.id, assetId: "legacy-image", position: 0, createdAt: record.createdAt }).run();
  const single = await app.request(`/api/generations/${record.id}`, { method: "DELETE" });
  assert.equal(single.status, 200);
  assert.deepEqual((await single.json()).deletedGenerationIds, [record.id]);
  assert.equal(db.select().from(generationOutputs).where(eq(generationOutputs.generationId, record.id)).all().length, 0);
  assert.equal(db.select().from(generationReferenceAssets).where(eq(generationReferenceAssets.generationId, record.id)).all().length, 0);
  assert.deepEqual(getProjectState().snapshot, snapshot);
  assert.ok(await readStoredAsset(asset.id));
  assert.ok(await readStoredAsset("legacy-image"));
  assert.equal((await readStoredAssetMetadata(asset.id))?.prompt, originalPrompt);
  assert.equal((await app.request(`/api/generations/${record.id}`, { method: "DELETE" })).status, 404);

  for (let i = 0; i < 25; i++) {
    db.insert(generationRecords).values({ ...record, id: `finished-${i}`, width: 1024, height: 1024, status: ["succeeded", "partial", "failed", "cancelled"][i % 4] }).run();
  }
  for (const status of ["pending", "running"]) {
    db.insert(generationRecords).values({ ...record, id: status, width: 1024, height: 1024, status }).run();
    const response = await app.request(`/api/generations/${status}`, { method: "DELETE" });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "generation_in_progress");
  }
  const bulk = await app.request("/api/generations", { method: "DELETE" });
  assert.equal(bulk.status, 200);
  const body = await bulk.json();
  assert.equal(body.deletedGenerationIds.length, 27);
  assert.deepEqual(body.history.map((item: { id: string; }) => item.id).sort(), ["pending", "running"]);
  assert.equal(db.select().from(assets).all().length, 3);
  assert.deepEqual(getProjectState().snapshot, snapshot);
  assert.equal((await (await app.request("/api/generations", { method: "DELETE" })).json()).deletedGenerationIds.length, 0);
  db.update(generationRecords).set({ status: "cancelled" }).run();
  await app.request("/api/generations", { method: "DELETE" });
  const archive = await exportProjectArchive();
  const restored = await importProjectArchive(archive);
  const restoredShape = (restored.snapshot as typeof snapshot).store["shape:keep"];
  const restoredAssetId = restoredShape.props.assetId.slice(6);
  assert.equal((await readStoredAssetMetadata(restoredAssetId))?.prompt, originalPrompt);
  assert.equal((await readStoredAssetMetadata(restoredAssetId))?.effectivePrompt, effectivePrompt);
  console.log("PASS: legacy prompt migration, both generation paths, single/bulk deletion, active protection, cascade cleanup, retained images/canvas/prompts, archive round-trip.");
} finally {
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
}
