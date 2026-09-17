// IGL-9000 — the price seam.
//
// The engine's ONLY real-time input. A `PriceProvider` is a pure function from
// the engine's point of view: (skin, wear, stattrak) -> a two-sided Quote, or
// null when there's no liquid market. The engine never fetches prices itself; it
// calls this. Swap the implementation (mock table today, live venue average
// later) and the engine is byte-for-byte unchanged.
//
// See context/igl9000-engine-spec.md §1.

import type { PriceTable, Wear } from "@/types/cs2";

export interface Quote {
  ask: number; // BUY side — avg of asks across venues, liquidity-filtered. Feeds completion buys.
  bid_net: number; // SELL side — avg of (bid − venue seller fee). Feeds valuation baselines.
  // Completion listings behind `ask` (for the buy-N UI). Optional; absent on the mock.
  listings?: { venue: string; price: number; float: number; url: string }[];
}

export type PriceProvider = (skinId: string, wear: Wear, stattrak: boolean) => Quote | null;

// Mock provider over the existing on-disk price table (lib/data.ts:loadPrices),
// keyed `${skinId}|${wear}|${st|norm}`. The mock carries a single `median` per
// key, so ask === bid_net until real venue spreads land — at which point only
// this function changes, never the engine.
export function mockPriceProvider(prices: PriceTable): PriceProvider {
  return (skinId, wear, stattrak) => {
    const entry = prices[`${skinId}|${wear}|${stattrak ? "st" : "norm"}`];
    if (!entry || entry.median == null) return null;
    return { ask: entry.median, bid_net: entry.median };
  };
}

export interface MarketAvgOptions {
  /** Venue seller fee deducted to get bid_net from the venue average. Default 10%. */
  feeRate?: number;
  /** Drop Steam from the venue set. Default true — the model settles in 3rd-party
   *  cash venues only (modeltechnicalbreakdown.md invariant 1). */
  excludeSteam?: boolean;
  /** Refuse to quote when the venues disagree by more than this ratio
   *  (max/min). Default 3×. Scrape artifacts are real and large — a single bad
   *  buff163 row (e.g. CZ75-Auto | Victoria WW at $2218 against $86 on skinport)
   *  will otherwise inflate the average and manufacture a phantom +$800 contract.
   *  Refusing is the honest failure: the engine marks the slot unpriced rather
   *  than trading on a number no venue would actually honor. */
  maxVenueSpread?: number;
}

// The real provider: two-sided quotes from the market-average sync's per-source
// breakdown (scripts/admin/services/pricing.ts writes `sources`, e.g.
// { steam, skinport, buff163 }).
//
//   ask     = cheapest 3rd-party listing  — what a completion buy actually costs
//   bid_net = 3rd-party average − seller fee — what a sale actually nets
//
// Steam is excluded by default, satisfying the "no Steam prices in the math"
// invariant while still using the same synced file the UI reads. Entries without
// a `sources` breakdown (mock-seeded, or single-source) return null rather than a
// fabricated quote — the engine then treats that slot/outcome as unpriced and
// flags the contract approx, which is the honest degradation.
export function marketAvgPriceProvider(
  prices: PriceTable,
  opts: MarketAvgOptions = {},
): PriceProvider {
  const feeRate = opts.feeRate ?? 0.1;
  const excludeSteam = opts.excludeSteam ?? true;
  const maxVenueSpread = opts.maxVenueSpread ?? 3;
  return (skinId, wear, stattrak) => {
    const entry = prices[`${skinId}|${wear}|${stattrak ? "st" : "norm"}`];
    if (!entry?.sources) return null;
    const venues = Object.entries(entry.sources)
      .filter(([venue]) => !excludeSteam || venue !== "steam")
      .map(([, price]) => price)
      .filter((p) => typeof p === "number" && p > 0);
    if (!venues.length) return null;
    // Dispersion guard: venues that disagree this wildly mean a bad scrape, not
    // a spread to arbitrage. Quote nothing rather than something fictitious.
    if (Math.max(...venues) / Math.min(...venues) > maxVenueSpread) return null;
    const avg = venues.reduce((a, b) => a + b, 0) / venues.length;
    return { ask: Math.min(...venues), bid_net: avg * (1 - feeRate) };
  };
}
