import { ProjectStoreUnavailableError } from "./errors.js";

const LARGE_PROJECT_SNAPSHOT_BYTES = 1024 * 1024;

const EMPTY_PROJECT_OVERWRITE_BYTES = 16 * 1024;

const EMPTY_PROJECT_STORE_RECORDS = 2;

interface SnapshotStats {
  bytes: number;
  storeRecords: number;
  shapeRecords: number;
  assetRecords: number;
  meaningful: boolean;
}

export function parseSnapshot(snapshotJson: string): unknown | null {
  try {
    return JSON.parse(snapshotJson) as unknown;
  } catch (error) {
    throw new ProjectStoreUnavailableError("Saved project snapshot could not be parsed.", error);
  }
}

export function shouldRejectDestructiveSnapshotSave(currentSnapshotJson: string, nextSnapshotJson: string): boolean {
  const current = snapshotStats(currentSnapshotJson);
  const next = snapshotStats(nextSnapshotJson);

  return (
    current.meaningful &&
    current.bytes >= LARGE_PROJECT_SNAPSHOT_BYTES &&
    next.bytes <= EMPTY_PROJECT_OVERWRITE_BYTES &&
    next.storeRecords <= EMPTY_PROJECT_STORE_RECORDS &&
    next.shapeRecords === 0 &&
    next.assetRecords === 0
  );
}

export function snapshotStats(snapshotJson: string): SnapshotStats {
  const bytes = Buffer.byteLength(snapshotJson, "utf8");
  const snapshot = parseSnapshot(snapshotJson);
  const store = snapshotStore(snapshot);
  const keys = store ? Object.keys(store) : [];
  const shapeRecords = keys.filter((key) => key.startsWith("shape:")).length;
  const assetRecords = keys.filter((key) => key.startsWith("asset:")).length;

  return {
    bytes,
    storeRecords: keys.length,
    shapeRecords,
    assetRecords,
    meaningful: bytes >= LARGE_PROJECT_SNAPSHOT_BYTES || shapeRecords > 0 || assetRecords > 0
  };
}

function snapshotStore(snapshot: unknown): Record<string, unknown> | undefined {
  if (!isRecord(snapshot)) {
    return undefined;
  }

  const document = snapshot.document;
  if (isRecord(document) && isRecord(document.store)) {
    return document.store;
  }

  return isRecord(snapshot.store) ? snapshot.store : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
