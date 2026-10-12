/**
 * Per-phase prices for Doppler and Gamma Doppler, for the Simulator's price
 * table. Steam and Skinport list a Doppler under one name, so the market-average
 * sync gives every phase the same price (a Ruby priced like a Phase 1). The
 * CSGOTrader Buff163 and CSFloat feeds carry the lowest ask per phase; each
 * phase's catalog entry gets the mean of those, with both in `sources`.
 *
 * Run by the market-average sync after its main pass, and on its own by
 * scripts/sync-phase-prices.ts. Not Steam: no Steam requests are made.
 */
import { WEAR_RANGES, type PriceTable, type Skin } from "../types/cs2";
import { FEEDS, type FeedTable } from "./third-party-feeds";

const round2 = (n: number) => Math.round(n * 100) / 100;

// "★ Skeleton Knife | Doppler" → "★ StatTrak™ Skeleton Knife | Doppler (Factory New)"
function feedName(skin: Skin, wear: string, stattrak: boolean): string {
  if (!stattrak) return `${skin.name} (${wear})`;
  return skin.name.startsWith("★ ")
    ? `★ StatTrak™ ${skin.name.slice(2)} (${wear})`
    : `StatTrak™ ${skin.name} (${wear})`;
}

export function applyPhasePrices(prices: PriceTable, skins: Skin[], tables: FeedTable[], stamp = Date.now()): { updated: number; missing: number } {
  let updated = 0;
  let missing = 0;
  for (const s of skins) {
    if (!s.phase) continue;
    for (const { wear } of WEAR_RANGES) {
      // only the grades this skin exists in
      const range = WEAR_RANGES.find((w) => w.wear === wear)!;
      if (range.min >= s.max_float || range.max <= s.min_float) continue;
      for (const st of s.stattrak ? [false, true] : [false]) {
        const name = feedName(s, wear, st);
        const sources: Record<string, number> = {};
        tables.forEach((t, i) => {
          const ask = t[name]?.starting_at?.doppler?.[s.phase!];
          if (typeof ask === "number" && ask > 0) sources[FEEDS[i]] = round2(ask);
        });
        const vals = Object.values(sources);
        if (!vals.length) { missing++; continue; }
        prices[`${s.id}|${wear}|${st ? "st" : "norm"}`] = {
          median: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
          lowest: round2(Math.min(...vals)),
          volume: 0,
          source: "phase-feed",
          sources,
          updatedAt: stamp,
        };
        updated++;
      }
    }
  }
  return { updated, missing };
}
