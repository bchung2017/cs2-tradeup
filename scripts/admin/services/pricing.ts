/**
 * Pricing service — orchestration behind the admin Pricing controls.
 *
 * Default sync = MARKET AVERAGE. It pulls every CSGOTrader bulk feed (steam,
 * skinport) in parallel and, per item, averages the available
 * per-source prices into one "market average". Both the average AND the
 * per-source breakdown are persisted in prices.json, so the trade-up EV math
 * reads a blended number while the UI can still show the spread.
 *   • One request per provider, whole catalog — seconds, no rate limit.
 *   • `?providers=steam,skinport` averages a subset (one provider = just that).
 *   • `?force=1` overwrites existing entries; `?dryRun=1` fetches without writing.
 *
 * Fallback = `?source=steam-direct`: Steam's per-item priceoverview as a
 * throttled, resumable background job (for spot-refreshing single items).
 *
 * Layering: source schemas live in ./price-sources; this file builds the
 * catalog work-list, blends, persists, and exposes route adapters.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEAR_RANGES, type PriceTable, type Skin, type Wear } from "../../../types/cs2";
import { boolParam, intParam, intParamOpt, strParam } from "../http";
import type { AdminRequest, AdminResult } from "../types";
import { BULK_PROVIDERS, fetchBulk, fetchSteamItem, type BulkProvider } from "./price-sources";

const DATA_DIR = join(process.cwd(), "public", "data");
const PRICES_FILE = join(DATA_DIR, "prices.json");
const SKINS_FILE = join(DATA_DIR, "skins.json");
const META_FILE = join(DATA_DIR, "prices.meta.json");

const WEARS: Wear[] = WEAR_RANGES.map((r) => r.wear);
const FLUSH_EVERY = 25; // per-item job: persist after this many updates
const MAX_BACKOFF_MS = 60_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface MarketAvgOptions {
  providers: BulkProvider[]; // feeds to average (default all)
  tag?: string;
  wear?: string;
  force: boolean;
  dryRun: boolean;
}

export interface SteamDirectOptions {
  limit?: number; // cap items this run; undefined = ALL pending
  delayMs: number;
  tag?: string;
  wear?: string;
  force: boolean;
  dryRun: boolean;
}

interface PriceMeta {
  source: string;
  lastSync: number | null;
  lastSyncUpdated: number;
  totalKeys: number;
  realKeys: number;
  // Catalog keys whose market_hash_name exists on at least one provider feed —
  // i.e. the items that CAN be priced. The rest of the grid is wear×StatTrak
  // combinations that don't trade on any market, so they're excluded from the
  // "in-frame" coverage ceiling. Computed only on a full market-average sync;
  // null until one has run.
  priceableKeys?: number | null;
}

interface WorkItem {
  key: string; // prices.json key: `${id}|${wear}|${tag}`
  name: string; // market_hash_name
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build the market_hash_name for a catalog skin at a given wear/tag. */
function marketHashName(skin: Skin, wear: Wear, stattrak: boolean): string {
  const base = `${skin.name} (${wear})`; // skin.name already includes the weapon
  return stattrak ? `StatTrak™ ${base}` : base;
}

function loadSkins(): Skin[] {
  return JSON.parse(readFileSync(SKINS_FILE, "utf8")) as Skin[];
}

function loadPrices(): PriceTable {
  if (!existsSync(PRICES_FILE)) return {};
  return JSON.parse(readFileSync(PRICES_FILE, "utf8")) as PriceTable;
}

/** Every (key, market_hash_name) the catalog should have a price for. */
function buildWorkList(skins: Skin[], tag?: string, wear?: string): WorkItem[] {
  const items: WorkItem[] = [];
  for (const s of skins) {
    for (const w of WEARS) {
      if (wear && w !== wear) continue;
      const tags = s.stattrak ? ["norm", "st"] : ["norm"];
      for (const t of tags) {
        if (tag && t !== tag) continue;
        items.push({ key: `${s.id}|${w}|${t}`, name: marketHashName(s, w, t === "st") });
      }
    }
  }
  return items;
}

function countReal(prices: PriceTable): number {
  let n = 0;
  for (const k in prices) if (prices[k].source) n++;
  return n;
}

