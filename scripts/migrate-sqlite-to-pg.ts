/**
 * One-shot copy of the on-disk SQLite loader cache into Postgres (Supabase).
 *
 * Run ONCE, after pointing DATABASE_URL at your Supabase Session-pooler URI, to
 * carry an existing loader.db (snapshots + item_meta) over:
 *
 *     DATABASE_URL='postgresql://...pooler.supabase.com:5432/postgres' \
 *       npm run migrate-db -- [path/to/loader.db]
 *
 * Both tables use natural TEXT primary keys (steamid / assetid), so there are no
 * SERIAL sequences to advance. It applies the schema first (idempotent), then
 * refuses to run if the target tables already hold rows, so a second accidental
 * run can't double-insert.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { pgSchema } from "../lib/store-postgres";

interface SnapRow {
  steamid: string;
  fetched_at: number;
  payload: string;
}
interface MetaRow {
  assetid: string;
  float: number | null;
  paint_seed: number | null;
  paint_index: number | null;
  fetched_at: number;
}

async function main() {
  const srcPath = process.argv[2] ?? join(process.cwd(), "loader.db");
  const dsn = process.env.DATABASE_URL;
  if (!dsn) {
    console.error("DATABASE_URL not set — nothing to migrate into.");
    process.exit(1);
  }

  const schema = pgSchema();
  const src = new Database(srcPath, { readonly: true });
  const dst = new Pool({
    connectionString: dsn,
    ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
    options: `-c search_path=${schema}`,
  });

  try {
    // Make sure the destination schema + tables exist (safe to run repeatedly).
    // All queries below are unqualified; search_path lands them in `schema`.
    await dst.query(
      `CREATE SCHEMA IF NOT EXISTS ${schema}; ` +
        readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"),
    );
    console.log(`target schema: ${schema}`);

    for (const table of ["snapshots", "item_meta"]) {
      const n = Number((await dst.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
      if (n) {
        console.error(`refusing to run: ${table} already has ${n} rows in Postgres`);
        process.exit(1);
      }
    }

    let total = 0;

    const snaps = src
      .prepare("SELECT steamid, fetched_at, payload FROM snapshots")
      .all() as SnapRow[];
    for (const s of snaps) {
      await dst.query("INSERT INTO snapshots(steamid,fetched_at,payload) VALUES($1,$2,$3)", [
        s.steamid,
        s.fetched_at,
        s.payload,
      ]);
    }
    console.log(`snapshots: ${snaps.length} rows`);
    total += snaps.length;

    const metas = src
      .prepare("SELECT assetid, float, paint_seed, paint_index, fetched_at FROM item_meta")
      .all() as MetaRow[];
    for (const m of metas) {
      await dst.query(
        "INSERT INTO item_meta(assetid,float,paint_seed,paint_index,fetched_at) VALUES($1,$2,$3,$4,$5)",
        [m.assetid, m.float, m.paint_seed, m.paint_index, m.fetched_at],
      );
    }
    console.log(`item_meta: ${metas.length} rows`);
    total += metas.length;

    console.log(`done — ${total} rows copied`);
  } finally {
    src.close();
    await dst.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
