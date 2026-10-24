import { createHash } from "node:crypto";
import { readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { runtimePaths } from "../../infrastructure/runtime.js";
import { formatErrorSummary, warnOnce } from "./diagnostics.js";
import { snapshotStats } from "./snapshot-validation.js";

const PROJECT_SNAPSHOT_BACKUP_COUNT_LIMIT = readPositiveIntegerEnv("PROJECT_SNAPSHOT_BACKUP_MAX_COUNT", 20);

const PROJECT_SNAPSHOT_BACKUP_TOTAL_BYTES_LIMIT = readPositiveIntegerEnv(
  "PROJECT_SNAPSHOT_BACKUP_MAX_BYTES",
  256 * 1024 * 1024
);

const PROJECT_SNAPSHOT_BACKUP_MIN_COUNT = Math.min(
  readPositiveIntegerEnv("PROJECT_SNAPSHOT_BACKUP_MIN_COUNT", 3),
  PROJECT_SNAPSHOT_BACKUP_COUNT_LIMIT
);

const PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS = readPositiveIntegerEnv(
  "PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS",
  5 * 60 * 1000
);

interface ProjectSnapshotBackupFile {
  filePath: string;
  fileName: string;
  mtimeMs: number;
  size: number;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function tryWriteProjectSnapshotBackup(snapshotJson: string, updatedAt: string): void {
  try {
    writeProjectSnapshotBackup(snapshotJson, updatedAt);
  } catch (error) {
    warnOnce("project-snapshot-backup-write-failed", `Project snapshot backup write failed. ${formatErrorSummary(error)}`);
  }

  try {
    pruneProjectSnapshotBackups();
  } catch (error) {
    warnOnce("project-snapshot-backup-prune-failed", `Project snapshot backup prune failed. ${formatErrorSummary(error)}`);
  }
}

function writeProjectSnapshotBackup(snapshotJson: string, updatedAt: string): void {
  const stats = snapshotStats(snapshotJson);
  if (!stats.meaningful) {
    return;
  }

  const hash = createHash("sha256").update(snapshotJson).digest("hex");
  if (backupExists(hash)) {
    return;
  }
  if (shouldDelayProjectSnapshotBackup()) {
    return;
  }

  const timestamp = safeTimestamp(updatedAt);
  const hashPrefix = hash.slice(0, 16);
  const fileName = `${timestamp}-${hashPrefix}.json.gz`;
  const tempFileName = `.${fileName}.${process.pid}.tmp`;
  const finalPath = join(runtimePaths.projectSnapshotBackupsDir, fileName);
  const tempPath = join(runtimePaths.projectSnapshotBackupsDir, tempFileName);

  writeFileSync(tempPath, gzipSync(snapshotJson));
  renameSync(tempPath, finalPath);
}

function backupExists(hash: string): boolean {
  const hashPrefix = hash.slice(0, 16);
  return readdirSync(runtimePaths.projectSnapshotBackupsDir).some((fileName) =>
    fileName.endsWith(`${hashPrefix}.json.gz`)
  );
}

function shouldDelayProjectSnapshotBackup(): boolean {
  const latestBackup = readProjectSnapshotBackups()[0];
  if (!latestBackup) {
    return false;
  }

  return Date.now() - latestBackup.mtimeMs < PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS;
}

function pruneProjectSnapshotBackups(): void {
  const backups = readProjectSnapshotBackups();
  let keptCount = 0;
  let keptBytes = 0;

  for (const backup of backups) {
    const keepForRecoveryFloor = keptCount < PROJECT_SNAPSHOT_BACKUP_MIN_COUNT;
    const keepWithinCountLimit = keptCount < PROJECT_SNAPSHOT_BACKUP_COUNT_LIMIT;
    const keepWithinBytesLimit = keptBytes + backup.size <= PROJECT_SNAPSHOT_BACKUP_TOTAL_BYTES_LIMIT;

    if (keepForRecoveryFloor || (keepWithinCountLimit && keepWithinBytesLimit)) {
      keptCount += 1;
      keptBytes += backup.size;
      continue;
    }

    rmSync(backup.filePath, { force: true });
  }
}

function readProjectSnapshotBackups(): ProjectSnapshotBackupFile[] {
  return readdirSync(runtimePaths.projectSnapshotBackupsDir)
    .flatMap((fileName): ProjectSnapshotBackupFile[] => {
      if (!fileName.endsWith(".json.gz")) {
        return [];
      }

      const filePath = join(runtimePaths.projectSnapshotBackupsDir, fileName);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(filePath);
      } catch {
        return [];
      }
      if (!stats.isFile()) {
        return [];
      }

      return [
        {
          filePath,
          fileName,
          mtimeMs: stats.mtimeMs,
          size: stats.size
        }
      ];
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.fileName.localeCompare(left.fileName));
}

function safeTimestamp(value: string): string {
  const date = new Date(value);
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();

  return iso.replace(/[:.]/gu, "-");
}
