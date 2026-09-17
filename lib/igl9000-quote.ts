// IGL-9000 — the price seam.
//
// The engine's ONLY real-time input. A `PriceProvider` is a pure function from
// the engine's point of view: (skin, wear, stattrak, float) -> a two-sided
// Quote, or null when there's no liquid market. The engine never fetches prices
// itself; it calls this. Swap the implementation (mock table, market average,
// Steam) and the engine is byte-for-byte unchanged.
//
// `float` is passed because real markets price BY float inside a wear bracket,
// not just by the bracket — a low-float Field-Tested sells above a high-float
// one. Providers that don't model that may ignore the argument.
//
// See context/igl9000-engine-spec.md §1.

import type { PriceTable, Wear } from "@/types/cs2";
import { WEAR_RANGES } from "@/types/cs2";

export interface Quote {
  ask: number; // BUY side — cheapest listing. Feeds completion buys.
  bid_net: number; // SELL side — what a sale actually nets after venue fees.
  // Completion listings behind `ask` (for the buy-N UI). Optional; absent on the mock.
  listings?: { venue: string; price: number; float: number; url: string }[];
}

export type PriceProvider = (
  skinId: string,
  wear: Wear,
  stattrak: boolean,
  float?: number,
) => Quote | null;

// ── float-within-bracket pricing ─────────────────────────────────────────────
// A synced price is the price of a *typical* item in its wear bracket. Real
// listings inside that bracket are not uniform: the low-float edge trades at a
// premium and the high-float edge at a discount. Modeled as a linear skew
// centered on the bracket midpoint, so the quoted price is reproduced exactly at
// the middle and the model never invents value on average:
//
//   t = (float − min) / (max − min)            position in the bracket, 0..1
//   multiplier = 1 + floatSkew · (0.5 − t)     +½·skew at the low edge, −½·skew at the high
//
// This is a heuristic standing in for real per-float listing data (CSFloat
// listings would replace it with actual float-priced asks). It matters because
// it makes float steering *cost* something: buying low-float to push an output
// into a better wear bracket is no longer free, which is how the real market works.
export function floatMultiplier(wear: Wear, float: number | undefined, floatSkew: number): number {
  if (float == null || floatSkew === 0) return 1;
  const range = WEAR_RANGES.find((r) => r.wear === wear);
  if (!range || range.max <= range.min) return 1;
  const t = Math.min(1, Math.max(0, (float - range.min) / (range.max - range.min)));
  return 1 + floatSkew * (0.5 - t);
}

// Mock provider over the existing on-disk price table (lib/data.ts:loadPrices),
// keyed `${skinId}|${wear}|${st|norm}`. The mock carries a single `median` per
// key, so ask === bid_net and float is ignored — it exists for deterministic
// fixture tests, not for settlement.
export function mockPriceProvider(prices: PriceTable): PriceProvider {
  return (skinId, wear, stattrak) => {
    const entry = prices[`${skinId}|${wear}|${stattrak ? "st" : "norm"}`];
    if (!entry || entry.median == null) return null;
    return { ask: entry.median, bid_net: entry.median };
  };
}

export interface MarketAvgOptions {
  /** Venue seller fee deducted to get bid_net from the venue average. Default 18%
   *  — the realistic all-in cost of turning a skin into cash on 3rd-party venues
   *  (listing commission plus withdrawal/payout friction), not a single venue's
   *  headline rate. */
  feeRate?: number;
  /** Drop Steam from the venue set. Default true — this provider settles in
   *  3rd-party CASH venues only. Steam is quoted separately by
   *  steamPriceProvider(), with Steam's own fee math, and the two are never
   *  blended (modeltechnicalbreakdown.md invariant 2). */
  excludeSteam?: boolean;
  /** Refuse to quote when the venues disagree by more than this ratio
   *  (max/min). Default 3×. Scrape artifacts are real and large — a single bad
   *  buff163 row (e.g. CZ75-Auto | Victoria WW at $2218 against $86 on skinport)
   *  will otherwise inflate the average and manufacture a phantom +$800 contract.
   *  Refusing is the honest failure: the engine marks the slot unpriced rather
   *  than trading on a number no venue would actually honor. */
  maxVenueSpread?: number;
  /** Price swing across a wear bracket, low-float edge to high-float edge.
   *  Default 0.20 (+10% at the low edge, −10% at the high). See floatMultiplier. */
  floatSkew?: number;
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
  const feeRate = opts.feeRate ?? 0.18;
  const excludeSteam = opts.excludeSteam ?? true;
  const maxVenueSpread = opts.maxVenueSpread ?? 3;
  const floatSkew = opts.floatSkew ?? 0.2;
  return (skinId, wear, stattrak, float) => {
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
    const mult = floatMultiplier(wear, float, floatSkew);
    const avg = venues.reduce((a, b) => a + b, 0) / venues.length;
    return { ask: Math.min(...venues) * mult, bid_net: avg * (1 - feeRate) * mult };
  };
}

export interface SteamOptions {
  /** Steam's marketplace cut, expressed as the fraction ADDED on top of the
   *  seller's proceeds (15% = 10% Valve + 5% CS2). A listing at $115 nets the
   *  seller ~$100, so bid_net = price / (1 + steamFeeRate). Default 0.15. */
  steamFeeRate?: number;
  /** See MarketAvgOptions.floatSkew. Default 0.20. */
  floatSkew?: number;
}

// Steam quoted on its OWN terms, as a separate channel — never averaged into the
// 3rd-party cash quote above.
//
// Two reasons it has to stay separate rather than being "one more venue":
//   • Different fee math. Steam's 15% is added on top of the seller's proceeds,
//     so the seller nets price / 1.15 (≈13.0% off the sticker), not price × 0.85.
//   • Different money. Steam proceeds land as a WALLET BALANCE, not cash — they
//     can buy more skins and nothing else. A route that "profits" in Steam funds
//     has not made you any money in the sense the rest of the model means, which
//     is why settlement excludes it by default.
//
// Run the engine with this provider to get the Steam-settled view of the same
// route, and compare it against the cash-settled one. Do not blend them.
//
// Two caveats that make Steam numbers less trustworthy than the cash ones, not
// more — both seen in this repo's own synced data:
//   • Steam caps market prices around $1800. AK-47 | Wild Lotus (FT) quotes
//     steam $1848 against skinport $9136 / buff163 $7098 — so every item above
//     the cap is quoted at a fraction of its real value, and a contract whose
//     OUTPUT is capped while its INPUTS are not will show a huge phantom delta.
//   • No dispersion guard is possible here. The cash provider cross-checks
//     venues against each other; a single source has nothing to check against,
//     so a bad Steam row passes straight through.
// Treat a Steam-settled result as a comparison figure, never as a trade signal.
export function steamPriceProvider(prices: PriceTable, opts: SteamOptions = {}): PriceProvider {
  const steamFeeRate = opts.steamFeeRate ?? 0.15;
  const floatSkew = opts.floatSkew ?? 0.2;
  return (skinId, wear, stattrak, float) => {
    const entry = prices[`${skinId}|${wear}|${stattrak ? "st" : "norm"}`];
    if (!entry) return null;
    // Prefer the explicit per-source Steam price; fall back to a steam-sourced median.
    const steam =
      entry.sources?.steam ?? (entry.source === "steam" || entry.source === "steam-direct" ? entry.median : null);
    if (steam == null || !(steam > 0)) return null;
    const mult = floatMultiplier(wear, float, floatSkew);
    return { ask: steam * mult, bid_net: (steam / (1 + steamFeeRate)) * mult };
  };
}
