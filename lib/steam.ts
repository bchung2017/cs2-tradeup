// Server-side Steam inventory loader, ported from the standalone loader.mjs.
//
// The loader used node:sqlite (DatabaseSync) — a Node 22.5+ built-in that does
// not exist on this app's Node 20 runtime. SQLite itself is fine on Node 20; we
// just reach it through the better-sqlite3 npm package instead, which exposes
// the same synchronous .exec/.prepare/.run/.get API the loader was written for.
// Behavior is preserved 1:1: a write-through snapshot per steamid (on disk in
// loader.db), a 60s anti-429 floor, and an inflight guard.
//
// Native addon + Next.js: this module is import-only from Node-runtime route
// handlers (never Edge), and the DB handle + in-memory guards are pinned on
// globalThis so dev HMR doesn't open the database twice.

import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { join } from "node:path";

export interface InventoryItem {
  assetid: string;
  classid: string;
  name: string | null;
  icon_url: string | null;
  rarity: string | null;
  // Captured for free during fetchInventory; the rest are filled by a per-item
  // (deep) sync and merged in at read time from the item_meta table. All
  // optional so existing snapshots and the basic flow are unaffected.
  inspect_url?: string | null;
  float?: number | null;
  paint_seed?: number | null;
  paint_index?: number | null;
  meta_fetched_at?: number | null;
}

interface SnapshotPayload {
  items: InventoryItem[];
  count: number;
}

export interface Snapshot {
  fetchedAt: number;
  items: InventoryItem[];
  count: number;
}

export const FLOOR_MS = 60_000; // 60s anti-429 floor

// Per-item metadata that never changes for a given assetid (float / paint).
export interface ItemMeta {
  float: number | null;
  paint_seed: number | null;
  paint_index: number | null;
  fetched_at: number;
}

// A persistent per-item (deep) sync job. The item_meta table is the real ledger
// of progress; this row only holds control intent + display counters.
export interface DeepSyncJob {
  steamid: string;
  status: string; // 'running' | 'paused' | 'stopped' | 'done' | 'error'
  total: number;
  done: number;
  error: string | null;
  started_at: number;
  updated_at: number; // heartbeat
}

interface SteamStore {
  db: Database.Database;
  upsertSnap: Database.Statement;
  getSnap: Database.Statement;
  upsertMeta: Database.Statement;
  upsertJob: Database.Statement;
  getJob: Database.Statement;
  bumpJob: Database.Statement;
  touchJob: Database.Statement;
  finishJob: Database.Statement;
  lastSync: Map<string, number>; // steamid -> ms
  inflight: Set<string>;
  deepInflight: Set<string>; // one deep-sync worker per steamid per process
}

declare global {
  // eslint-disable-next-line no-var
  var __steamStore: SteamStore | undefined;
}

