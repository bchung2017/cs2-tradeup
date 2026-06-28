/**
 * Float-price sync: for the top spam-candidate collections, pull CSFloat's
 * cheapest buy-now listing UNDER each float tier for the input-rarity skins (the
 * "steering" inputs). Writes public/data/floatprices.json, which the solver reads
 * to price steering slots correctly (instead of the flat bucket-median proxy).
 *
 * Bounded + rate-limited. Run: TOP=12 npx tsx scripts/sync-floatprices.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPrices, loadSkinById } from "../lib/data";
import { FLOAT_TIERS, findSpamTradeups, targetForWear } from "../lib/spam-search";
import { cheapestUnderFloat, hasCsfloatKey } from "../lib/csfloat";

async function main() {
  if (!hasCsfloatKey()) {
    console.error("no CSFLOAT_API_KEY (.env.local) — aborting");
    process.exit(1);
  }
  const TOP = Number(process.env.TOP ?? 12);
  const skinById = loadSkinById();
  const prices = loadPrices();
  const all = [...skinById.values()];

  // candidate (collection, rarity, tag) from the bucket-proxy finder
  const contracts = findSpamTradeups({ skinById, prices, targetAvgFloat: targetForWear("Field-Tested"), limit: 500 });
  const only = process.env.ONLY?.toLowerCase(); // restrict to collections matching this substring
  const seen = new Set<string>();
  const targets: { collId: string; collName: string; inputRarity: string; tag: string }[] = [];
  for (const c of contracts) {
    if (only && !c.collection.name.toLowerCase().includes(only)) continue;
    const tag = c.stattrak ? "st" : "norm";
    const key = `${c.collection.id}|${c.inputRarity}|${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ collId: c.collection.id, collName: c.collection.name, inputRarity: c.inputRarity, tag });
    if (!only && targets.length >= TOP) break;
  }

  const outPath = join(process.cwd(), "public", "data", "floatprices.json");
  const cache: Record<string, number> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
  let calls = 0;
  for (const t of targets) {
    const inputs = all.filter((s) => s.rarity.name === t.inputRarity && !s.souvenir && s.collections.some((c) => c.id === t.collId));
    console.error(`\n${t.collName} · ${t.inputRarity} · ${t.tag} (${inputs.length} inputs)`);
    for (const s of inputs) {
      const name = `${t.tag === "st" ? "StatTrak™ " : ""}${s.name} (Field-Tested)`;
      const row: string[] = [];
      for (const tier of FLOAT_TIERS) {
        const p = await cheapestUnderFloat(name, tier);
        calls++;
        if (p != null) cache[`${s.id}|${t.tag}|${tier}`] = p;
        row.push(p == null ? "—" : `$${p.toFixed(2)}`);
      }
      console.error(`  ${s.name}: ${FLOAT_TIERS.map((tier, i) => `${tier}:${row[i]}`).join("  ")}`);
    }
  }

  writeFileSync(outPath, JSON.stringify(cache));
  console.error(`\ndone: ${Object.keys(cache).length} float-price entries (total) from ${calls} calls`);
}
main();
