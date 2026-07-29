// Server-side Steam inventory loader, ported from the standalone loader.mjs.
//
// Persistence lives behind lib/store.ts: a write-through snapshot per steamid,
// backed by on-disk SQLite (loader.db) by default, or Supabase/Postgres when
// DATABASE_URL is set (so the cache survives an ephemeral filesystem). This
// module owns only the Steam fetch/decode and the in-memory 60s anti-429 floor +
// inflight guard, which are pinned on globalThis so dev HMR doesn't reset them.
//
// Import-only from Node-runtime route handlers (never Edge).

import { decodeLink } from "@csfloat/cs2-inspect-serializer";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import { getSnapshotStore } from "./store";
import type { Backend } from "./store";

// Optional outbound proxy for Steam requests. Steam throttles/blocks the
// community inventory endpoint hard for datacenter IPs (Render, AWS, …), so a
// deployment on such a host can 429 on the very first request — an IP-level
// block shared by every visitor, not a per-user limit. Setting STEAM_PROXY_URL
// (e.g. a residential proxy) routes just the Steam calls through a non-datacenter
// IP. Unset → no-op, and requests go direct exactly as before.
//
// Resolved once and cached (undefined = "not yet checked", null = "no proxy").
let proxyDispatcher: Dispatcher | null | undefined;
function steamDispatcher(): Dispatcher | undefined {
  if (proxyDispatcher === undefined) {
    const url = process.env.STEAM_PROXY_URL?.trim();
    proxyDispatcher = url ? new ProxyAgent(url) : null;
    if (url) console.log(`[steam] routing Steam requests via proxy ${redactProxyUrl(url)}`);
    else console.log("[steam] no STEAM_PROXY_URL set — Steam requests go direct");
  }
  return proxyDispatcher ?? undefined;
}

// Strip credentials from a proxy URL before logging (never log user:pass).
function redactProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "<invalid STEAM_PROXY_URL>";
  }
}

// fetch() for Steam endpoints — routes through the proxy dispatcher when one is
// configured. Uses undici's fetch so the dispatcher and fetch share one undici
// instance (mixing the global fetch with a separately-installed undici's
// dispatcher is what triggers "invalid dispatcher" errors).
function steamFetch(url: string, init?: Parameters<typeof undiciFetch>[1]) {
  return undiciFetch(url, { ...init, dispatcher: steamDispatcher() });
}

// Parse a Retry-After header (delta-seconds or an HTTP date) into ms, or
// undefined when absent/unparseable.
function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

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
  // Decoded locally at sync time from a self-encoding (masked) inspect link via
  // @csfloat/cs2-inspect-serializer — no network, no rate limit. Null when the
  // link can't be decoded (Steam's `%propid:6%` placeholder, referential S/A/D
  // links, or non-skins all carry no embedded data).
  float?: number | null;
  paint_seed?: number | null;
  paint_index?: number | null;
  meta_fetched_at?: number | null;
  // Median market price, resolved at read time from the price table by market
  // name + wear (see priceEntryForMarketName). Null for items with no priced wear.
  price?: number | null;
  // Per-marketplace prices that fed the median (e.g. { steam, skinport }),
  // attached alongside `price` so the inventory card's price modal can show
  // each source. Absent/empty for items with no priced wear.
  priceSources?: Record<string, number> | null;
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

const FLOOR_MS = 60_000; // 60s courtesy floor between non-forced syncs
// After Steam 429s, back off before touching it again. The block is IP-wide
// (shared by every visitor), so this cooldown is global, not per-steamid, and
// grows with each consecutive 429 — retrying a rate limiter immediately only
// digs the hole deeper. A real Retry-After header, when present, wins if larger.
const BLOCK_BASE_MS = 60_000; // first 429 → wait at least 60s
const BLOCK_MAX_MS = 15 * 60_000; // cap the exponential backoff at 15m
const MAX_STRIKES = 6;
// Even a forced (user-initiated) sync keeps a small hard gap so a mashed SYNC
// button can't fire a burst of full inventory fetches at the upstream.
const FORCE_MIN_GAP_MS = 5_000;

