// Shared contract between the Research Lab UI (components/ResearchView.tsx) and
// the backend opportunity scanner (lib/tradeup-search.ts + app/api/research).
// v1: single-collection contracts ranked by P(net profit). The backend produces
// this shape; the UI renders it. Keep them in lockstep — this file is the seam.
import type { Rarity, Skin, Wear } from "@/types/cs2";

// One possible output of a contract: an output-rarity skin at the contract's
// computed wear, with its draw probability and net (after-fee) price.
export interface ResearchOutcome {
  skin: Skin;
  wear: Wear;
  probability: number; // 0..1
  netPrice: number | null; // estimatedPrice * (1 - feeRate); null = unpriced
  priceSources?: Record<string, number> | null;
}

// One of the items consumed by a contract — a concrete inventory item resolved
// to its catalog skin, carrying enough to (a) display it and (b) stage it into
// the simulator. `skin.id` MUST be a real catalog id so /api/tradeup resolves it.
export interface ResearchInput {
  assetid: string;
  skin: Skin;
  name: string; // raw market name "Weapon | Paint (Wear)" for display + PriceModal
  float: number;
  wear: Wear;
  stattrak: boolean;
  price: number | null; // gross market median of this input
  priceSources?: Record<string, number> | null;
}

export interface ResearchConfidence {
  pricedInputs: number; // how many of the N inputs had price data
  inputCount: number; // N (10 standard, 5 knife)
  pricedProb: number; // 0..1 share of outcome probability that had price data
}

// "The One" — the rare outcome that breaks the odds: a low-probability hit that
// pays a large multiple of the contract's cost. Contracts that have one usually
// score LOW on P(profit) (you lose most rolls), so the default ranking hides
// them — RED PILL mode surfaces them. (Themed naming only; this is rare-but-huge
// "moonshot"/lottery-ticket detection.)
export interface ResearchTheOne {
  name: string; // the output skin (market name) that lands the big hit
  wear: Wear;
  probability: number; // 0..1 — how rarely it lands
  netPrice: number; // net payout when it does
  multiple: number; // netPrice / inputCost — the size of the dream
}

// A single ranked opportunity.
export interface ResearchContract {
  id: string; // stable key (collection + strategy + stattrak)
  kind: "single" | "mixed"; // single-collection, or a cross-collection blend
  inputRarity: Rarity;
  outputRarity: Rarity;
  collection: { id: string; name: string }; // for kind:"mixed", a synthetic "Mixed · N collections"
  stattrak: boolean;
  strategy: "cheapest" | "lowest-float"; // which item-selection heuristic won
  inputCost: number; // net sell value of the consumed inputs
  netEV: number; // expected net payout − inputCost
  pProfit: number; // 0..1 — HEADLINE: P(a single roll clears cost after fees)
  best: { name: string; wear: Wear; netPrice: number } | null;
  worst: { name: string; wear: Wear; netPrice: number } | null;
  theOne: ResearchTheOne | null; // RED PILL: rare high-multiple hit, else null
  confidence: ResearchConfidence;
  inputs: ResearchInput[];
  outcomes: ResearchOutcome[]; // sorted by probability desc
}

// One item you already own toward a near-miss — enough to show you what you have.
export interface ResearchNearMissItem {
  assetid: string;
  name: string; // market name "Weapon | Paint (Wear)"
  image?: string | null; // catalog skin image
  float: number;
  wear: Wear;
  price: number | null; // gross market median
  priceSources?: Record<string, number> | null;
}

// A possible OUTCOME of the completed contract — an output skin you could roll.
// Used to compare wins to each other (small winner → big winner), with a picture.
export interface ResearchNearMissOutput {
  name: string;
  image?: string | null;
  netPrice: number | null; // best net value of this skin
}

// An input skin you could BUY to fill a remaining slot (with a picture + price).
export interface ResearchBuyOption {
  name: string;
  image?: string | null;
  price: number | null; // cheapest gross price across wears
  wear: Wear; // the wear at that cheapest price
  float: number; // representative float (midpoint of that wear) — seeds the trade-up
}

// Cost to acquire the `need` remaining skins to complete a candidate's contract.
// Derived from the price range of the input-rarity skins in that collection: the
// floor buys the cheapest eligible filler ×need, the ceiling the priciest ×need.
// Gross market prices (what you'd PAY — no sell fee deducted). null when the
// collection's input skins have no price data.
// One point on the buy-in→payout curve: at a given wear tier, what you'd pay to
// fill the remaining slots (gross, ×need) and what the top output then pays (net).
// Lower-float (pricier) fillers → better-wear roll → bigger payout.
export interface ResearchBuyInPoint {
  wear: Wear;
  buyIn: number; // cheapest filler @this wear × need (gross — what you'd pay)
  payout: number; // top output priced @this wear (net — after fee)
  fillerName: string; // the cheapest filler skin @this wear (market name)
  outputName: string; // the top-payout output skin @this wear (market name)
}

export interface ResearchBuyIn {
  perItemFloor: number | null; // cheapest input skin@wear in the collection
  perItemCeiling: number | null; // priciest
  floor: number | null; // perItemFloor × need — basement to complete
  ceiling: number | null; // perItemCeiling × need — ceiling to complete
  floorItem: string | null; // the cheapest filler skin (basement buy-in item)
  ceilingItem: string | null; // the priciest filler skin (ceiling buy-in item)
  // The top-output payout the completed roll can land, as a band: cheap high-float
  // fillers skew the roll toward worse wear (payoutFloor), pricey low-float fillers
  // toward best wear (payoutCeiling) — so a higher buy-in can unlock a much bigger
  // hit. Net (after-fee) values.
  payoutFloor: number | null;
  payoutCeiling: number | null;
  topName: string | null; // the top-payout output skin
  curve: ResearchBuyInPoint[]; // buy-in→payout across wear tiers, ascending buy-in
}

// A collection you're CLOSE to being able to trade up in, but don't yet own the
// full 10 of. Not a scored contract (the inputs aren't all there) — a guide for
// what to collect: the items you DO have, the buy-in to finish, and the reward.
export interface ResearchNearMiss {
  id: string;
  collection: { id: string; name: string };
  inputRarity: Rarity;
  outputRarity: Rarity;
  stattrak: boolean;
  have: number; // items you own in this collection + rarity
  need: number; // CONTRACT_SIZE − have
  buyIn: ResearchBuyIn; // cost range to acquire the `need` remaining skins
  items: ResearchNearMissItem[]; // the items you already own toward it (the "have")
  toBuy: ResearchBuyOption[]; // input skins you could buy to finish, cheapest first
  // the OUTCOMES you'd roll for — output skins compared by value (small→big winner),
  // best net value first, each with a picture.
  outputs: ResearchNearMissOutput[];
}

export interface ResearchResponse {
  steamid: string;
  eligibleItems: number; // count of inventory items that could seed a contract
  feeRate: number; // the fee applied to net prices (e.g. 0.15)
  contracts: ResearchContract[]; // ranked, best first (single + mixed)
  nearMisses: ResearchNearMiss[]; // closest candidates, closest first
}
