import type { GeneratedAsset, GenerationRecord, ProjectState } from "@insboard/shared";
import { eq } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "../../infrastructure/database.js";
import { runtimePaths } from "../../infrastructure/runtime.js";
import {
  assets,
  generationOutputs,
  generationRecords,
  generationReferenceAssets,
  projects
} from "../../infrastructure/schema.js";
import { readStoredAsset } from "../generation/image-generation.js";
import { getProjectState } from "./project-store.js";

export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_IMAGES = 2000;
const MIME_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
interface ArchiveAsset extends GeneratedAsset { path: string; sha256: string; }
interface Manifest { format: "InsBoard"; version: 1; project: ProjectState; assets: ArchiveAsset[]; }
export class ProjectArchiveError extends Error { readonly code = "project_archive_error"; }
function fail(message: string): never { throw new ProjectArchiveError(message); }
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function visit(value: unknown, mapString: (value: string) => string, depth = 0): unknown {
  if (depth > 100) return fail("The project nesting is too deep to open.");
  if (typeof value === "string") return mapString(value);
  if (Array.isArray(value)) return value.map((item) => visit(item, mapString, depth + 1));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [mapString(key), visit(item, mapString, depth + 1)]));
  return value;
}

function assetIdsInProject(project: ProjectState): Set<string> {
  const ids = new Set<string>();
  visit(project, (value) => {
    const match = /^\/api\/assets\/([^/?#]+)/u.exec(value);
    if (match) ids.add(decodeURIComponent(match[1]));
    return value;
  });
  for (const record of project.history) {
    for (const id of record.referenceAssetIds ?? []) ids.add(id);
    if (record.referenceAssetId) ids.add(record.referenceAssetId);
    for (const output of record.outputs) if (output.asset) ids.add(output.asset.id);
  }
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!isRecord(value)) return;
    if (value.type === "asset" || value.typeName === "asset") {
      const src = isRecord(value.props) ? value.props.src : undefined;
      if (typeof src === "string" && !src.startsWith("/api/assets/")) fail("Import external images into the canvas before saving.");
    }
    if (value.kind === "selected_canvas_image" && typeof value.assetId === "string") ids.add(value.assetId.replace(/^asset:/u, ""));
    Object.values(value).forEach(inspect);
  };
  inspect(project.snapshot);
  return ids;
}

export async function exportProjectArchive(snapshot?: unknown): Promise<Uint8Array> {
  const project = getProjectState(10001, true);
  if (project.history.length > 10000) fail("A project can contain at most 10,000 generation records.");
  if (snapshot !== undefined) project.snapshot = snapshot;
  const ids = assetIdsInProject(project);
  if (ids.size > MAX_IMAGES) fail("A project can contain at most 2,000 images.");
  const files: Record<string, Uint8Array> = {};
  const archiveAssets: ArchiveAsset[] = [];
  let total = 0;
  for (const id of ids) {
    const asset = db.select().from(assets).where(eq(assets.id, id)).get();
    const stored = await readStoredAsset(id);
    if (!asset || !stored) fail("Some project images are missing. Restore them before saving.");
    const extension = MIME_EXTENSIONS[asset.mimeType];
    if (!extension || stored.bytes.length > MAX_IMAGE_BYTES) fail("Project images must be PNG, JPEG or WebP and no larger than 50 MB.");
    total += stored.bytes.length;
    if (total > MAX_ARCHIVE_BYTES - MAX_MANIFEST_BYTES) fail("The project exceeds 512 MB. Split it before saving.");
    const path = `images/${archiveAssets.length}.${extension}`;
    files[path] = stored.bytes;
    archiveAssets.push({ id, url: `/api/assets/${id}`, fileName: asset.fileName, mimeType: asset.mimeType, width: asset.width, height: asset.height, prompt: asset.prompt ?? undefined, effectivePrompt: asset.effectivePrompt ?? undefined, path, sha256: digest(stored.bytes) });
  }
  const manifest: Manifest = { format: "InsBoard", version: 1, project, assets: archiveAssets };
  const manifestBytes = strToU8(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) fail("The project data is too large to save.");
  files["manifest.json"] = manifestBytes;
  return zipSync(files, { level: 0 });
}

