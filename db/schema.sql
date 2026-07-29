-- Postgres schema for the Steam inventory loader cache (Supabase backend).
-- Mirrors the SQLite loader.db tables in lib/store-sqlite.ts. Applied
-- automatically on first use by lib/store-postgres.ts and by the migration
-- script (scripts/migrate-sqlite-to-pg.ts). Idempotent — safe to run repeatedly
-- or paste into the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS snapshots (
  steamid    TEXT   PRIMARY KEY,
  fetched_at BIGINT NOT NULL,      -- epoch ms
  payload    TEXT   NOT NULL       -- JSON { items, count }
);

CREATE TABLE IF NOT EXISTS item_meta (
  assetid     TEXT PRIMARY KEY,
  float       DOUBLE PRECISION,
  paint_seed  BIGINT,
  paint_index BIGINT,
  fetched_at  BIGINT NOT NULL
);
