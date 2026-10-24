import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureRuntimeStorage, runtimePaths, sqliteConfig } from "./runtime.js";
import { migrateLegacyDatabase } from "./database-migration.js";
import * as schema from "./schema.js";

ensureRuntimeStorage();
await migrateLegacyDatabase(runtimePaths.databaseFile);

const sqlite = new Database(runtimePaths.databaseFile);
configureSqlite(sqlite);
verifySqliteIntegrity(sqlite);

function configureSqlite(database: Database.Database): void {
  database.pragma(`locking_mode = ${sqliteConfig.lockingMode}`);
  database.pragma("foreign_keys = ON");
  applyJournalMode(database);
}

function applyJournalMode(database: Database.Database): void {
  try {
    database.pragma(`journal_mode = ${sqliteConfig.journalMode}`);
  } catch (error) {
    if (sqliteConfig.journalMode !== "WAL" || !isSharedMemoryOpenError(error)) {
      throw error;
    }

    console.warn("SQLite WAL mode is unavailable for DATA_DIR; falling back to DELETE journal mode.");
    database.pragma("locking_mode = EXCLUSIVE");
    database.pragma("journal_mode = DELETE");
  }
}

function isSharedMemoryOpenError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "SQLITE_IOERR_SHMOPEN"
  );
}

function verifySqliteIntegrity(database: Database.Database): void {
  const rows = database.pragma("quick_check") as Array<{ quick_check?: string; }>;
  if (rows.length === 1 && rows[0]?.quick_check === "ok") {
    return;
  }

  throw new Error(
    "SQLite integrity check failed. Stop the app and restore the database from a backup before continuing."
  );
}

sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  source_order_json TEXT NOT NULL,
  local_api_key TEXT,
  local_base_url TEXT,
  local_model TEXT,
  local_timeout_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_oauth_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  email TEXT,
  account_id TEXT,
  expires_at TEXT,
  refreshed_at TEXT,
  unavailable_at TEXT,
  unavailable_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_records (
  id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  effective_prompt TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  quality TEXT NOT NULL,
  output_format TEXT NOT NULL,
  count INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  reference_asset_id TEXT REFERENCES assets(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  asset_id TEXT REFERENCES assets(id),
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_reference_assets (
  generation_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (generation_id, position)
);

CREATE INDEX IF NOT EXISTS generation_records_created_at_idx ON generation_records(created_at);
CREATE INDEX IF NOT EXISTS generation_outputs_generation_id_idx ON generation_outputs(generation_id);
CREATE INDEX IF NOT EXISTS generation_outputs_asset_id_idx ON generation_outputs(asset_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_generation_id_idx ON generation_reference_assets(generation_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_asset_id_idx ON generation_reference_assets(asset_id);
`);

removeLegacyCloudStorageState();

ensureColumn("codex_oauth_tokens", "access_token", "access_token TEXT");
ensureColumn("codex_oauth_tokens", "refresh_token", "refresh_token TEXT");
ensureColumn("codex_oauth_tokens", "id_token", "id_token TEXT");
ensureColumn("codex_oauth_tokens", "email", "email TEXT");
ensureColumn("codex_oauth_tokens", "account_id", "account_id TEXT");
ensureColumn("codex_oauth_tokens", "expires_at", "expires_at TEXT");
ensureColumn("codex_oauth_tokens", "refreshed_at", "refreshed_at TEXT");
ensureColumn("codex_oauth_tokens", "unavailable_at", "unavailable_at TEXT");
ensureColumn("codex_oauth_tokens", "unavailable_reason", "unavailable_reason TEXT");
ensureColumn("provider_configs", "source_order_json", "source_order_json TEXT NOT NULL DEFAULT '[\"env-openai\",\"local-openai\"]'");
ensureColumn("provider_configs", "local_api_key", "local_api_key TEXT");
ensureColumn("provider_configs", "local_base_url", "local_base_url TEXT");
ensureColumn("provider_configs", "local_model", "local_model TEXT");
ensureColumn("provider_configs", "local_timeout_ms", "local_timeout_ms INTEGER");

sqlite.transaction(() => {
  const needsAssetPromptBackfill = !(sqlite.prepare("PRAGMA table_info(assets)").all() as Array<{ name: string; }>).some((column) => column.name === "prompt");
  ensureColumn("assets", "prompt", "prompt TEXT");
  ensureColumn("assets", "effective_prompt", "effective_prompt TEXT");
  if (needsAssetPromptBackfill) {
    sqlite.exec(`
      UPDATE assets SET
        prompt = (SELECT r.prompt FROM generation_outputs o JOIN generation_records r ON r.id = o.generation_id WHERE o.asset_id = assets.id ORDER BY r.created_at DESC LIMIT 1),
        effective_prompt = (SELECT r.effective_prompt FROM generation_outputs o JOIN generation_records r ON r.id = o.generation_id WHERE o.asset_id = assets.id ORDER BY r.created_at DESC LIMIT 1)
      WHERE EXISTS (SELECT 1 FROM generation_outputs WHERE asset_id = assets.id)
    `);
  }
})();

backfillGenerationReferenceAssets();
ensureProviderConfigRow();

export const db = drizzle(sqlite, { schema });

export function closeDatabase(): void {
  sqlite.close();
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string; }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function removeLegacyCloudStorageState(): void {
  sqlite.exec("DROP TABLE IF EXISTS storage_configs");

  const assetColumns = new Set(
    (sqlite.prepare("PRAGMA table_info(assets)").all() as Array<{ name?: string; }>)
      .map((column) => column.name)
      .filter((name): name is string => Boolean(name))
  );
  const legacyColumns = [
    "cloud_provider",
    "cloud_bucket",
    "cloud_region",
    "cloud_object_key",
    "cloud_status",
    "cloud_error",
    "cloud_uploaded_at",
    "cloud_etag",
    "cloud_request_id",
    "cloud_endpoint",
    "cloud_force_path_style"
  ].filter((column) => assetColumns.has(column));

  if (legacyColumns.length > 0) {
    sqlite.exec(`UPDATE assets SET ${legacyColumns.map((column) => `${column} = NULL`).join(", ")}`);
  }
}

function backfillGenerationReferenceAssets(): void {
  sqlite.exec(`
    INSERT OR IGNORE INTO generation_reference_assets (generation_id, asset_id, position, created_at)
    SELECT generation_records.id, generation_records.reference_asset_id, 0, generation_records.created_at
    FROM generation_records
    WHERE generation_records.reference_asset_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM assets
        WHERE assets.id = generation_records.reference_asset_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM generation_reference_assets
        WHERE generation_reference_assets.generation_id = generation_records.id
      )
  `);
}

function ensureProviderConfigRow(): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO provider_configs (id, source_order_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .run("active", JSON.stringify(["env-openai", "local-openai"]), now, now);
}
