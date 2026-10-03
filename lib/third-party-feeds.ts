/**
 * Third-party market prices from CSGOTrader's free bulk feeds, which carry what
 * Steam can't: prices above Steam's ~$1,800 listing cap, and Doppler prices per
 * phase. Each entry is keyed by market_hash_name:
 *   starting_at   { price, doppler?: { "Phase 1": …, "Ruby": … } }   lowest ask
 *   highest_order { price, doppler? }                                top buy order
 * Feeds are gzip bodies; cached for 6 h under node_modules/.cache.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export const FEEDS = ["buff163", "csfloat"] as const;
export type Feed = (typeof FEEDS)[number];

interface Side { price?: number; doppler?: Record<string, number> }
interface Entry { starting_at?: Side; highest_order?: Side }
export type FeedTable = Record<string, Entry | null>;

const TTL = 6 * 3600e3;

export function loadFeed(feed: Feed): FeedTable {
  const path = `node_modules/.cache/csgotrader-${feed}.json`;
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < TTL) return JSON.parse(readFileSync(path, "utf8"));
  const raw = execFileSync("curl", ["-sS", "--fail", "--max-time", "60", `https://prices.csgotrader.app/latest/${feed}.json`], {
    maxBuffer: 256 << 20,
  });
  const body = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  const table: FeedTable = JSON.parse(body.toString("utf8"));
  mkdirSync("node_modules/.cache", { recursive: true });
  writeFileSync(path, JSON.stringify(table));
  return table;
}

export const DOPPLER_PHASES = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Ruby", "Sapphire", "Black Pearl"];
export const GAMMA_PHASES = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Emerald"];
export const phasesOf = (name: string) =>
  name.includes("| Gamma Doppler") ? GAMMA_PHASES : name.includes("| Doppler") ? DOPPLER_PHASES : null;

export interface Quote { ask: number | null; bid: number | null } // USD, before the seller's fee

// Lowest ask and highest buy order across the feeds, for one market_hash_name
// and (for Dopplers) one phase.
export function quoteOf(tables: FeedTable[], name: string, phase?: string): Quote {
  let ask: number | null = null;
  let bid: number | null = null;
  for (const t of tables) {
    const e = t[name];
    if (!e) continue;
    const a = phase ? e.starting_at?.doppler?.[phase] : e.starting_at?.price;
    const b = phase ? e.highest_order?.doppler?.[phase] : e.highest_order?.price;
    if (typeof a === "number" && a > 0) ask = ask == null ? a : Math.min(ask, a);
    if (typeof b === "number" && b > 0) bid = bid == null ? b : Math.max(bid, b);
  }
  return { ask, bid };
}