function validateHistory(value: unknown): value is GenerationRecord[] {
  if (!Array.isArray(value) || value.length > 10000) return false;
  const text = (item: unknown) => typeof item === "string" && item.length < 100000;
  const integer = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item > 0;
  return value.every((record) => isRecord(record) && text(record.id) && text(record.prompt) && text(record.effectivePrompt) && text(record.presetId) && text(record.createdAt)
    && ["generate", "edit"].includes(String(record.mode)) && isRecord(record.size) && integer(record.size.width) && integer(record.size.height)
    && ["low", "medium", "high", "auto"].includes(String(record.quality)) && ["png", "jpeg", "webp"].includes(String(record.outputFormat))
    && integer(record.count) && Number(record.count) <= 16 && ["pending", "running", "succeeded", "partial", "failed", "cancelled"].includes(String(record.status))
    && (record.error === undefined || text(record.error)) && (record.referenceAssetId === undefined || text(record.referenceAssetId))
    && (record.referenceAssetIds === undefined || (Array.isArray(record.referenceAssetIds) && record.referenceAssetIds.every(text)))
    && Array.isArray(record.outputs) && record.outputs.length <= 16 && record.outputs.every((output) => isRecord(output) && text(output.id)
      && ["succeeded", "failed"].includes(String(output.status)) && (output.error === undefined || text(output.error))
      && (output.asset === undefined || (isRecord(output.asset) && text(output.asset.id)))));
}

function decodeArchive(bytes: Uint8Array): { manifest: Manifest; files: Record<string, Uint8Array>; } {
  if (bytes.length > MAX_ARCHIVE_BYTES) fail("Project files cannot exceed 512 MB.");
  let expanded = 0;
  let entries = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        entries += 1;
        expanded += file.originalSize;
        if (entries > MAX_IMAGES + 1 || expanded > MAX_ARCHIVE_BYTES || file.originalSize > (file.name === "manifest.json" ? MAX_MANIFEST_BYTES : MAX_IMAGE_BYTES)
          || !/^(manifest\.json|images\/\d+\.(png|jpg|webp))$/u.test(file.name)) fail("Unsupported project file structure or size.");
        return true;
      }
    });
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw error;
    return fail("The .idb file could not be read. It may be damaged.");
  }
  let value: unknown;
  try { value = JSON.parse(strFromU8(files["manifest.json"])); } catch { return fail("The project manifest is missing or damaged."); }
  if (!isRecord(value) || value.format !== "InsBoard" || value.version !== 1 || !isRecord(value.project) || !Array.isArray(value.assets)) fail("This is not a supported InsBoard project.");
  const project = value.project;
  if (typeof project.name !== "string" || project.name.length > 120 || !validateHistory(project.history)) fail("Project records are incomplete.");
  const snapshot = project.snapshot;
  if (snapshot !== null && (!isRecord(snapshot) || !(isRecord(snapshot.store) || (isRecord(snapshot.document) && isRecord(snapshot.document.store))))) fail("Canvas data is incomplete.");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const asset of value.assets) {
    if (!isRecord(asset) || typeof asset.id !== "string" || !/^[\w:-]{1,150}$/u.test(asset.id) || ids.has(asset.id)
      || typeof asset.path !== "string" || !files[asset.path] || paths.has(asset.path) || !Object.hasOwn(MIME_EXTENSIONS, String(asset.mimeType))
      || digest(files[asset.path]) !== asset.sha256) fail("Project images are missing or failed verification.");
    ids.add(asset.id); paths.add(asset.path);
  }
  if (Object.keys(files).length !== paths.size + 1) fail("The project contains files outside its manifest.");
  const manifest = value as unknown as Manifest;
  for (const id of assetIdsInProject(manifest.project)) if (!ids.has(id)) fail("The project references images missing from the archive.");
  return { manifest, files };
}

function stopImportedRuns(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(stopImportedRuns); return; }
  if (!isRecord(value)) return;
  if (value.type === "workflow-node" && isRecord(value.props)) {
    value.props.runId = ""; value.props.connectionId = "";
    if (["running", "queued"].includes(String(value.props.status))) { value.props.status = "cancelled"; value.props.error = "Retry unfinished nodes after opening the project."; }
  }
  if (value.type === "generation-placeholder" && isRecord(value.props) && value.props.status === "loading") { value.props.status = "failed"; value.props.error = "Generation was interrupted. Run it again."; }
  Object.values(value).forEach(stopImportedRuns);
}

