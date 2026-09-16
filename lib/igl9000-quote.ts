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
