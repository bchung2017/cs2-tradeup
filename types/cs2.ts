// Full schema has more fields; we keep the picker lean.

export type Rarity =
  | "Consumer Grade"
  | "Industrial Grade"
  | "Mil-Spec Grade"
  | "Restricted"
  | "Classified"
  | "Covert"
  | "Contraband";

export const RARITY_ORDER: Rarity[] = [
  "Consumer Grade",
  "Industrial Grade",
  "Mil-Spec Grade",
  "Restricted",
  "Classified",
  "Covert",
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
}

// One possible output skin + its computed float + probability.
export interface TradeupOutcome {
  skin: Skin;
  probability: number; // 0..1
  outputFloat: number;
  outputWear: Wear;
  estimatedPrice: number | null;
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

// Mock price entry. Keyed by `${skinId}|${wear}|${stattrak ? "st" : "norm"}`.
export interface PriceEntry {
  median: number;
  lowest: number;
  volume: number;
}
export type PriceTable = Record<string, PriceEntry>;