export async function importProjectArchive(bytes: Uint8Array): Promise<ProjectState> {
  const { manifest, files } = decodeArchive(bytes);
  if (db.select().from(generationRecords).where(eq(generationRecords.status, "running")).get()) fail("Finish or cancel active generation before opening a project.");
  const current = getProjectState();
  const now = new Date().toISOString();
  const idMap = new Map(manifest.assets.map((asset) => [asset.id, randomUUID()]));
  const importedAssets: Array<typeof assets.$inferInsert> = [];
  const createdPaths: string[] = [];
  let committed = false;
  try {
    for (const asset of manifest.assets) {
      const data = files[asset.path];
      const metadata = await sharp(data, { limitInputPixels: 100_000_000 }).metadata().catch(() => fail("A project image could not be decoded."));
      const format = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
      if (!metadata.width || !metadata.height || format !== asset.mimeType) fail("A project image has an invalid format.");
      const id = idMap.get(asset.id)!;
      const fileName = `${id}.${MIME_EXTENSIONS[asset.mimeType]}`;
      const relativePath = `assets/${fileName}`;
      const filePath = join(runtimePaths.dataDir, relativePath);
      await writeFile(filePath, data, { flag: "wx" });
      createdPaths.push(filePath);
      importedAssets.push({ id, fileName, relativePath, mimeType: asset.mimeType, width: metadata.width, height: metadata.height, prompt: typeof asset.prompt === "string" ? asset.prompt : null, effectivePrompt: typeof asset.effectivePrompt === "string" ? asset.effectivePrompt : null, createdAt: now });
    }
    const project = visit(manifest.project, (value) => {
      if (idMap.has(value)) return idMap.get(value)!;
      if (value.startsWith("asset:") && idMap.has(value.slice(6))) return `asset:${idMap.get(value.slice(6))}`;
      return value.replace(/^\/api\/assets\/([^/?#]+)/u, (whole, id: string) => idMap.has(decodeURIComponent(id)) ? `/api/assets/${idMap.get(decodeURIComponent(id))}` : whole);
    }) as ProjectState;
    const canonicalAssets = new Map(importedAssets.map((asset) => [asset.id, asset]));
    const repairAssets = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(repairAssets); return; }
      if (!isRecord(value)) return;
      const asset = typeof value.id === "string" ? canonicalAssets.get(value.id) : undefined;
      if (asset) Object.assign(value, { url: `/api/assets/${asset.id}`, fileName: asset.fileName, mimeType: asset.mimeType, width: asset.width, height: asset.height });
      Object.values(value).forEach(repairAssets);
    };
    repairAssets(project);
    stopImportedRuns(project.snapshot);
    const backupsDir = join(runtimePaths.dataDir, "project-archives");
    await mkdir(backupsDir, { recursive: true });
    const backup = await exportProjectArchive();
    await writeFile(join(backupsDir, `before-open-${now.replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}.idb`), backup, { flag: "wx" });
    if (getProjectState().updatedAt !== current.updatedAt || db.select().from(generationRecords).where(eq(generationRecords.status, "running")).get()) fail("The current project changed. Try opening again.");
    db.transaction((tx) => {
      for (const asset of importedAssets) tx.insert(assets).values(asset).run();
      tx.delete(generationReferenceAssets).run(); tx.delete(generationOutputs).run(); tx.delete(generationRecords).run();
      for (const record of project.history) {
        const id = randomUUID();
        tx.insert(generationRecords).values({
          id, mode: record.mode, prompt: record.prompt, effectivePrompt: record.effectivePrompt, presetId: record.presetId,
          width: record.size.width, height: record.size.height, quality: record.quality, outputFormat: record.outputFormat, count: record.count,
          status: ["pending", "running"].includes(record.status) ? "cancelled" : record.status, error: record.error, referenceAssetId: record.referenceAssetId, createdAt: record.createdAt
        }).run();
        for (const output of record.outputs) tx.insert(generationOutputs).values({ id: randomUUID(), generationId: id, status: output.status, assetId: output.asset?.id, error: output.error, createdAt: record.createdAt }).run();
        for (const [position, assetId] of (record.referenceAssetIds ?? []).entries()) tx.insert(generationReferenceAssets).values({ generationId: id, assetId, position, createdAt: record.createdAt }).run();
      }
      tx.update(projects).set({ name: project.name, snapshotJson: JSON.stringify(project.snapshot), updatedAt: now }).where(eq(projects.id, "default")).run();
    });
    committed = true;
    return getProjectState();
  } catch (error) {
    if (!committed) await Promise.all(createdPaths.map((path) => rm(path, { force: true })));
    throw error;
  }
}