// In-memory sync guards (not persisted): floor timestamps, the inflight set, and
// the shared Steam-block cooldown. Pinned on globalThis so dev HMR doesn't reset
// them.
interface Guards {
  lastSync: Map<string, number>; // steamid -> ms
  inflight: Set<string>;
  blockedUntil: number; // epoch ms; Steam-throttle cooldown, shared across all steamids
  strikes: number; // consecutive Steam 429s, drives the exponential backoff
}

declare global {
  // eslint-disable-next-line no-var
  var __steamGuards: Guards | undefined;
}

function guards(): Guards {
  return (globalThis.__steamGuards ??= {
    lastSync: new Map(),
    inflight: new Set(),
    blockedUntil: 0,
    strikes: 0,
  });
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
  // raw_asset_properties=1 makes Steam include the per-item float/seed (the
  // "Wear Rating" / "Pattern Template" the web inventory UI shows) in a top-level
  // `asset_properties` array — public, no auth, no inspect, no bot.
  const url = `https://steamcommunity.com/inventory/${steamid}/730/2?l=english&count=2000&preserve_bbcode=1&raw_asset_properties=1`;
  const r = await steamFetch(url, {
    headers: { Referer: `https://steamcommunity.com/profiles/${steamid}/inventory` },
  });
  console.log(`[steam] GET inventory ${steamid} (raw_asset_properties=1) -> HTTP ${r.status}`);
  if (r.status === 429) {
    // Carry any Retry-After so the cooldown/backoff in syncInventory can honor it.
    throw new SteamError("RATELIMIT", "steam 429", parseRetryAfter(r.headers.get("retry-after")));
  }
  if (r.status === 403) throw new SteamError("PRIVATE", "inventory private");
  if (!r.ok) throw new SteamError("UPSTREAM", `http ${r.status}`);
  const j = (await r.json()) as any;
  if (!j || !j.assets) throw new SteamError("PRIVATE", "no assets returned (likely private)");

  const descByKey = new Map<string, any>();
  for (const d of j.descriptions || []) descByKey.set(`${d.classid}_${d.instanceid}`, d);

  // Map assetid -> { float, paint_seed } from the asset_properties array.
  // propertyid 1 = paint seed (pattern), 2 = paintwear (the float), 6 = item hash.
  const propsByAsset = new Map<string, { float: number | null; paint_seed: number | null }>();
  for (const e of j.asset_properties || []) {
    let float: number | null = null;
    let paint_seed: number | null = null;
    for (const p of e.asset_properties || []) {
      if (p.propertyid === 2 && p.float_value != null) float = Number(p.float_value);
      else if (p.propertyid === 1 && p.int_value != null) paint_seed = Number(p.int_value);
    }
    propsByAsset.set(String(e.assetid), { float, paint_seed });
  }

  const items: InventoryItem[] = j.assets.map((a: any): InventoryItem => {
    const d = descByKey.get(`${a.classid}_${a.instanceid}`) || {};
    const tags = d.tags || [];
    const rarity = (tags.find((t: any) => t.category === "Rarity") || {}).localized_tag_name;
    // Inspect link still captured for reference; for CS2 it's the data-less
    // `%propid:6%` macro now, so the real float comes from asset_properties.
    const action = (d.actions || []).find((x: any) => /Inspect/i.test(x.name));
    const inspect_url: string | null =
      action?.link?.replace("%owner_steamid%", steamid).replace("%assetid%", a.assetid) ?? null;

    // Primary: per-item float/seed from asset_properties (public, no inspect).
    // Fallback: decode a masked inspect link if one is ever present (e.g. a
    // market-listing link or a link pasted by the user).
    const props = propsByAsset.get(String(a.assetid));
    let float = props?.float ?? null;
    let paint_seed = props?.paint_seed ?? null;
    let paint_index: number | null = null;
    if (float == null) {
      const decoded = decodeInspect(inspect_url);
      if (decoded) {
        float = decoded.float;
        paint_seed = paint_seed ?? decoded.paint_seed;
        paint_index = decoded.paint_index;
      }
    }

    return {
      assetid: a.assetid,
      classid: a.classid,
      name: d.market_hash_name || d.market_name || d.name || null,
      icon_url: d.icon_url
        ? `https://community.akamai.steamstatic.com/economy/image/${d.icon_url}/96x96`
        : null,
      rarity: rarity || null,
      inspect_url,
      float,
      paint_seed,
      paint_index,
      meta_fetched_at: float != null ? Date.now() : null,
    };
  });
  const withFloat = items.filter((i) => i.float != null).length;
  console.log(`[steam] parsed ${items.length} assets, ${withFloat} with float`);
  return items;
}

