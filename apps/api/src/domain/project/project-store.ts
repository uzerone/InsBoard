import { type ProjectState } from "@insboard/shared";
import { eq } from "drizzle-orm";
import { db } from "../../infrastructure/database.js";
import { projects } from "../../infrastructure/schema.js";
import { getGenerationHistory, readGenerationHistory } from "../generation/history.js";
import { ProjectSnapshotOverwriteRejectedError, ProjectStoreUnavailableError } from "./errors.js";
import { tryWriteProjectSnapshotBackup } from "./snapshot-backups.js";
import { parseSnapshot, shouldRejectDestructiveSnapshotSave } from "./snapshot-validation.js";

export const DEFAULT_PROJECT_ID = "default";

const DEFAULT_PROJECT_NAME = "Default Project";

interface ProjectSnapshotInput {
  name?: string;
  snapshotJson: string;
}

interface EnsureDefaultProjectOptions {
  backupExisting: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function ensureDefaultProject(): void {
  ensureDefaultProjectRow({ backupExisting: true });
}

function ensureDefaultProjectRow(options: EnsureDefaultProjectOptions): void {
  const existing = getDefaultProjectRow();

  if (existing) {
    if (options.backupExisting) {
      tryWriteProjectSnapshotBackup(existing.snapshotJson, existing.updatedAt);
    }
    return;
  }
  if (defaultProjectRowExists()) {
    return;
  }

  const createdAt = nowIso();
  db.insert(projects)
    .values({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      snapshotJson: "null",
      createdAt,
      updatedAt: createdAt
    })
    .run();
}

export function saveProjectSnapshot(input: ProjectSnapshotInput): ProjectState {
  ensureDefaultProjectRow({ backupExisting: false });

  const updatedAt = nowIso();
  const current = getDefaultProjectRow();
  if (current && shouldRejectDestructiveSnapshotSave(current.snapshotJson, input.snapshotJson)) {
    throw new ProjectSnapshotOverwriteRejectedError(
      "Refusing to overwrite a non-empty saved canvas with an empty snapshot."
    );
  }

  tryWriteProjectSnapshotBackup(input.snapshotJson, updatedAt);

  db.update(projects)
    .set({
      name: input.name ?? current?.name ?? DEFAULT_PROJECT_NAME,
      snapshotJson: input.snapshotJson,
      updatedAt
    })
    .where(eq(projects.id, DEFAULT_PROJECT_ID))
    .run();

  return getProjectState();
}

export function getProjectState(historyLimit = 20, strictHistory = false): ProjectState {
  ensureDefaultProject();

  const project = getDefaultProjectRow();

  if (!project) {
    return {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      snapshot: null,
      history: strictHistory ? readGenerationHistory(historyLimit, true) : getGenerationHistory(historyLimit),
      updatedAt: nowIso()
    };
  }

  return {
    id: project.id,
    name: project.name,
    snapshot: parseSnapshot(project.snapshotJson),
    history: strictHistory ? readGenerationHistory(historyLimit, true) : getGenerationHistory(historyLimit),
    updatedAt: project.updatedAt
  };
}

function getDefaultProjectRow(): (typeof projects.$inferSelect) | undefined {
  try {
    return db.select().from(projects).where(eq(projects.id, DEFAULT_PROJECT_ID)).get();
  } catch (error) {
    throw new ProjectStoreUnavailableError("Saved project row could not be read.", error);
  }
}

function defaultProjectRowExists(): boolean {
  try {
    const row = db.select({ id: projects.id }).from(projects).where(eq(projects.id, DEFAULT_PROJECT_ID)).get();
    return Boolean(row);
  } catch (error) {
    throw new ProjectStoreUnavailableError("Saved project row existence could not be checked.", error);
  }
}

export type { GalleryExportAsset } from "../assets/gallery.js";

export { getGalleryImages } from "../assets/gallery.js";

export { deleteGalleryOutput } from "../assets/gallery.js";

export { deleteGalleryOutputs } from "../assets/gallery.js";

export { deleteGalleryOutputsByAssetIds } from "../assets/gallery.js";

export { getGalleryExportAssets } from "../assets/gallery.js";

export { getGenerationHistory } from "../generation/history.js";

export { ProjectSnapshotOverwriteRejectedError, ProjectStoreUnavailableError } from "./errors.js";
