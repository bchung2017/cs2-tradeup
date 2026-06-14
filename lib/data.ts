import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PriceTable, Skin } from "@/types/cs2";

const DATA_DIR = join(process.cwd(), "public", "data");

let skinCache: Skin[] | null = null;
let skinByIdCache: Map<string, Skin> | null = null;
let skinByNameCache: Map<string, Skin> | null = null;
let priceCache: PriceTable | null = null;

/**
 * Canonical key for matching a market name to a catalog skin: strips the ★,
 * StatTrak™ / Souvenir prefixes and the trailing "(Wear)", then lowercases and
 * collapses whitespace. Catalog names ("AK-47 | Redline") and inventory market
 * names ("StatTrak™ AK-47 | Redline (Field-Tested)") collapse to the same key.
 */
export function normalizeSkinName(name: string): string {
  return name
    .replace(/^★\s*/, "")
    .replace(/^StatTrak™?\s*/i, "")
    .replace(/^Souvenir\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

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

export function loadSkinByName(): Map<string, Skin> {
  if (skinByNameCache) return skinByNameCache;
  const map = new Map<string, Skin>();
  // First write wins so a stable skin keeps the key if names ever collide.
  for (const s of loadSkins()) {
    const key = normalizeSkinName(s.name);
    if (!map.has(key)) map.set(key, s);
  }
  skinByNameCache = map;
  return skinByNameCache;
}

export function loadPrices(): PriceTable {
  // Swap this body for a DB/Redis fetch when STEAMPROXY is wired in.
  if (priceCache) return priceCache;
  const raw = readFileSync(join(DATA_DIR, "prices.json"), "utf8");
  priceCache = JSON.parse(raw) as PriceTable;
  return priceCache;
}