// Decode an inspect link to float/paint with zero network calls. Self-encoding
// (masked) links embed the item data; @csfloat/cs2-inspect-serializer unpacks
// it. Anything else — Steam's `%propid:6%` macro, referential S/A/D links, or a
// missing link — throws inside decodeLink and we return null.
function decodeInspect(
  link: string | null,
): { float: number | null; paint_seed: number | null; paint_index: number | null } | null {
  if (!link) return null;
  try {
    const d = decodeLink(link);
    return {
      float: typeof d.paintwear === "number" ? d.paintwear : null,
      paint_seed: typeof d.paintseed === "number" ? d.paintseed : null,
      paint_index: typeof d.paintindex === "number" ? d.paintindex : null,
    };
  } catch {
    return null;
  }
}

// Enforces the 60s floor + inflight guard, fetches, and writes the snapshot
// through to loader.db. Throws SteamError("FLOOR"|"INFLIGHT"|...) on guard hits.
// `force` skips the 60s floor (user-initiated override); the inflight guard and
// Steam's own 429 still apply, so a forced sync can't stampede the upstream.
export async function syncInventory(
  steamid: string,
  opts: { force?: boolean } = {},
): Promise<{ count: number; changed: boolean }> {
  const g = guards();
  const store = getSnapshotStore();
  const now = Date.now();

  // Shared Steam-block cooldown — applies even to forced syncs. A 429 is levied
  // on our host IP, not on this steamid or user, so once Steam is throttling us
  // *any* further request (forced or not) only extends the block. Short-circuit
  // without touching Steam until the cooldown elapses.
  if (now < g.blockedUntil) {
    throw new SteamError("RATELIMIT", "steam is throttling our server ip", g.blockedUntil - now);
  }

  const last = g.lastSync.get(steamid) || 0;
  if (opts.force) {
    // Forced syncs skip the 60s courtesy floor but keep a small hard gap so a
    // mashed button can't burst full-inventory fetches at the upstream.
    const wait = FORCE_MIN_GAP_MS - (now - last);
    if (wait > 0) throw new SteamError("FLOOR", "rate guard", wait);
  } else {
    const wait = FLOOR_MS - (now - last);
    if (wait > 0) throw new SteamError("FLOOR", "rate guard", wait);
  }
  if (g.inflight.has(steamid)) throw new SteamError("INFLIGHT", "sync in progress");

  g.inflight.add(steamid);
  try {
    const items = await fetchInventory(steamid);
    // Success — clear the strike counter and any lingering cooldown.
    g.lastSync.set(steamid, Date.now());
    g.strikes = 0;
    g.blockedUntil = 0;

    const prev = await store.getSnapshot(steamid);
    const changed =
      !prev ||
      JSON.stringify((JSON.parse(prev.payload) as SnapshotPayload).items.map((i) => i.assetid).sort()) !==
        JSON.stringify(items.map((i) => i.assetid).sort());

    const payload: SnapshotPayload = { items, count: items.length };
    await store.upsertSnapshot(steamid, Date.now(), JSON.stringify(payload));
    return { count: items.length, changed };
  } catch (e) {
    // On a Steam 429, arm the exponential backoff: cooldown grows with each
    // consecutive strike (60s, 2m, 4m, …) capped at 15m, but never shorter than
    // a Retry-After Steam gave us. Re-thrown with the effective wait so the UI
    // can show an honest countdown.
    if (e instanceof SteamError && e.code === "RATELIMIT") {
      g.strikes = Math.min(g.strikes + 1, MAX_STRIKES);
      const backoff = Math.min(BLOCK_BASE_MS * 2 ** (g.strikes - 1), BLOCK_MAX_MS);
      const cooldown = Math.max(e.retryMs ?? 0, backoff);
      g.blockedUntil = Date.now() + cooldown;
      console.warn(`[steam] 429 strike ${g.strikes} — backing off ${Math.round(cooldown / 1000)}s`);
      throw new SteamError("RATELIMIT", "steam is throttling our server ip", cooldown);
    }
    throw e;
  } finally {
    g.inflight.delete(steamid);
  }
}

