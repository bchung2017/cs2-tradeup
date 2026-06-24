// Full schema has more fields; we keep the picker lean.

export type Rarity =
  | "Consumer Grade"
  | "Industrial Grade"
  | "Mil-Spec Grade"
  | "Restricted"
  | "Classified"
  | "Covert"
  | "Extraordinary"
  | "Contraband";

// Ladder order drives nextRarity(). "Extraordinary" is the Gold tier — the
// knives/gloves a 5× Covert contract rolls — and sits directly above Covert so
// nextRarity("Covert") resolves to it. Contraband stays at the top as a
// non-tradeable one-off (M4A4 | Howl); nextRarity() returns null for the top
// two tiers, so neither Extraordinary nor Contraband can be an input.
export const RARITY_ORDER: Rarity[] = [
  "Consumer Grade",
  "Industrial Grade",
  "Mil-Spec Grade",
  "Restricted",
  "Classified",
  "Covert",
  "Extraordinary",
  "Contraband",
];

export interface SkinRef {
  id: string;
  name: string;
}

export interface Collection {
  id: string;
  name: string;
  image?: string;
  crates?: SkinRef[];
  contains?: SkinRef[];
}

// Float range per ByMykel: min_float / max_float on the skin.
export interface Skin {
  id: string;
  name: string;
  description?: string;
  weapon: { id: string; name: string };
  rarity: { id: string; name: Rarity; color?: string };
  min_float: number;
  max_float: number;
  stattrak?: boolean;
  souvenir?: boolean;
  collections: Collection[];
  image?: string;
  // True for ★-marked inventory knives. Drives the auto ×5 knife contract size
  // (the catalog carries no knives, so this is only ever set from inventory).
  isKnife?: boolean;
}

// Wear tiers and their float ranges (Valve constants).
export type Wear =
  | "Factory New"
  | "Minimal Wear"
  | "Field-Tested"
  | "Well-Worn"
  | "Battle-Scarred";

export const WEAR_RANGES: { wear: Wear; min: number; max: number }[] = [
  { wear: "Factory New", min: 0.0, max: 0.07 },
  { wear: "Minimal Wear", min: 0.07, max: 0.15 },
  { wear: "Field-Tested", min: 0.15, max: 0.38 },
  { wear: "Well-Worn", min: 0.38, max: 0.45 },
  { wear: "Battle-Scarred", min: 0.45, max: 1.0 },
];

// One of 10 inputs to a trade-up. User picks a skin and a specific float.
export interface TradeupInput {
  skinId: string;
  float: number;
  // Market name of the staged item ("Weapon | Paint"), sent for inventory items
  // whose synthetic `inv-<assetid>` id isn't in the catalog. The server resolves
  // it to a real catalog skin by normalized name. Absent for catalog picks.
  marketName?: string;
}

// One possible output skin + its computed float + probability.
export interface TradeupOutcome {
  skin: Skin;
  probability: number; // 0..1
  outputFloat: number;
  outputWear: Wear;
  estimatedPrice: number | null;
  // Per-marketplace breakdown behind estimatedPrice (the price entry's `sources`),
  // so the price modal can show the same per-source numbers the inventory side does.
  priceSources?: Record<string, number> | null;
}

export interface TradeupResult {
  outcomes: TradeupOutcome[];
  inputCost: number;
  expectedValue: number;
  profitEV: number; // EV - inputCost
  inputRarity: Rarity;
  outputRarity: Rarity;
  isStatTrak: boolean;
  warnings: string[]; // e.g. mixed collections, mixed stattrak
}

// Price entry. Keyed by `${skinId}|${wear}|${stattrak ? "st" : "norm"}`.
// `source`/`sources`/`updatedAt` are present on real entries pulled by the
// admin price sync; absent on placeholder entries seeded by `npm run fetch-data`.
export interface PriceEntry {
  // The headline value used by trade-up EV math. For a market-average sync this
  // is the mean of the available per-source prices (see `sources`).
  median: number;
  lowest: number; // min across the contributing sources
  volume: number;
  source?: string; // "market-avg" | "steam-direct" | a single provider; undefined = mock
  // Per-source prices that fed the average, e.g. { steam: 43.36, skinport: 30.72,
  // buff163: 29.58 }. Present on market-average entries; lets the UI show the spread.
  sources?: Record<string, number>;
  updatedAt?: number; // epoch ms of the sync that wrote this entry
}
export type PriceTable = Record<string, PriceEntry>;