function persist(prices: PriceTable, source: string, updatedCount: number, priceableKeys?: number): void {
  writeFileSync(PRICES_FILE, JSON.stringify(prices));
  // Carry forward the last known priceable count when this write didn't
  // recompute it (a partial sync or a steam-direct flush).
  const prev: PriceMeta | null = existsSync(META_FILE)
    ? (JSON.parse(readFileSync(META_FILE, "utf8")) as PriceMeta)
    : null;
  const meta: PriceMeta = {
    source,
    lastSync: Date.now(),
    lastSyncUpdated: updatedCount,
    totalKeys: Object.keys(prices).length,
    realKeys: countReal(prices),
    priceableKeys: priceableKeys ?? prev?.priceableKeys ?? null,
  };
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

// ── Market-average sync (default) ───────────────────────────────────────────

export async function syncMarketAverage(opts: MarketAvgOptions): Promise<AdminResult> {
  const providers = opts.providers.length ? opts.providers : BULK_PROVIDERS;
  const skins = loadSkins();
  const prices = loadPrices();
  const work = buildWorkList(skins, opts.tag, opts.wear);

  // One bulk download per provider, in parallel. A provider that fails is
  // simply absent from the average rather than failing the whole sync.
  const fetched = await Promise.all(
    providers.map((p) =>
      fetchBulk(p)
        .then((table) => ({ provider: p, table, error: null as string | null }))
        .catch((e) => ({ provider: p, table: null as Map<string, { median: number }> | null, error: (e as Error).message })),
    ),
  );
  const live = fetched.filter((f) => f.table);
  const failedProviders = fetched.filter((f) => !f.table).map((f) => ({ provider: f.provider, error: f.error }));
  if (!live.length) {
    return { ok: false, error: `all providers failed: ${failedProviders.map((f) => `${f.provider} (${f.error})`).join("; ")}` };
  }

  const stamp = Date.now();
  let updated = 0;
  let unmatched = 0; // not found in ANY provider feed
  let skipped = 0; // already real and not forced
  const sourceHits: Record<string, number> = {};

  for (const w of work) {
    if (!opts.force && prices[w.key]?.source) {
      skipped++;
      continue;
    }
    // Collect each provider's median for this item.
    const sources: Record<string, number> = {};
    for (const { provider, table } of live) {
      const q = table!.get(w.name);
      if (q) {
        sources[provider] = round2(q.median);
        sourceHits[provider] = (sourceHits[provider] ?? 0) + 1;
      }
    }
    const vals = Object.values(sources);
    if (!vals.length) {
      unmatched++;
      continue;
    }
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    prices[w.key] = {
      median: round2(avg), // the market average — what EV math reads
      lowest: round2(Math.min(...vals)),
      volume: 0,
      source: "market-avg",
      sources,
      updatedAt: stamp,
    };
    updated++;
  }

  // Priceable universe = keys present on ≥1 feed = everything we attempted that
  // wasn't unmatched (matched now + already-priced skips). Only meaningful on a
  // full run; a tag/wear-scoped run sees only a slice, so don't overwrite it.
  const fullRun = !opts.tag && !opts.wear;
  const priceable = fullRun ? work.length - unmatched : undefined;
  // Persist on any real write, OR on a full run that recomputed the priceable
  // ceiling. Once the catalog is fully priced, `updated` is 0 every run, so
  // gating solely on updated>0 would never record priceableKeys to the meta.
  if (!opts.dryRun && (updated > 0 || (fullRun && priceable != null))) {
    persist(prices, "market-avg", updated, priceable);
  }

  const realKeys = countReal(prices);
  const totalKeys = Object.keys(prices).length;
  const pct = (num: number, den: number) => (den ? Math.min(100, +((num / den) * 100).toFixed(2)) : 0);
  return {
    ok: true,
    data: {
      source: "market-avg",
      providers: live.map((f) => f.provider),
      failedProviders,
      catalogKeys: work.length,
      updated,
      unmatched, // keys on NO feed — structurally unpriceable
      skipped,
      sourceHits, // how many items each provider contributed to
      dryRun: opts.dryRun,
      forced: opts.force,
      coverage: {
        real: realKeys,
        total: totalKeys,
        percent: pct(realKeys, totalKeys), // raw: priced / whole generated grid
        // In-frame ceiling: priced / keys that actually exist on a feed.
        priceable: priceable ?? null,
        priceablePercent: priceable != null ? pct(realKeys, priceable) : null,
      },
      note: "Each entry stores the per-source breakdown in `sources` and their mean in `median`. Restart the Next app to serve fresh prices.",
    },
  };
}

// ── Steam per-item background job (fallback) ────────────────────────────────

type JobStatus = "idle" | "running" | "done" | "stopped" | "error";

interface PriceJob {
  status: JobStatus;
  total: number;
  attempted: number;
  updated: number;
  missing: number;
  errored: number;
  rateLimitHits: number;
  currentDelayMs: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
}

const idleJob = (): PriceJob => ({
  status: "idle",
  total: 0,
  attempted: 0,
  updated: 0,
  missing: 0,
  errored: 0,
  rateLimitHits: 0,
  currentDelayMs: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
});
let job: PriceJob = idleJob();
let stopRequested = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSteamDirect(opts: SteamDirectOptions): Promise<void> {
  const skins = loadSkins();
  const prices = loadPrices();
  const work = buildWorkList(skins, opts.tag, opts.wear);
  const pendingAll = opts.force ? work : work.filter((w) => !prices[w.key]?.source);
  const cap = opts.limit && opts.limit > 0 ? opts.limit : pendingAll.length;
  const pending = pendingAll.slice(0, cap);

  const baseDelay = opts.delayMs;
  job = { ...idleJob(), status: "running", total: pending.length, currentDelayMs: baseDelay, startedAt: Date.now() };
  stopRequested = false;

  let i = 0;
  let delay = baseDelay;
  let sinceFlush = 0;

  while (i < pending.length) {
    if (stopRequested) {
      job.status = "stopped";
      break;
    }
    const w = pending[i];
    let r: Awaited<ReturnType<typeof fetchSteamItem>>;
    try {
      r = await fetchSteamItem(w.name);
    } catch (e) {
      job.lastError = (e as Error).message;
      r = { kind: "error", status: 0 };
    }

    if (r.kind === "ratelimited") {
      job.rateLimitHits++;
      delay = Math.min(Math.max(delay * 2, 3000), MAX_BACKOFF_MS);
      job.currentDelayMs = delay;
      await sleep(delay);
      continue; // retry the SAME item after backing off
    }

    if (r.kind === "ok") {
      prices[w.key] = { ...r.quote, source: "steam-direct", updatedAt: job.startedAt! };
      job.updated++;
      sinceFlush++;
    } else if (r.kind === "missing") {
      job.missing++;
    } else {
      job.errored++;
    }
    job.attempted++;
    i++;

    if (delay > baseDelay) {
      delay = Math.max(baseDelay, Math.round(delay * 0.8));
      job.currentDelayMs = delay;
    }
    if (!opts.dryRun && sinceFlush >= FLUSH_EVERY) {
      persist(prices, "steam-direct", job.updated);
      sinceFlush = 0;
    }
    if (i < pending.length) await sleep(delay);
  }

  if (!opts.dryRun && job.updated > 0) persist(prices, "steam-direct", job.updated);
  if (job.status === "running") job.status = "done";
  job.finishedAt = Date.now();
}

function jobView() {
  const remaining = Math.max(0, job.total - job.attempted);
  return {
    status: job.status,
    total: job.total,
    attempted: job.attempted,
    updated: job.updated,
    missing: job.missing,
    errored: job.errored,
    rateLimitHits: job.rateLimitHits,
    percent: job.total ? +((job.attempted / job.total) * 100).toFixed(1) : 0,
    currentDelayMs: job.currentDelayMs,
    etaSeconds: job.status === "running" ? Math.round((remaining * job.currentDelayMs) / 1000) : 0,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lastError: job.lastError,
  };
}

export function startSteamDirect(opts: SteamDirectOptions): AdminResult {
  if (job.status === "running") {
    return { ok: true, data: { started: false, alreadyRunning: true, job: jobView() } };
  }
  runSteamDirect(opts).catch((e) => {
    job.status = "error";
    job.lastError = (e as Error).message;
    job.finishedAt = Date.now();
  });
  return {
    ok: true,
    data: {
      started: true,
      source: "steam-direct",
      syncing: job.total,
      dryRun: opts.dryRun,
      forced: opts.force,
      estimateMinutes: +((job.total * job.currentDelayMs) / 1000 / 60).toFixed(1),
      note: "Running in the background — poll status to watch progress, or Stop to cancel.",
    },
  };
}

export function stopSync(): AdminResult {
  if (job.status !== "running") {
    return { ok: true, data: { stopping: false, status: job.status } };
  }
  stopRequested = true;
  return { ok: true, data: { stopping: true, job: jobView() } };
}

// ── Status ──────────────────────────────────────────────────────────────────

export function priceStatus(): AdminResult {
  if (!existsSync(PRICES_FILE)) {
    return { ok: true, data: { exists: false, job: jobView(), note: "no prices.json — run fetch-data or sync prices" } };
  }
  const prices = loadPrices();
  const totalKeys = Object.keys(prices).length;
  let realKeys = 0;
  let multiSource = 0; // entries blended from 2+ sources
  for (const k in prices) {
    const e = prices[k];
    if (e.source) realKeys++;
    if (e.sources && Object.keys(e.sources).length >= 2) multiSource++;
  }
  const st = statSync(PRICES_FILE);
  const meta: PriceMeta | null = existsSync(META_FILE)
    ? (JSON.parse(readFileSync(META_FILE, "utf8")) as PriceMeta)
    : null;
  const lastSync = meta?.lastSync ?? null;

  // Two frames of coverage:
  //  · raw       = priced / every generated grid key (penalised by non-existent
  //                wear×StatTrak combos we over-generate).
  //  · priceable = priced / keys that actually exist on a feed. This is the
  //                honest ceiling — ~100% means "everything that CAN be priced is".
  // priceableKeys is recorded by the last full market-average sync; until one
  // runs we can only show the raw frame.
  const priceableKeys = meta?.priceableKeys ?? null;
  const coverageRawPercent = totalKeys ? +((realKeys / totalKeys) * 100).toFixed(2) : 0;
  const coveragePriceablePercent =
    priceableKeys && priceableKeys > 0 ? Math.min(100, +((realKeys / priceableKeys) * 100).toFixed(2)) : null;

  return {
    ok: true,
    data: {
      exists: true,
      source: meta?.source ?? (realKeys > 0 ? "synced" : "mock (placeholder — run sync)"),
      totalKeys,
      realKeys,
      mockKeys: totalKeys - realKeys,
      multiSourceKeys: multiSource,
      priceableKeys,
      unpriceableKeys: priceableKeys != null ? totalKeys - priceableKeys : null,
      // Headline coverage prefers the priceable frame once it's known.
      coveragePercent: coveragePriceablePercent ?? coverageRawPercent,
      coverageRawPercent,
      coveragePriceablePercent,
      lastSync,
      lastSyncAgeSec: lastSync ? Math.round((Date.now() - lastSync) / 1000) : null,
      fileBytes: st.size,
      fileModified: Math.round(st.mtimeMs),
      job: jobView(),
    },
  };
}

// ── Route adapters (HTTP boundary → service) ───────────────────────────────

/** Parse `?providers=steam,skinport` into a validated BulkProvider list. */
function parseProviders(req: AdminRequest): BulkProvider[] {
  const raw = strParam(req, "providers");
  if (!raw) return BULK_PROVIDERS;
  const picked = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is BulkProvider => (BULK_PROVIDERS as string[]).includes(s));
  return picked.length ? picked : BULK_PROVIDERS;
}

export function syncPricesRoute(req: AdminRequest): AdminResult | Promise<AdminResult> {
  const source = strParam(req, "source") ?? "market-avg";
  if (source === "steam-direct") {
    return startSteamDirect({
      limit: intParamOpt(req, "limit"),
      delayMs: intParam(req, "delayMs", 1500),
      tag: strParam(req, "tag"),
      wear: strParam(req, "wear"),
      force: boolParam(req, "force"),
      dryRun: boolParam(req, "dryRun"),
    });
  }
  // Default: market-average across the CSGOTrader bulk feeds.
  return syncMarketAverage({
    providers: parseProviders(req),
    tag: strParam(req, "tag"),
    wear: strParam(req, "wear"),
    force: boolParam(req, "force"),
    dryRun: boolParam(req, "dryRun"),
  });
}

export function stopSyncRoute(_req: AdminRequest): AdminResult {
  return stopSync();
}

export function priceStatusRoute(_req: AdminRequest): AdminResult {
  return priceStatus();
}
