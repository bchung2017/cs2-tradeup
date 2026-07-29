// Postgres backend (node-postgres) — used when DATABASE_URL is set. Point it at
// a Supabase *Session pooler* URI (port 5432 on *.pooler.supabase.com, the
// IPv4-compatible host; the direct db.*.supabase.co host is IPv6-only and many
// PaaS hosts have no IPv6 egress). This mirrors the SQLite backend row-for-row,
// so the inventory cache persists across restarts/deploys on an ephemeral disk.
//
// This is a direct Postgres connection (like project-city's psycopg layer), not
// the Supabase SDK — there is no SUPABASE_URL / anon key, only DATABASE_URL.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, types } from "pg";
import type { DbSize, ItemMetaRow, SnapshotRow, SnapshotStore } from "./store";

// pg returns BIGINT (type OID 20) as a string by default. Our BIGINTs are
// epoch-ms timestamps and paint ids — all inside JS's safe-integer range — so
// parse them to numbers to match the SQLite backend's shape exactly.
types.setTypeParser(20, (v) => (v == null ? null : Number(v)) as unknown as number);

// The table DDL (db/schema.sql) is the single source of truth, shared with the
// migration script. Read at runtime (server-only) rather than inlined so the two
// can never drift.
function schemaSql(): string {
  return readFileSync(join(/*turbopackIgnore: true*/ process.cwd(), "db", "schema.sql"), "utf8");
}

// Target Postgres schema (namespace). Lets several apps share one database:
// cs2-tradeup can live in its own schema (e.g. "cs2"), separate from whatever
// else is in the project — the tables never touch each other. Defaults to
// "public" (unchanged behavior). Validated as a bare SQL identifier so it can be
// safely interpolated into the connection options and CREATE SCHEMA below.
//
// Note: this pins search_path via the libpq startup `options`, which needs a
// session-mode connection (Supabase's Session pooler on :5432, which we already
// require) — a transaction pooler wouldn't preserve it.
export function pgSchema(): string {
  const s = process.env.DB_SCHEMA ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    throw new Error(
      `Invalid DB_SCHEMA "${s}" — must be a bare SQL identifier ([A-Za-z_][A-Za-z0-9_]*).`,
    );
  }
  return s;
}

// Supabase requires TLS. The pooler presents a cert that doesn't chain to Node's
// default CA bundle, so verify-none is the pragmatic default; set
// DATABASE_SSL=disable for a local plaintext Postgres.
function sslConfig(): false | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === "disable") return false;
  return { rejectUnauthorized: false };
}

export class PostgresSnapshotStore implements SnapshotStore {
  readonly backend = "postgres" as const;
  private pool: Pool | null = null;
  private ready: Promise<void> | null = null;

  // Lazily open the pool and apply the (idempotent) schema exactly once.
  private async conn(): Promise<Pool> {
    const schema = pgSchema();
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: sslConfig(),
        max: Number(process.env.PGPOOL_MAX ?? 3),
        // Pin search_path on every pooled connection so all the (unqualified)
        // queries below resolve into our schema — no per-query qualification and
        // no session-state race across pooled connections.
        options: `-c search_path=${schema}`,
      });
    }
    // Create the schema, then the tables inside it (CREATE TABLE is unqualified;
    // search_path puts it in `schema`). One batch, so it runs on one connection.
    if (!this.ready) {
      this.ready = this.pool
        .query(`CREATE SCHEMA IF NOT EXISTS ${schema}; ${schemaSql()}`)
        .then(() => undefined);
    }
    await this.ready;
    return this.pool;
  }

  async getSnapshot(steamid: string): Promise<SnapshotRow | null> {
    const pool = await this.conn();
    const r = await pool.query<SnapshotRow>(
      "SELECT steamid, fetched_at, payload FROM snapshots WHERE steamid=$1",
      [steamid],
    );
    return r.rows[0] ?? null;
  }

  async upsertSnapshot(steamid: string, fetchedAt: number, payload: string): Promise<void> {
    const pool = await this.conn();
    await pool.query(
      "INSERT INTO snapshots(steamid,fetched_at,payload) VALUES($1,$2,$3) ON CONFLICT(steamid) DO UPDATE SET fetched_at=excluded.fetched_at, payload=excluded.payload",
      [steamid, fetchedAt, payload],
    );
  }

  async getMeta(assetids: string[]): Promise<ItemMetaRow[]> {
    if (!assetids.length) return [];
    const pool = await this.conn();
    const r = await pool.query<ItemMetaRow>(
      "SELECT assetid, float, paint_seed, paint_index, fetched_at FROM item_meta WHERE assetid = ANY($1)",
      [assetids],
    );
    return r.rows;
  }

  async allSnapshots(): Promise<SnapshotRow[]> {
    const pool = await this.conn();
    const r = await pool.query<SnapshotRow>("SELECT steamid, fetched_at, payload FROM snapshots");
    return r.rows;
  }

  async allMetaAssetIds(): Promise<string[]> {
    const pool = await this.conn();
    const r = await pool.query<{ assetid: string }>("SELECT assetid FROM item_meta");
    return r.rows.map((x) => x.assetid);
  }

  async metaOutOfRange(): Promise<number> {
    const pool = await this.conn();
    const r = await pool.query<{ c: number }>(
      "SELECT count(*) AS c FROM item_meta WHERE float IS NOT NULL AND (float < 0 OR float > 1)",
    );
    return Number(r.rows[0].c);
  }

  async size(): Promise<DbSize> {
    const pool = await this.conn();
    const r = await pool.query<{ name: string; bytes: number }>(
      "SELECT t AS name, pg_total_relation_size(t)::bigint AS bytes FROM (VALUES ('snapshots'),('item_meta')) AS x(t)",
    );
    const files = r.rows.map((x) => ({ name: x.name, bytes: Number(x.bytes) }));
    return { bytes: files.reduce((a, f) => a + f.bytes, 0), files };
  }

  async deleteSnapshot(steamid: string): Promise<number> {
    const pool = await this.conn();
    return (await pool.query("DELETE FROM snapshots WHERE steamid=$1", [steamid])).rowCount ?? 0;
  }

  async deleteAllSnapshots(): Promise<number> {
    const pool = await this.conn();
    return (await pool.query("DELETE FROM snapshots")).rowCount ?? 0;
  }

  async deleteMetaForAssets(assetids: string[]): Promise<number> {
    if (!assetids.length) return 0;
    const pool = await this.conn();
    return (await pool.query("DELETE FROM item_meta WHERE assetid = ANY($1)", [assetids])).rowCount ?? 0;
  }

  async deleteAllMeta(): Promise<number> {
    const pool = await this.conn();
    return (await pool.query("DELETE FROM item_meta")).rowCount ?? 0;
  }
}