export async function getSnapshot(steamid: string): Promise<Snapshot | undefined> {
  const store = getSnapshotStore();
  const row = await store.getSnapshot(steamid);
  if (!row) return undefined;
  const payload = JSON.parse(row.payload) as SnapshotPayload;

  // Legacy fill: older snapshots resolved floats into the separate item_meta
  // table. Floats are now decoded into the payload at sync time, so the payload
  // value wins; item_meta only backfills assets a fresh sync hasn't covered yet.
  const metaRows = await store.getMeta(payload.items.map((i) => i.assetid));
  const byId = new Map(metaRows.map((m) => [m.assetid, m]));
  const items = payload.items.map((i) => {
    const m = byId.get(i.assetid);
    if (!m) return i;
    return {
      ...i,
      float: i.float ?? m.float,
      paint_seed: i.paint_seed ?? m.paint_seed,
      paint_index: i.paint_index ?? m.paint_index,
      meta_fetched_at: i.meta_fetched_at ?? m.fetched_at,
    };
  });

  return { fetchedAt: row.fetched_at, items, count: payload.count };
}

// ---------------------------------------------------------------------------
// Cache inspector — read-only integrity report over the snapshot store.
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

export interface CacheReport {
  backend: Backend; // which persistence layer is live: "sqlite" | "postgres"
  schema?: string; // Postgres schema the tables live in (postgres backend only)
  db: { bytes: number; files: { name: string; bytes: number }[] };
  snapshots: SnapshotReport[];
  meta: { total: number; orphans: number; outOfRange: number };
}

export async function getCacheReport(): Promise<CacheReport> {
  const store = getSnapshotStore();

  // item_meta assetids up front: drives both per-snapshot `covered` and the
  // orphan count, in memory, so neither backend does per-snapshot queries.
  const metaIds = await store.allMetaAssetIds();
  const metaSet = new Set(metaIds);

  const snapRows = await store.allSnapshots();
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
      covered = assetids.reduce((n, id) => n + (metaSet.has(id) ? 1 : 0), 0);
    } catch {
      parseOk = false;
    }
    const health: Health = !parseOk ? "corrupt" : storedCount !== actualCount ? "warn" : "ok";
    snapshots.push({
      steamid: r.steamid,
      fetchedAt: r.fetched_at,
      bytes: Buffer.byteLength(r.payload, "utf8"),
      parseOk,
      storedCount,
      actualCount,
      inspectable,
      covered,
      health,
    });
  }

  let orphans = 0;
  for (const id of metaIds) if (!allAssetIds.has(id)) orphans++;
  const outOfRange = await store.metaOutOfRange();
  const db = await store.size();

  return {
    backend: store.backend,
    schema: store.backend === "postgres" ? (process.env.DB_SCHEMA ?? "public") : undefined,
    db,
    snapshots,
    meta: { total: metaIds.length, orphans, outOfRange },
  };
}

interface ClearResult {
  snapshots: number;
  meta: number;
}

/**
 * Force-clears the persistent cache. With a `steamid`, clears only that
 * profile's snapshot and any legacy per-item float/paint meta; with no argument,
 * wipes everything. Also resets the in-memory sync guards so a fresh sync right
 * after a clear isn't blocked by the 60s floor or a stale inflight flag. The
 * database itself is kept (rows are deleted, not the store).
 */
export async function clearCache(steamid?: string): Promise<ClearResult> {
  const store = getSnapshotStore();
  const g = guards();

  if (steamid) {
    // item_meta is keyed by assetid, so scope its delete to this snapshot's assets.
    let meta = 0;
    const row = await store.getSnapshot(steamid);
    if (row) {
      try {
        const ids = (JSON.parse(row.payload) as SnapshotPayload).items.map((i) => i.assetid);
        meta = await store.deleteMetaForAssets(ids);
      } catch {
        // corrupt payload — drop the snapshot row anyway, leave meta untouched
      }
    }
    const snapshots = await store.deleteSnapshot(steamid);
    g.lastSync.delete(steamid);
    g.inflight.delete(steamid);
    return { snapshots, meta };
  }

  const snapshots = await store.deleteAllSnapshots();
  const meta = await store.deleteAllMeta();
  g.lastSync.clear();
  g.inflight.clear();
  g.blockedUntil = 0;
  g.strikes = 0;
  return { snapshots, meta };
}
