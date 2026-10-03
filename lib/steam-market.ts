/**
 * Live Steam Community Market reads, unauthenticated, for the IGL-9000 checks.
 *
 *   priceOverview(name)            lowest listing, median sale, 24h volume for one
 *                                  market_hash_name (per wear grade, float-blind)
 *   cheapestAtFloat(name, lo, hi)  the cheapest listings whose float lies in
 *                                  [lo, hi]: what a contract input really costs
 *
 * Float-filtered listings come from the market page itself. Its URL accepts the
 * same query the page's float slider builds:
 *   assetproperty     base64 protobuf {1: property_id=2 (wear), 2: float_min, 3: float_max}
 *   category_Quality  normal (drops StatTrak/Souvenir, which share the item group)
 *   category_Exterior WearCategory0..4 (FN..BS)
 *   start             page offset, 20 listings per page, sorted by price ascending
 * The server renders the first page into window.SSR.renderContext as a react-query
 * cache entry keyed "market_item_search". This is page data, not a documented API:
 * if its shape changes, parsing throws rather than returning a wrong price.
 *
 * curl, not fetch: it honours the environment's HTTPS proxy. Requests are spaced,
 * back off on 429, stop for the run once throttled, and are cached for 6 h.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { WEAR_RANGES } from "@/types/cs2";

export interface Overview { lowest: number | null; median: number | null; volume: number }
export interface FloatListing { float: number; price: number } // price = what the buyer pays, USD
export interface FloatBook {
  listings: FloatListing[]; // cheapest first, at most n
  total: number; // listings matching the filter on Steam
}

const CACHE = "node_modules/.cache/igl9000-steam.json";
const TTL = 6 * 3600e3;
const BACKOFF_MS = [60_000, 120_000];
const PAGE = 20;

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const usd = (s?: string) => (s ? Number(s.replace(/[^0-9.]/g, "")) || null : null);

// protobuf: field 1 varint, fields 2 and 3 fixed32 floats (little-endian)
export function wearFilter(lo: number, hi: number): string {
  const b = Buffer.alloc(12);
  b[0] = 0x08; b[1] = 2;
  b[2] = 0x15; b.writeFloatLE(lo, 3);
  b[7] = 0x1d; b.writeFloatLE(hi, 8);
  return b.toString("base64");
}

interface RawListing {
  unPrice: number;
  unFee: number;
  description?: { market_hash_name?: string };
  asset?: { asset_properties?: { propertyid: number; float_value?: number }[] };
}
interface SearchPage { total_count: number; more: boolean; listings: RawListing[] }

// null = the page rendered but its listings query carried no data (Steam's soft
// failure under load): treat as unfetched. A page without the query at all means
// the format changed, and that throws.
export function parseListingsPage(html: string): SearchPage | null {
  const marker = "window.SSR.renderContext=JSON.parse(";
  const at = html.indexOf(marker);
  if (at < 0) throw new Error("steam listings page: renderContext not found");
  // JSON.parse("...") wraps a JSON string literal; read exactly that literal.
  let end = at + marker.length + 1;
  while (end < html.length && html[end] !== '"') end += html[end] === "\\" ? 2 : 1;
  const ctx = JSON.parse(JSON.parse(html.slice(at + marker.length, end + 1)));
  const queries: { queryKey: unknown[]; state: { data: { pages?: SearchPage[] } | null } }[] = JSON.parse(ctx.queryData).queries;
  const q = queries.find((x) => x.queryKey[0] === "market_item_search");
  if (!q) throw new Error("steam listings page: market_item_search query missing");
  if (q.state.data == null) return null;
  const page = q.state.data.pages?.[0];
  if (!page || !Array.isArray(page.listings) || typeof page.total_count !== "number") {
    throw new Error("steam listings page: market_item_search page missing or reshaped");
  }
  return page;
}

export function steamMarket(opts: { gapMs?: number; log?: (s: string) => void } = {}) {
  const gapMs = opts.gapMs ?? 8000;
  const log = opts.log ?? console.log;
  const cache: Record<string, { at: number; v: unknown }> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const stats = { calls: 0, rateLimited: 0, throttled: false };

  // GET with spacing and 429 backoff. null = unreachable or throttled.
  function get(url: string, label: string): string | null {
    if (stats.throttled) return null;
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      if (stats.calls++ > 0) sleep(gapMs);
      let out: string;
      try {
        out = execFileSync("curl", ["-sS", "-L", "--max-time", "30", "-w", "\n%{http_code}", url], { encoding: "utf8", maxBuffer: 64 << 20 });
      } catch {
        return null;
      }
      const nl = out.lastIndexOf("\n");
      const status = Number(out.slice(nl + 1));
      if (status === 429) {
        stats.rateLimited++;
        if (attempt < BACKOFF_MS.length) {
          log(`  [steam 429 on "${label}", backing off ${BACKOFF_MS[attempt] / 1000}s]`);
          sleep(BACKOFF_MS[attempt]);
          continue;
        }
        stats.throttled = true;
        log(`  [steam still rate-limited, no further requests this run]`);
        return null;
      }
      return status === 200 ? out.slice(0, nl) : null;
    }
    return null;
  }

  function cached<T>(key: string, load: () => T | null): T | null {
    const hit = cache[key];
    if (hit && Date.now() - hit.at < TTL) return hit.v as T;
    const v = load();
    if (v != null) {
      cache[key] = { at: Date.now(), v };
      mkdirSync("node_modules/.cache", { recursive: true });
      writeFileSync(CACHE, JSON.stringify(cache)); // survive a killed run
    }
    return v;
  }

  function priceOverview(name: string): Overview | null {
    return cached(`overview|${name}`, () => {
      const body = get(`https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`, name);
      if (body == null) return null;
      const j: { success?: boolean; lowest_price?: string; median_price?: string; volume?: string } = JSON.parse(body);
      if (!j.success) return null;
      return { lowest: usd(j.lowest_price), median: usd(j.median_price), volume: j.volume ? Number(j.volume.replace(/[^0-9]/g, "")) || 0 : 0 };
    });
  }

  // The n cheapest non-StatTrak listings of `name` (a market_hash_name with its
  // wear) whose float lies in [lo, hi]. Fewer than n back means Steam doesn't
  // have n such listings; `total` says how many it has.
  function cheapestAtFloat(name: string, lo: number, hi: number, n: number): FloatBook | null {
    const wear = /\(([^)]+)\)$/.exec(name)?.[1];
    const w = WEAR_RANGES.findIndex((r) => r.wear === wear);
    if (w < 0) throw new Error(`cheapestAtFloat: no wear in "${name}"`);
    return cached(`floats|${name}|${lo.toFixed(4)}|${hi.toFixed(4)}|${n}`, () => {
      const listings: FloatListing[] = [];
      let total = 0;
      for (let start = 0; listings.length < n; start += PAGE) {
        const qs = new URLSearchParams({
          assetproperty: wearFilter(lo, hi),
          category_Quality: "normal",
          category_Exterior: `WearCategory${w}`,
          start: String(start),
        });
        const html = get(`https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}?${qs}`, `${name} ≤${hi.toFixed(3)}`);
        if (html == null) return null;
        const page = parseListingsPage(html);
        if (!page) return null;
        total = page.total_count;
        for (const l of page.listings) {
          const f = l.asset?.asset_properties?.find((p) => p.propertyid === 2)?.float_value;
          // the server applies the filter; re-check so a reshaped response can't leak other items in
          if (l.description?.market_hash_name !== name || f == null || f < lo - 1e-6 || f > hi + 1e-6) continue;
          listings.push({ float: f, price: (l.unPrice + l.unFee) / 100 });
        }
        if (!page.more || !page.listings.length) break;
      }
      listings.sort((a, b) => a.price - b.price);
      return { listings: listings.slice(0, n), total };
    });
  }

  return { priceOverview, cheapestAtFloat, stats };
}
