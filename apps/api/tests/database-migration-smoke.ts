import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrateLegacyDatabase } from "../src/infrastructure/database-migration.js";

const directory = resolve("../../.codex-temp", `database-migration-${process.pid}`);
mkdirSync(directory, { recursive: true });
const legacyFile = resolve(directory, "gpt-image-canvas.sqlite");
const destination = resolve(directory, "insboard.sqlite");
let legacy: Database.Database | undefined;
let migrated: Database.Database | undefined;
try {
  legacy = new Database(legacyFile);
  legacy.pragma("journal_mode = WAL");
  legacy.exec("CREATE TABLE saved_data (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  legacy.prepare("INSERT INTO saved_data VALUES (?, ?)").run("key", "dummy-secret-for-migration-only");
  legacy.prepare("INSERT INTO saved_data VALUES (?, ?)").run("project", "保留项目与图片元数据");
  await migrateLegacyDatabase(destination);
  assert.ok(existsSync(legacyFile));
  migrated = new Database(destination);
  assert.deepEqual(migrated.prepare("SELECT * FROM saved_data ORDER BY id").all(), legacy.prepare("SELECT * FROM saved_data ORDER BY id").all());
  migrated.prepare("UPDATE saved_data SET value = ? WHERE id = 'project'").run("New InsBoard work");
  await migrateLegacyDatabase(destination);
  assert.equal((migrated.prepare("SELECT value FROM saved_data WHERE id = 'project'").get() as { value: string }).value, "New InsBoard work");
  migrated.close(); migrated = undefined;
  legacy.close(); legacy = undefined;
  const broken = resolve(directory, "corrupt");
  mkdirSync(broken);
  writeFileSync(resolve(broken, "gpt-image-canvas.sqlite"), "not a SQLite database");
  await assert.rejects(migrateLegacyDatabase(resolve(broken, "insboard.sqlite")));
  assert.equal(existsSync(resolve(broken, "insboard.sqlite")), false);
  assert.ok(existsSync(resolve(broken, "gpt-image-canvas.sqlite")));
  console.log("Legacy WAL data, saved values, existing database protection and corrupt input preservation passed");
} finally {
  migrated?.close(); legacy?.close();
  rmSync(directory, { recursive: true, force: true });
}
