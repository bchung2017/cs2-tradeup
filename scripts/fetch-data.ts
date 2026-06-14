/**
 * Pulls ByMykel CSGO-API skins, slims to the fields the picker needs,
 * filters out souvenir/knife/glove entries, and seeds a mock price table.
 *
 * Run: npm run fetch-data
 * Replace public/data/prices.json with STEAMPROXY output when ready.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PriceTable, Skin, Wear } from "../types/cs2";

const SRC = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json";
const OUT_DIR = join(process.cwd(), "public", "data");

const WEARS: Wear[] = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
];

interface RawSkin {
  id: string;
  name: string;
  weapon?: { id: string; name: string };
  rarity?: { id: string; name: string; color?: string };
  min_float?: number;
  max_float?: number;
  stattrak?: boolean;
  souvenir?: boolean;
  collections?: { id: string; name: string; image?: string }[];
  image?: string;
}

async function main() {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`ByMykel fetch failed: ${res.status}`);
  const raw = (await res.json()) as RawSkin[];

  const skins: Skin[] = raw
    .filter((s) => s.weapon && s.rarity && s.min_float != null && s.max_float != null)
    // ByMykel's `souvenir`/`stattrak` flags now mean "a souvenir/stattrak variant
    // exists", not "this entry IS one" — every collection skin (incl. AK-47 |
    // Redline) has souvenir:true, so filtering on it drops the whole catalog.
    // Knives/gloves carry no collection, so the collections filter alone excludes
    // them; we keep one base finish per skin and mark it non-souvenir below.
    .filter((s) => (s.collections?.length ?? 0) > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      weapon: s.weapon!,
      rarity: { id: s.rarity!.id, name: s.rarity!.name as Skin["rarity"]["name"], color: s.rarity!.color },
      min_float: s.min_float!,
      max_float: s.max_float!,
      stattrak: s.stattrak ?? true, // ByMykel sometimes omits; treat as available
      souvenir: false,
      collections: (s.collections ?? []).map((c) => ({ id: c.id, name: c.name, image: c.image })),
      image: s.image,
    }));

  writeFileSync(join(OUT_DIR, "skins.json"), JSON.stringify(skins, null, 2));
  console.log(`Wrote ${skins.length} skins.`);

  // Mock prices: deterministic pseudo-random by skin id + wear. Replace with real data.
  const prices: PriceTable = {};
  for (const s of skins) {
    const base = 0.3 + (hash(s.id) % 2000) / 100; // $0.30 .. ~$20.30
    WEARS.forEach((w, i) => {
      const median = round2(base * (1 + (WEARS.length - i) * 0.15));
      ["norm", "st"].forEach((tag) => {
        const m = tag === "st" ? round2(median * 1.6) : median;
        prices[`${s.id}|${w}|${tag}`] = { median: m, lowest: round2(m * 0.9), volume: 50 + (hash(s.id + w) % 900) };
      });
    });
  }
  writeFileSync(join(OUT_DIR, "prices.json"), JSON.stringify(prices));
  console.log(`Wrote ${Object.keys(prices).length} price entries.`);
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
