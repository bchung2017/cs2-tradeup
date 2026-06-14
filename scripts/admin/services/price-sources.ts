/**
 * Price sources — the external feeds, isolated behind a uniform shape so the
 * pricing orchestrator (./pricing) doesn't care where a number came from.
 *
 * Two kinds:
 *   • BULK (default): CSGOTrader's free per-market dumps at
 *     prices.csgotrader.app/latest/<provider>.json — one request returns the
 *     whole catalog keyed by market_hash_name. `steam` gives REAL Steam market
 *     medians (the bulk Steam feed Steam itself doesn't expose); `skinport` /
 *     `buff163` give those aftermarkets. Open-source project, courtesy
 *     attribution appreciated.
 *   • PER-ITEM (fallback): Steam's official priceoverview endpoint — canonical
 *     but rate-limited; used to spot-refresh single items.
 */

/** Normalized quote every source maps onto. */
export interface PriceQuote {
  median: number;
  lowest: number;
  volume: number;
}

// ── CSGOTrader bulk providers ───────────────────────────────────────────────

const CSGOTRADER_BASE = "https://prices.csgotrader.app/latest";

export type BulkProvider = "steam" | "skinport" | "buff163";
export const BULK_PROVIDERS: BulkProvider[] = ["steam", "skinport", "buff163"];

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Per-provider extractors map each feed's raw shape onto a PriceQuote.
 * Verified live shapes:
 *   steam:    { last_24h, last_7d, last_30d, last_90d }
 *   skinport: { starting_at, suggested_price }
 *   buff163:  { starting_at: { price }, highest_order: { price } }
 */
const EXTRACTORS: Record<BulkProvider, (raw: unknown) => PriceQuote | null> = {
  steam: (raw) => {
    const r = raw as { last_24h?: number; last_7d?: number; last_30d?: number; last_90d?: number };
    const m = num(r.last_24h) ?? num(r.last_7d) ?? num(r.last_30d) ?? num(r.last_90d);
    // Steam feed is a rolling median only — no separate lowest/volume.
    return m == null ? null : { median: m, lowest: m, volume: 0 };
  },
  skinport: (raw) => {
    const r = raw as { starting_at?: number; suggested_price?: number };
    const start = num(r.starting_at);
    const suggested = num(r.suggested_price);
    const m = suggested ?? start;
    return m == null ? null : { median: m, lowest: start ?? m, volume: 0 };
  },
  buff163: (raw) => {
    const r = raw as { starting_at?: { price?: number }; highest_order?: { price?: number } };
    const start = num(r.starting_at?.price);
    const order = num(r.highest_order?.price);
    const m = start ?? order;
    return m == null ? null : { median: m, lowest: order ?? m, volume: 0 };
  },
};

/** Download a provider's full dump and return a market_hash_name → quote map. */
export async function fetchBulk(provider: BulkProvider): Promise<Map<string, PriceQuote>> {
  const res = await fetch(`${CSGOTRADER_BASE}/${provider}.json`, {
    headers: { "user-agent": "cs2-tradeup-admin/price-sync" },
  });
  if (!res.ok) throw new Error(`csgotrader ${provider}.json: http ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  const extract = EXTRACTORS[provider];
  const out = new Map<string, PriceQuote>();
  for (const name in raw) {
    const q = extract(raw[name]);
    if (q) out.set(name, q);
  }
  return out;
}

// ── Steam per-item (fallback) ───────────────────────────────────────────────

const STEAM_URL = "https://steamcommunity.com/market/priceoverview/";

export type SteamItemResult =
  | { kind: "ok"; quote: PriceQuote }
  | { kind: "missing" } // item/wear doesn't trade on the market
  | { kind: "ratelimited" }
  | { kind: "error"; status: number };

/** "$1,234.56" → 1234.56; null if unparseable/absent. currency=1 is USD. */
function parseMoney(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function fetchSteamItem(name: string): Promise<SteamItemResult> {
  const url = `${STEAM_URL}?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { "user-agent": "cs2-tradeup-admin/price-sync" } });
  if (res.status === 429) return { kind: "ratelimited" };
  if (!res.ok) return { kind: "error", status: res.status };
  const j = (await res.json()) as { success?: boolean; median_price?: string; lowest_price?: string; volume?: string };
  if (!j || j.success === false) return { kind: "missing" };
  const median = parseMoney(j.median_price);
  const lowest = parseMoney(j.lowest_price);
  if (median == null && lowest == null) return { kind: "missing" };
  const volume = j.volume ? Number(j.volume.replace(/[^0-9]/g, "")) || 0 : 0;
  return { kind: "ok", quote: { median: median ?? lowest!, lowest: lowest ?? median!, volume } };
}
