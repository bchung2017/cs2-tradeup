// Persistence backend for the Steam inventory loader cache (snapshots +
// item_meta). Two interchangeable implementations sit behind one async
// interface:
//
//   - SQLite  (better-sqlite3, on-disk loader.db) — the zero-config default.
//   - Postgres (node-postgres)                    — used when DATABASE_URL is
//     set, so the cache survives on hosts with an ephemeral filesystem (e.g.
//     Render's free tier). Point DATABASE_URL at a Supabase Session-pooler URI;
//     see .env.example.
//
// Selection is by env at first use: DATABASE_URL present -> Postgres, else
// SQLite. The chosen store is pinned on globalThis so dev HMR doesn't reopen it,
// and only the selected backend's driver is ever constructed.

export type Backend = "sqlite" | "postgres";

export interface SnapshotRow {
  steamid: string;
  fetched_at: number; // epoch ms
  payload: string; // JSON-encoded SnapshotPayload
}

export interface ItemMetaRow {
  assetid: string;
  float: number | null;
  paint_seed: number | null;
  paint_index: number | null;
  fetched_at: number;
}

export interface DbSize {
  bytes: number;
  files: { name: string; bytes: number }[];
}

// The raw, backend-agnostic data-access primitives the loader needs. Domain
// shaping (snapshot health, price attachment, the 60s/inflight guards) stays in
// lib/steam.ts — this layer only reads and writes rows.
export interface SnapshotStore {
  readonly backend: Backend;
  getSnapshot(steamid: string): Promise<SnapshotRow | null>;
  upsertSnapshot(steamid: string, fetchedAt: number, payload: string): Promise<void>;
  getMeta(assetids: string[]): Promise<ItemMetaRow[]>;
  allSnapshots(): Promise<SnapshotRow[]>;
  allMetaAssetIds(): Promise<string[]>;
  metaOutOfRange(): Promise<number>;
  size(): Promise<DbSize>;
  deleteSnapshot(steamid: string): Promise<number>;
  deleteAllSnapshots(): Promise<number>;
  deleteMetaForAssets(assetids: string[]): Promise<number>;
  deleteAllMeta(): Promise<number>;
}

import { SqliteSnapshotStore } from "./store-sqlite";
import { PostgresSnapshotStore } from "./store-postgres";

declare global {
  // eslint-disable-next-line no-var
  var __snapshotStore: SnapshotStore | undefined;
}

// Lazy + memoized: the backend is chosen (and its driver constructed) on the
// first request, never at import time — this keeps `next build` page-data
// collection from opening loader.db or a Postgres pool.
export function getSnapshotStore(): SnapshotStore {
  if (globalThis.__snapshotStore) return globalThis.__snapshotStore;
  const store: SnapshotStore = process.env.DATABASE_URL
    ? new PostgresSnapshotStore()
    : new SqliteSnapshotStore();
  return (globalThis.__snapshotStore = store);
}
