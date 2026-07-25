// SQLite backend (better-sqlite3, on-disk loader.db) — the zero-config default
// when DATABASE_URL is unset. This is the persistence that lived inline in
// lib/steam.ts before the Postgres backend was added; behavior is unchanged.
//
// Native addon + Next.js: import-only from Node-runtime route handlers (never
// Edge). The DB handle is opened lazily on first use and held on the instance
// (which lib/store.ts pins on globalThis), so dev HMR doesn't reopen it.

import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { DbSize, ItemMetaRow, SnapshotRow, SnapshotStore } from "./store";

// SQLite's bound-parameter ceiling is ~999; chunk any IN (...) well under it.
const CHUNK = 500;

export class SqliteSnapshotStore implements SnapshotStore {
  readonly backend = "sqlite" as const;
  private db: Database.Database | null = null;

  private conn(): Database.Database {
    if (this.db) return this.db;
    const db = new Database(join(/*turbopackIgnore: true*/ process.cwd(), "loader.db"));
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS snapshots (
        steamid TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS item_meta (
        assetid TEXT PRIMARY KEY,
        float REAL,
        paint_seed INTEGER,
        paint_index INTEGER,
        fetched_at INTEGER NOT NULL
      );
      -- The standalone deep-sync float resolver is gone: floats are now decoded
      -- locally at sync time. Drop the obsolete job table (and any stale rows).
      DROP TABLE IF EXISTS deep_sync_jobs;`);
    this.db = db;
    return db;
  }

  async getSnapshot(steamid: string): Promise<SnapshotRow | null> {
    const row = this.conn()
      .prepare("SELECT steamid, fetched_at, payload FROM snapshots WHERE steamid=?")
      .get(steamid) as SnapshotRow | undefined;
    return row ?? null;
  }

  async upsertSnapshot(steamid: string, fetchedAt: number, payload: string): Promise<void> {
    this.conn()
      .prepare(
        "INSERT INTO snapshots(steamid,fetched_at,payload) VALUES(?,?,?) ON CONFLICT(steamid) DO UPDATE SET fetched_at=excluded.fetched_at, payload=excluded.payload",
      )
      .run(steamid, fetchedAt, payload);
  }

  async getMeta(assetids: string[]): Promise<ItemMetaRow[]> {
    if (!assetids.length) return [];
    const db = this.conn();
    const out: ItemMetaRow[] = [];
    for (let i = 0; i < assetids.length; i += CHUNK) {
      const chunk = assetids.slice(i, i + CHUNK);
      const rows = db
        .prepare(
          `SELECT assetid, float, paint_seed, paint_index, fetched_at FROM item_meta WHERE assetid IN (${chunk
            .map(() => "?")
            .join(",")})`,
        )
        .all(...chunk) as ItemMetaRow[];
      out.push(...rows);
    }
    return out;
  }

  async allSnapshots(): Promise<SnapshotRow[]> {
    return this.conn().prepare("SELECT steamid, fetched_at, payload FROM snapshots").all() as SnapshotRow[];
  }

  async allMetaAssetIds(): Promise<string[]> {
    const rows = this.conn().prepare("SELECT assetid FROM item_meta").all() as { assetid: string }[];
    return rows.map((r) => r.assetid);
  }

  async metaOutOfRange(): Promise<number> {
    return (
      this.conn()
        .prepare("SELECT count(*) AS c FROM item_meta WHERE float IS NOT NULL AND (float < 0 OR float > 1)")
        .get() as { c: number }
    ).c;
  }

  async size(): Promise<DbSize> {
    const files = ["loader.db", "loader.db-wal", "loader.db-shm"].map((name) => {
      try {
        return { name, bytes: statSync(join(/*turbopackIgnore: true*/ process.cwd(), name)).size };
      } catch {
        return { name, bytes: 0 };
      }
    });
    return { bytes: files.reduce((a, f) => a + f.bytes, 0), files };
  }

  async deleteSnapshot(steamid: string): Promise<number> {
    return this.conn().prepare("DELETE FROM snapshots WHERE steamid=?").run(steamid).changes;
  }

  async deleteAllSnapshots(): Promise<number> {
    return this.conn().prepare("DELETE FROM snapshots").run().changes;
  }

  async deleteMetaForAssets(assetids: string[]): Promise<number> {
    if (!assetids.length) return 0;
    const db = this.conn();
    let n = 0;
    for (let i = 0; i < assetids.length; i += CHUNK) {
      const chunk = assetids.slice(i, i + CHUNK);
      n += db
        .prepare(`DELETE FROM item_meta WHERE assetid IN (${chunk.map(() => "?").join(",")})`)
        .run(...chunk).changes;
    }
    return n;
  }

  async deleteAllMeta(): Promise<number> {
    return this.conn().prepare("DELETE FROM item_meta").run().changes;
  }
}
