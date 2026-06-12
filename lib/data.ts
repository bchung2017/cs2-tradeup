import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PriceTable, Skin } from "@/types/cs2";

const DATA_DIR = join(process.cwd(), "public", "data");

let skinCache: Skin[] | null = null;
let skinByIdCache: Map<string, Skin> | null = null;
let priceCache: PriceTable | null = null;

export function loadSkins(): Skin[] {
  if (skinCache) return skinCache;
  const raw = readFileSync(join(DATA_DIR, "skins.json"), "utf8");
  skinCache = JSON.parse(raw) as Skin[];
  return skinCache;
}

export function loadSkinById(): Map<string, Skin> {
  if (skinByIdCache) return skinByIdCache;
  skinByIdCache = new Map(loadSkins().map((s) => [s.id, s]));
  return skinByIdCache;
}

export function loadPrices(): PriceTable {
  // Swap this body for a DB/Redis fetch when STEAMPROXY is wired in.
  if (priceCache) return priceCache;
  const raw = readFileSync(join(DATA_DIR, "prices.json"), "utf8");
  priceCache = JSON.parse(raw) as PriceTable;
  return priceCache;
}