function initStore(): SteamStore {
  const db = new Database(join(process.cwd(), "loader.db"));
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
    CREATE TABLE IF NOT EXISTS deep_sync_jobs (
      steamid TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      total INTEGER NOT NULL,
      done INTEGER NOT NULL,
      error TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
  return {
    db,
    upsertSnap: db.prepare(
      "INSERT INTO snapshots(steamid,fetched_at,payload) VALUES(?,?,?) ON CONFLICT(steamid) DO UPDATE SET fetched_at=excluded.fetched_at, payload=excluded.payload",
    ),
    getSnap: db.prepare("SELECT fetched_at, payload FROM snapshots WHERE steamid=?"),
    upsertMeta: db.prepare(
      "INSERT INTO item_meta(assetid,float,paint_seed,paint_index,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(assetid) DO UPDATE SET float=excluded.float, paint_seed=excluded.paint_seed, paint_index=excluded.paint_index, fetched_at=excluded.fetched_at",
    ),
    upsertJob: db.prepare(
      "INSERT INTO deep_sync_jobs(steamid,status,total,done,error,started_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(steamid) DO UPDATE SET status=excluded.status, total=excluded.total, done=excluded.done, error=excluded.error, started_at=excluded.started_at, updated_at=excluded.updated_at",
    ),
    getJob: db.prepare("SELECT * FROM deep_sync_jobs WHERE steamid=?"),
    bumpJob: db.prepare("UPDATE deep_sync_jobs SET done=done+1, updated_at=? WHERE steamid=?"),
    touchJob: db.prepare("UPDATE deep_sync_jobs SET status=?, updated_at=? WHERE steamid=?"),
    finishJob: db.prepare("UPDATE deep_sync_jobs SET status=?, error=?, updated_at=? WHERE steamid=?"),
    lastSync: new Map(),
    inflight: new Set(),
    deepInflight: new Set(),
  };
}

// Lazy: the DB is opened on first actual request, never at import time. This
// keeps `next build` (which imports route modules across many parallel workers
// just to collect page data) from racing to open loader.db in WAL mode.
function getStore(): SteamStore {
  return globalThis.__steamStore ?? (globalThis.__steamStore = initStore());
}

// Errors carry a `code` so route handlers can map them to HTTP status, exactly
// like the loader's throw { code, message } convention.
export class SteamError extends Error {
  code: string;
  retryMs?: number;
  constructor(code: string, message: string, retryMs?: number) {
    super(message);
    this.code = code;
    this.retryMs = retryMs;
  }
}

// accepts: steamid64, vanity, full profile url, /id/<vanity>, /profiles/<id>
export async function resolveSteamId(raw: string): Promise<string> {
  let s = String(raw).trim();
  const profMatch = s.match(/\/profiles\/(\d{17})/);
  if (profMatch) return profMatch[1];
  const idMatch = s.match(/\/id\/([^/?#]+)/);
  if (idMatch) s = idMatch[1];
  if (/^\d{17}$/.test(s)) return s;

  const KEY = process.env.STEAM_API_KEY;
  if (!KEY) {
    throw new SteamError("RESOLVE", "STEAM_API_KEY not set — vanity lookup unavailable (use a steamid64 or profile URL)");
  }
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${KEY}&vanityurl=${encodeURIComponent(s)}`;
  const r = await fetch(url);
  if (!r.ok) throw new SteamError("RESOLVE", `vanity lookup http ${r.status}`);
  const j = await r.json();
  if (j.response?.success !== 1) throw new SteamError("RESOLVE", j.response?.message || "no such vanity");
  return j.response.steamid;
}

export async function fetchInventory(steamid: string): Promise<InventoryItem[]> {
  // CS2 = appid 730, context 2. Steam community endpoint; Referer matters.
  const url = `https://steamcommunity.com/inventory/${steamid}/730/2?l=english&count=2000`;
  const r = await fetch(url, {
    headers: { Referer: `https://steamcommunity.com/profiles/${steamid}/inventory` },
  });
  if (r.status === 429) throw new SteamError("RATELIMIT", "steam 429");
  if (r.status === 403) throw new SteamError("PRIVATE", "inventory private");
  if (!r.ok) throw new SteamError("UPSTREAM", `http ${r.status}`);
  const j = await r.json();
  if (!j || !j.assets) throw new SteamError("PRIVATE", "no assets returned (likely private)");

  const descByKey = new Map<string, any>();
  for (const d of j.descriptions || []) descByKey.set(`${d.classid}_${d.instanceid}`, d);

  return j.assets.map((a: any): InventoryItem => {
    const d = descByKey.get(`${a.classid}_${a.instanceid}`) || {};
    const tags = d.tags || [];
    const rarity = (tags.find((t: any) => t.category === "Rarity") || {}).localized_tag_name;
    // The "Inspect in Game" action carries the inspect link with %owner_steamid%
    // / %assetid% placeholders. Capturing it now is free; a deep sync resolves it
    // later for float/paint. (Not every item has one — stickers, cases, etc.)
    const action = (d.actions || []).find((x: any) => /Inspect/i.test(x.name));
    const inspect_url: string | null =
      action?.link?.replace("%owner_steamid%", steamid).replace("%assetid%", a.assetid) ?? null;
    return {
      assetid: a.assetid,
      classid: a.classid,
      name: d.market_hash_name || d.market_name || d.name || null,
      icon_url: d.icon_url
        ? `https://community.akamai.steamstatic.com/economy/image/${d.icon_url}/96x96`
        : null,
      rarity: rarity || null,
      inspect_url,
    };
  });
}

// Enforces the 60s floor + inflight guard, fetches, and writes the snapshot
// through to loader.db. Throws SteamError("FLOOR"|"INFLIGHT"|...) on guard hits.
// `force` skips the 60s floor (user-initiated override); the inflight guard and
// Steam's own 429 still apply, so a forced sync can't stampede the upstream.
export async function syncInventory(
  steamid: string,
  opts: { force?: boolean } = {},
): Promise<{ count: number; changed: boolean }> {
  const store = getStore();
  if (!opts.force) {
    const last = store.lastSync.get(steamid) || 0;
    const wait = FLOOR_MS - (Date.now() - last);
    if (wait > 0) throw new SteamError("FLOOR", "rate guard", wait);
  }
  if (store.inflight.has(steamid)) throw new SteamError("INFLIGHT", "sync in progress");

  store.inflight.add(steamid);
  try {
    const items = await fetchInventory(steamid);
    store.lastSync.set(steamid, Date.now());

    const prevRow = store.getSnap.get(steamid) as { payload: string } | undefined;
    const changed =
      !prevRow ||
      JSON.stringify((JSON.parse(prevRow.payload) as SnapshotPayload).items.map((i) => i.assetid).sort()) !==
        JSON.stringify(items.map((i) => i.assetid).sort());

    const payload: SnapshotPayload = { items, count: items.length };
    store.upsertSnap.run(steamid, Date.now(), JSON.stringify(payload));
    return { count: items.length, changed };
  } finally {
    store.inflight.delete(steamid);
  }
}

// Fetch item_meta rows for a set of assetids, keyed by assetid. The IN-clause
// size varies per call, so the statement is built per call rather than pinned.
function getMetaForAssets(store: SteamStore, assetids: string[]): Map<string, ItemMeta> {
  const byId = new Map<string, ItemMeta>();
  if (assetids.length === 0) return byId;
  const rows = store.db
    .prepare(
      `SELECT assetid, float, paint_seed, paint_index, fetched_at FROM item_meta WHERE assetid IN (${assetids.map(() => "?").join(",")})`,
    )
    .all(...assetids) as Array<{
    assetid: string;
    float: number | null;
    paint_seed: number | null;
    paint_index: number | null;
    fetched_at: number;
  }>;
  for (const r of rows) {
    byId.set(r.assetid, {
      float: r.float,
      paint_seed: r.paint_seed,
      paint_index: r.paint_index,
      fetched_at: r.fetched_at,
    });
  }
  return byId;
}

export function getSnapshot(steamid: string): Snapshot | undefined {
  const store = getStore();
  const row = store.getSnap.get(steamid) as { fetched_at: number; payload: string } | undefined;
  if (!row) return undefined;
  const payload = JSON.parse(row.payload) as SnapshotPayload;

  // Merge in any per-item metadata captured by a deep sync. Items with no meta
  // row are returned unchanged, so this degrades gracefully to today's behavior.
  const byId = getMetaForAssets(
    store,
    payload.items.map((i) => i.assetid),
  );
  const items = payload.items.map((i) => {
    const m = byId.get(i.assetid);
    return m
      ? {
          ...i,
          float: m.float,
          paint_seed: m.paint_seed,
          paint_index: m.paint_index,
          meta_fetched_at: m.fetched_at,
        }
      : i;
  });

  return { fetchedAt: row.fetched_at, items, count: payload.count };
}

// ---------------------------------------------------------------------------
// Deep-sync job control (the engine itself lands in a later phase).
// ---------------------------------------------------------------------------

export function getJob(steamid: string): DeepSyncJob | undefined {
  return getStore().getJob.get(steamid) as DeepSyncJob | undefined;
}

export type JobControl = "pause" | "stop" | "resume";

// Maps a control action onto the job's status (+ heartbeat). Returns the updated
// row, or undefined if there is no job to control.
export function controlJob(steamid: string, action: JobControl): DeepSyncJob | undefined {
  const store = getStore();
  const existing = store.getJob.get(steamid) as DeepSyncJob | undefined;
  if (!existing) return undefined;
  const status = action === "resume" ? "running" : action === "pause" ? "paused" : "stopped";
  store.touchJob.run(status, Date.now(), steamid);
  return store.getJob.get(steamid) as DeepSyncJob | undefined;
}

// ---------------------------------------------------------------------------
// Deep-sync engine — resolves per-item float/paint via inspect links.
// ---------------------------------------------------------------------------

const THROTTLE_MS = 1500; // gap between per-item lookups (be gentle to the float source)

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export interface ResolvedMeta {
  float: number | null;
  paint_seed: number | null;
  paint_index: number | null;
}

// The single float-source abstraction. Default impl hits the CSFloat API; swap
// this body for a self-hosted node-globaloffensive inspect bot to drop the
// third-party rate limit. Needs CSFLOAT_API_KEY for authenticated throughput.
async function resolveFloat(inspectUrl: string): Promise<ResolvedMeta> {
  const KEY = process.env.CSFLOAT_API_KEY;
  const url = `https://api.csgofloat.com/?url=${encodeURIComponent(inspectUrl)}`;
  const r = await fetch(url, KEY ? { headers: { Authorization: KEY } } : undefined);
  if (r.status === 429) throw new SteamError("RATELIMIT", "csfloat 429");
  if (!r.ok) throw new SteamError("UPSTREAM", `csfloat http ${r.status}`);
  const j = await r.json();
  const info = j.iteminfo || {};
  return {
    float: typeof info.floatvalue === "number" ? info.floatvalue : null,
    paint_seed: typeof info.paintseed === "number" ? info.paintseed : null,
    paint_index: typeof info.paintindex === "number" ? info.paintindex : null,
  };
}

export type DeepSyncEvent =
  | { type: "start"; total: number }
  | { type: "item"; assetid: string; float: number | null; done: number; total: number }
  | { type: "halted"; status: string }
  | { type: "error"; error: string }
  | { type: "done"; done: number; total: number };

// Async generator that walks the snapshot's inspectable, not-yet-resolved items,
// writing each float to item_meta (the durable ledger) as it goes. Re-reads the
// job row every iteration so pause/stop/abort halt cleanly; skipping already-
// cached floats makes resume free. One worker per steamid per process.
export async function* deepSyncInventory(
  steamid: string,
  signal?: AbortSignal,
): AsyncGenerator<DeepSyncEvent> {
  const store = getStore();
  if (store.deepInflight.has(steamid)) throw new SteamError("INFLIGHT", "deep sync in progress");
  store.deepInflight.add(steamid);
  try {
    const snap = getSnapshot(steamid);
    const todo = (snap?.items ?? []).filter((i) => i.inspect_url && i.float == null);
    const total = todo.length;
    const now = Date.now();
    store.upsertJob.run(steamid, "running", total, 0, null, now, now);
    yield { type: "start", total };

    let done = 0;
    for (const item of todo) {
      const job = store.getJob.get(steamid) as DeepSyncJob | undefined;
      if (signal?.aborted || !job || job.status !== "running") {
        if (job && job.status === "running") store.touchJob.run("paused", Date.now(), steamid);
        yield { type: "halted", status: signal?.aborted ? "aborted" : (job?.status ?? "missing") };
        return;
      }

      let resolved: ResolvedMeta;
      try {
        resolved = await resolveFloat(item.inspect_url as string);
      } catch (e) {
        const msg = (e as Error).message;
        store.finishJob.run("error", msg, Date.now(), steamid);
        yield { type: "error", error: msg };
        return;
      }
      store.upsertMeta.run(item.assetid, resolved.float, resolved.paint_seed, resolved.paint_index, Date.now());
      done++;
      store.bumpJob.run(Date.now(), steamid);
      yield { type: "item", assetid: item.assetid, float: resolved.float, done, total };
      await sleep(THROTTLE_MS);
    }

    store.finishJob.run("done", null, Date.now(), steamid);
    yield { type: "done", done, total };
  } finally {
    store.deepInflight.delete(steamid);
  }
}

// ---------------------------------------------------------------------------
// Cache inspector — read-only integrity report over loader.db.
// ---------------------------------------------------------------------------

type Health = "ok" | "warn" | "corrupt";

export interface SnapshotReport {
  steamid: string;
  fetchedAt: number;
  bytes: number; // payload length
  parseOk: boolean;
  storedCount: number | null; // count field inside payload
  actualCount: number | null; // items.length
  inspectable: number | null; // items carrying an inspect_url
  covered: number | null; // item_meta rows present for this snapshot's assets
  health: Health;
}

export interface JobReport {
  steamid: string;
  status: string;
  total: number;
  done: number;
  error: string | null;
  started_at: number;
  updated_at: number;
  health: Health;
}

export interface CacheReport {
  db: { bytes: number; files: { name: string; bytes: number }[] };
  snapshots: SnapshotReport[];
  meta: { total: number; orphans: number; outOfRange: number };
  jobs: JobReport[];
}

const JOB_STALE_MS = 30_000;

export function getCacheReport(): CacheReport {
  const store = getStore();
  const db = store.db;

  const snapRows = db
    .prepare("SELECT steamid, fetched_at, length(payload) AS bytes, payload FROM snapshots")
    .all() as Array<{ steamid: string; fetched_at: number; bytes: number; payload: string }>;

  const allAssetIds = new Set<string>();
  const snapshots: SnapshotReport[] = [];
  for (const r of snapRows) {
    let parseOk = true;
    let storedCount: number | null = null;
    let actualCount: number | null = null;
    let inspectable: number | null = null;
    let covered: number | null = null;
    let assetids: string[] = [];
    try {
      const p = JSON.parse(r.payload) as SnapshotPayload;
      storedCount = p.count;
      actualCount = p.items.length;
      inspectable = p.items.filter((i) => i.inspect_url).length;
      assetids = p.items.map((i) => i.assetid);
      for (const id of assetids) allAssetIds.add(id);
    } catch {
      parseOk = false;
    }
    if (parseOk) {
      covered = assetids.length
        ? (
            db
              .prepare(
                `SELECT count(*) AS c FROM item_meta WHERE assetid IN (${assetids.map(() => "?").join(",")})`,
              )
              .get(...assetids) as { c: number }
          ).c
        : 0;
    }
    const health: Health = !parseOk ? "corrupt" : storedCount !== actualCount ? "warn" : "ok";
    snapshots.push({
      steamid: r.steamid,
      fetchedAt: r.fetched_at,
      bytes: r.bytes,
      parseOk,
      storedCount,
      actualCount,
      inspectable,
      covered,
      health,
    });
  }

  const metaTotal = (db.prepare("SELECT count(*) AS c FROM item_meta").get() as { c: number }).c;
  const outOfRange = (
    db
      .prepare("SELECT count(*) AS c FROM item_meta WHERE float IS NOT NULL AND (float < 0 OR float > 1)")
      .get() as { c: number }
  ).c;
  const metaIds = db.prepare("SELECT assetid FROM item_meta").all() as Array<{ assetid: string }>;
  let orphans = 0;
  for (const m of metaIds) if (!allAssetIds.has(m.assetid)) orphans++;

  // deep_sync_jobs is created in a later phase; tolerate its absence.
  let jobs: JobReport[] = [];
  const hasJobs = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deep_sync_jobs'")
    .get();
  if (hasJobs) {
    const jr = db
      .prepare("SELECT steamid, status, total, done, error, started_at, updated_at FROM deep_sync_jobs")
      .all() as Array<Omit<JobReport, "health">>;
    jobs = jr.map((j) => {
      const health: Health =
        j.done > j.total
          ? "corrupt"
          : j.status === "paused" || (j.status === "running" && Date.now() - j.updated_at > JOB_STALE_MS)
            ? "warn"
            : "ok";
      return { ...j, health };
    });
  }

  const files = ["loader.db", "loader.db-wal", "loader.db-shm"].map((name) => {
    try {
      return { name, bytes: statSync(join(process.cwd(), name)).size };
    } catch {
      return { name, bytes: 0 };
    }
  });
  const bytes = files.reduce((a, f) => a + f.bytes, 0);

  return { db: { bytes, files }, snapshots, meta: { total: metaTotal, orphans, outOfRange }, jobs };
}
