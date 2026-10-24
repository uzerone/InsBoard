import Database from "better-sqlite3";
import { chmodSync, existsSync, linkSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export async function migrateLegacyDatabase(databaseFile: string): Promise<void> {
  if (existsSync(databaseFile)) return;
  const legacyFile = join(dirname(databaseFile), "gpt-image-canvas.sqlite");
  if (!existsSync(legacyFile)) return;
  const temporaryFile = `${databaseFile}.migrating-${process.pid}`;
  const source = new Database(legacyFile, { readonly: true, fileMustExist: true });
  try {
    const result = source.pragma("quick_check") as Array<{ quick_check?: string; }>;
    if (result.length !== 1 || result[0]?.quick_check !== "ok") throw new Error("Existing data failed integrity verification.");
    await source.backup(temporaryFile);
    chmodSync(temporaryFile, statSync(legacyFile).mode & 0o777);
    linkSync(temporaryFile, databaseFile);
  } catch {
    throw new Error("Existing data could not be migrated. The original database was preserved.");
  } finally {
    source.close();
    rmSync(temporaryFile, { force: true });
  }
}
