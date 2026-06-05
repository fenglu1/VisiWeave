import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureRuntimeStorage, runtimePaths, sqliteConfig } from "./runtime.js";
import * as schema from "./schema.js";

ensureRuntimeStorage();

const sqlite = new Database(runtimePaths.databaseFile);
configureSqlite(sqlite);

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
  cloud_provider TEXT,
  cloud_bucket TEXT,
  cloud_region TEXT,
  cloud_object_key TEXT,
  cloud_status TEXT,
  cloud_error TEXT,
  cloud_uploaded_at TEXT,
  cloud_etag TEXT,
  cloud_request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_configs (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  secret_id TEXT,
  secret_key TEXT,
  bucket TEXT,
  region TEXT,
  key_prefix TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  source_order_json TEXT NOT NULL,
  local_api_key TEXT,
  local_base_url TEXT,
  local_image_provider_format TEXT,
  local_model TEXT,
  local_timeout_ms INTEGER,
  video_kind TEXT,
  video_api_key TEXT,
  video_base_url TEXT,
  video_model TEXT,
  video_text_to_video_url TEXT,
  video_image_to_video_url TEXT,
  video_status_url TEXT,
  video_timeout_ms INTEGER,
  video_poll_interval_ms INTEGER,
  video_ffmpeg_path TEXT,
  video_width INTEGER,
  video_height INTEGER,
  video_fps INTEGER,
  video_interpolation TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_provider_configs (
  kind TEXT PRIMARY KEY NOT NULL,
  api_key TEXT,
  base_url TEXT,
  video_model TEXT,
  text_to_video_url TEXT,
  image_to_video_url TEXT,
  status_url TEXT,
  timeout_ms INTEGER,
  poll_interval_ms INTEGER,
  ffmpeg_path TEXT,
  width INTEGER,
  height INTEGER,
  fps INTEGER,
  interpolation TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_llm_configs (
  id TEXT PRIMARY KEY NOT NULL,
  api_key TEXT,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  supports_vision INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS video_generation_records (
  id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  effective_prompt TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  aspect_ratio TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  reference_asset_id TEXT REFERENCES assets(id),
  progress_percent INTEGER NOT NULL DEFAULT 0,
  progress_stage TEXT NOT NULL DEFAULT 'queued',
  progress_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_generation_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL REFERENCES video_generation_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  asset_id TEXT REFERENCES assets(id),
  provider_job_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS generation_records_created_at_idx ON generation_records(created_at);
CREATE INDEX IF NOT EXISTS generation_outputs_generation_id_idx ON generation_outputs(generation_id);
CREATE INDEX IF NOT EXISTS generation_outputs_asset_id_idx ON generation_outputs(asset_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_generation_id_idx ON generation_reference_assets(generation_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_asset_id_idx ON generation_reference_assets(asset_id);
CREATE INDEX IF NOT EXISTS video_generation_records_created_at_idx ON video_generation_records(created_at);
CREATE INDEX IF NOT EXISTS video_generation_outputs_generation_id_idx ON video_generation_outputs(generation_id);
CREATE INDEX IF NOT EXISTS video_generation_outputs_asset_id_idx ON video_generation_outputs(asset_id);
`);

ensureColumn("assets", "cloud_provider", "cloud_provider TEXT");
ensureColumn("assets", "cloud_bucket", "cloud_bucket TEXT");
ensureColumn("assets", "cloud_region", "cloud_region TEXT");
ensureColumn("assets", "cloud_object_key", "cloud_object_key TEXT");
ensureColumn("assets", "cloud_status", "cloud_status TEXT");
ensureColumn("assets", "cloud_error", "cloud_error TEXT");
ensureColumn("assets", "cloud_uploaded_at", "cloud_uploaded_at TEXT");
ensureColumn("assets", "cloud_etag", "cloud_etag TEXT");
ensureColumn("assets", "cloud_request_id", "cloud_request_id TEXT");
ensureColumn("codex_oauth_tokens", "access_token", "access_token TEXT");
ensureColumn("codex_oauth_tokens", "refresh_token", "refresh_token TEXT");
ensureColumn("codex_oauth_tokens", "id_token", "id_token TEXT");
ensureColumn("codex_oauth_tokens", "email", "email TEXT");
ensureColumn("codex_oauth_tokens", "account_id", "account_id TEXT");
ensureColumn("codex_oauth_tokens", "expires_at", "expires_at TEXT");
ensureColumn("codex_oauth_tokens", "refreshed_at", "refreshed_at TEXT");
ensureColumn("codex_oauth_tokens", "unavailable_at", "unavailable_at TEXT");
ensureColumn("codex_oauth_tokens", "unavailable_reason", "unavailable_reason TEXT");
ensureColumn("provider_configs", "source_order_json", "source_order_json TEXT NOT NULL DEFAULT '[\"env-openai\",\"local-openai\",\"codex\"]'");
ensureColumn("provider_configs", "local_api_key", "local_api_key TEXT");
ensureColumn("provider_configs", "local_base_url", "local_base_url TEXT");
ensureColumn("provider_configs", "local_image_provider_format", "local_image_provider_format TEXT");
ensureColumn("provider_configs", "local_model", "local_model TEXT");
ensureColumn("provider_configs", "local_timeout_ms", "local_timeout_ms INTEGER");
ensureColumn("provider_configs", "video_kind", "video_kind TEXT");
ensureColumn("provider_configs", "video_api_key", "video_api_key TEXT");
ensureColumn("provider_configs", "video_base_url", "video_base_url TEXT");
ensureColumn("provider_configs", "video_model", "video_model TEXT");
ensureColumn("provider_configs", "video_text_to_video_url", "video_text_to_video_url TEXT");
ensureColumn("provider_configs", "video_image_to_video_url", "video_image_to_video_url TEXT");
ensureColumn("provider_configs", "video_status_url", "video_status_url TEXT");
ensureColumn("provider_configs", "video_timeout_ms", "video_timeout_ms INTEGER");
ensureColumn("provider_configs", "video_poll_interval_ms", "video_poll_interval_ms INTEGER");
ensureColumn("provider_configs", "video_ffmpeg_path", "video_ffmpeg_path TEXT");
ensureColumn("provider_configs", "video_width", "video_width INTEGER");
ensureColumn("provider_configs", "video_height", "video_height INTEGER");
ensureColumn("provider_configs", "video_fps", "video_fps INTEGER");
ensureColumn("provider_configs", "video_interpolation", "video_interpolation TEXT");
ensureColumn("agent_llm_configs", "api_key", "api_key TEXT");
ensureColumn("agent_llm_configs", "base_url", "base_url TEXT NOT NULL DEFAULT ''");
ensureColumn("agent_llm_configs", "model", "model TEXT NOT NULL DEFAULT ''");
ensureColumn("agent_llm_configs", "timeout_ms", "timeout_ms INTEGER NOT NULL DEFAULT 60000");
ensureColumn("agent_llm_configs", "supports_vision", "supports_vision INTEGER NOT NULL DEFAULT 0");
ensureColumn("video_generation_records", "progress_percent", "progress_percent INTEGER NOT NULL DEFAULT 0");
ensureColumn("video_generation_records", "progress_stage", "progress_stage TEXT NOT NULL DEFAULT 'queued'");
ensureColumn("video_generation_records", "progress_message", "progress_message TEXT");
ensureColumn("video_generation_outputs", "provider_job_id", "provider_job_id TEXT");

backfillGenerationReferenceAssets();
backfillVideoGenerationProgress();
ensureProviderConfigRow();
backfillVideoProviderConfigs();
ensureAgentLlmConfigRow();

export const db = drizzle(sqlite, { schema });

export function closeDatabase(): void {
  sqlite.close();
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
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

function backfillVideoGenerationProgress(): void {
  sqlite.exec(`
    UPDATE video_generation_records
    SET
      progress_percent = CASE
        WHEN status = 'succeeded' THEN 100
        WHEN status = 'failed' THEN progress_percent
        WHEN status = 'queued' THEN 0
        ELSE 10
      END,
      progress_stage = CASE
        WHEN status = 'succeeded' THEN 'succeeded'
        WHEN status = 'failed' THEN 'failed'
        WHEN status = 'queued' THEN 'queued'
        ELSE 'running'
      END,
      progress_message = CASE
        WHEN status = 'succeeded' THEN 'Video is ready.'
        WHEN status = 'failed' THEN COALESCE(error, progress_message)
        WHEN status = 'queued' THEN 'Queued for video generation.'
        ELSE 'Generating video.'
      END
    WHERE progress_message IS NULL
  `);
}

function ensureProviderConfigRow(): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO provider_configs (id, source_order_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .run("active", JSON.stringify(["env-openai", "local-openai", "codex"]), now, now);
}

function backfillVideoProviderConfigs(): void {
  sqlite.exec(`
    INSERT OR IGNORE INTO video_provider_configs (
      kind,
      api_key,
      base_url,
      video_model,
      text_to_video_url,
      image_to_video_url,
      status_url,
      timeout_ms,
      poll_interval_ms,
      ffmpeg_path,
      width,
      height,
      fps,
      interpolation,
      created_at,
      updated_at
    )
    SELECT
      CASE
        WHEN video_kind IN ('keyframe-image', 'custom-http', 'grok-imagine') THEN video_kind
        ELSE 'keyframe-image'
      END,
      video_api_key,
      video_base_url,
      video_model,
      video_text_to_video_url,
      video_image_to_video_url,
      video_status_url,
      video_timeout_ms,
      video_poll_interval_ms,
      video_ffmpeg_path,
      video_width,
      video_height,
      video_fps,
      video_interpolation,
      created_at,
      updated_at
    FROM provider_configs
    WHERE id = 'active'
      AND (
        video_kind IS NOT NULL
        OR video_api_key IS NOT NULL
        OR video_base_url IS NOT NULL
        OR video_model IS NOT NULL
        OR video_text_to_video_url IS NOT NULL
        OR video_image_to_video_url IS NOT NULL
        OR video_status_url IS NOT NULL
        OR video_timeout_ms IS NOT NULL
        OR video_poll_interval_ms IS NOT NULL
        OR video_ffmpeg_path IS NOT NULL
        OR video_width IS NOT NULL
        OR video_height IS NOT NULL
        OR video_fps IS NOT NULL
        OR video_interpolation IS NOT NULL
      )
  `);
}

function ensureAgentLlmConfigRow(): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO agent_llm_configs
        (id, api_key, base_url, model, timeout_ms, supports_vision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("active", null, "", "", 60000, 0, now, now);
}
