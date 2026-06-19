/**
 * Pulls ByMykel CSGO-API skins, slims to the fields the picker needs, and seeds
 * a mock price table.
 *
 * Weapon skins come straight from skins.json. Knives/gloves (the "Gold" tier a
 * 5× Covert contract rolls) carry NO collection in skins.json, so on their own
 * the trade-up engine can't match them to a contract. We rebuild that link from
 * crates.json: every weapon Case lists its normal skins in `contains[]` and its
 * knives/gloves in `contains_rare[]`. The case's normal skins all share one
 * named collection (verified: 42/42 cases map 1:1), so we tag each case's
 * knives/gloves with that same collection and normalize them to the
 * "Extraordinary" Gold tier — which is exactly what a Covert contract's output
 * lookup (`rarity === outputRarity && same collection`) needs.
 *
 * Run: npm run fetch-data
 * Replace public/data/prices.json with STEAMPROXY output when ready.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PriceTable, Skin, Wear } from "../types/cs2";

const SRC = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json";
const CRATES_SRC = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json";
const OUT_DIR = join(process.cwd(), "public", "data");

// The normalized Gold tier for knives/gloves. ByMykel tags knives "Covert" and
// gloves "Extraordinary"; we collapse both to this so they (a) sit one tier
// above Covert in the ladder and (b) never pollute Classified→Covert outputs.
const GOLD_TIER = "Extraordinary";

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

interface RawCrate {
  id: string;
  name: string;
  type?: string;
  contains?: { id: string }[];
  contains_rare?: { id: string }[];
}

type Coll = { id: string; name: string; image?: string };

async function main() {
  const [res, crateRes] = await Promise.all([fetch(SRC), fetch(CRATES_SRC)]);
  if (!res.ok) throw new Error(`ByMykel skins fetch failed: ${res.status}`);
  if (!crateRes.ok) throw new Error(`ByMykel crates fetch failed: ${crateRes.status}`);
  const raw = (await res.json()) as RawSkin[];
  const crates = (await crateRes.json()) as RawCrate[];
  const rawById = new Map(raw.map((s) => [s.id, s]));

  // Walk every weapon Case and map each of its knives/gloves (`contains_rare`)
  // to the named collection its normal skins (`contains`) belong to. A knife in
  // several cases accumulates several collections — correct, it can drop from
  // each of those contracts.
  const goldCollections = new Map<string, Map<string, Coll>>(); // rare skin id -> collId -> Coll
  for (const c of crates) {
    if (c.type !== "Case") continue;
    const colls = new Map<string, Coll>();
    for (const it of c.contains ?? []) {
      for (const col of rawById.get(it.id)?.collections ?? []) {
        colls.set(col.id, { id: col.id, name: col.name, image: col.image });
      }
    }
    if (!colls.size) continue;
    for (const it of c.contains_rare ?? []) {
      let m = goldCollections.get(it.id);
      if (!m) goldCollections.set(it.id, (m = new Map()));
      for (const [cid, col] of colls) m.set(cid, col);
    }
  }

  // Weapon skins: every catalog entry that already carries a collection.
  // ByMykel's `souvenir`/`stattrak` flags now mean "a souvenir/stattrak variant
  // exists", not "this entry IS one" — every collection skin (incl. AK-47 |
  // Redline) has souvenir:true, so filtering on it drops the whole catalog.
  const weaponSkins: Skin[] = raw
    .filter((s) => s.weapon && s.rarity && s.min_float != null && s.max_float != null)
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

  // Gold tier: knives/gloves re-linked to their case collections above. Rarity
  // normalized to Extraordinary so they only ever surface as Covert-contract
  // outputs (never as Classified→Covert outputs). Skips the ~20 floatless
  // vanilla knives, which have no wear range to roll an output float onto.
  const goldSkins: Skin[] = raw
    .filter((s) => goldCollections.has(s.id) && s.weapon && s.min_float != null && s.max_float != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      weapon: s.weapon!,
      rarity: { id: s.rarity?.id ?? "rarity_ancient", name: GOLD_TIER as Skin["rarity"]["name"], color: s.rarity?.color },
      min_float: s.min_float!,
      max_float: s.max_float!,
      stattrak: s.stattrak ?? true,
      souvenir: false,
      collections: [...goldCollections.get(s.id)!.values()],
      image: s.image,
    }));

  const skins: Skin[] = [...weaponSkins, ...goldSkins];

  writeFileSync(join(OUT_DIR, "skins.json"), JSON.stringify(skins, null, 2));
  console.log(`Wrote ${skins.length} skins (${weaponSkins.length} weapons, ${goldSkins.length} knives/gloves).`);

  // Mock prices: deterministic pseudo-random by skin id + wear. We PRESERVE any
  // real prices already in prices.json (the admin market-average / Steam sync
  // writes there) and only seed keys that don't exist yet — so regenerating the
  // catalog to add knives never clobbers synced price data.
  let prices: PriceTable = {};
  try {
    prices = JSON.parse(readFileSync(join(OUT_DIR, "prices.json"), "utf8")) as PriceTable;
  } catch {
    // no existing table — start fresh
  }
  let seeded = 0;
  for (const s of skins) {
    const base = 0.3 + (hash(s.id) % 2000) / 100; // $0.30 .. ~$20.30
    WEARS.forEach((w, i) => {
      const median = round2(base * (1 + (WEARS.length - i) * 0.15));
      (["norm", "st"] as const).forEach((tag) => {
        const key = `${s.id}|${w}|${tag}`;
        if (prices[key]) return; // keep the existing (possibly real) price
        const m = tag === "st" ? round2(median * 1.6) : median;
        prices[key] = { median: m, lowest: round2(m * 0.9), volume: 50 + (hash(s.id + w) % 900) };
        seeded++;
      });
    });
  }
  writeFileSync(join(OUT_DIR, "prices.json"), JSON.stringify(prices));
  console.log(`Wrote ${Object.keys(prices).length} price entries (${seeded} newly seeded, rest preserved).`);
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
