/**
 * Acceptance test for the spam-trade-up solver: does it independently reproduce
 * elsu's Dead Hand recipe from raw market data (≈7 Well-Worn + ≈3 Field-Tested,
 * AK-47 Crane Flight jackpot, ~$10, ~1-in-3)? Plus top grind / jackpot picks.
 *
 * Run: npx tsx scripts/spam-check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPrices, loadSkinById } from "../lib/data";
import { findSpamTradeups, targetForWear } from "../lib/spam-search";

const skinById = loadSkinById();
const prices = loadPrices();
const fpPath = join(process.cwd(), "public", "data", "floatprices.json");
const floatPrices = existsSync(fpPath) ? (JSON.parse(readFileSync(fpPath, "utf8")) as Record<string, number>) : undefined;
console.log(floatPrices ? `[float prices: ${Object.keys(floatPrices).length} entries]` : "[float prices: none — bucket proxy]");

const contracts = findSpamTradeups({ skinById, prices, targetAvgFloat: targetForWear("Field-Tested"), limit: 500, floatPrices });

const fmt = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
function show(c: (typeof contracts)[number]) {
  const r = c.recipe;
  console.log(`\n${c.collection.name} · ${c.inputRarity}→${c.outputRarity}${c.stattrak ? " ST" : ""}`);
  console.log(`  recipe: ${r.fillerCount}× ${r.fillerWear} (${r.fillerSkin.name} ${fmt(r.fillerSkin.price)}) ` +
    `+ ${r.steerCount}× ${r.steerWear}<=${r.steerFloatCeiling.toFixed(3)} (${r.steerSkin.name} ${fmt(r.steerSkin.price)})`);
  console.log(`  per-run cost ${fmt(c.perRunCost)} · P(profit) ${(c.pProfit * 100).toFixed(0)}% · netEV ${fmt(c.netEV)}`);
  console.log(`  jackpot: ${c.jackpot?.name ?? "—"} ${fmt(c.jackpot?.netPrice)} @ ${((c.jackpot?.probability ?? 0) * 100).toFixed(0)}% ` +
    `· median runs-to-hit ${c.runsToHitMedian.toFixed(1)} · stake90 ${fmt(c.stake90)}`);
  console.log(`  outcomes: ${c.outcomes.map((o) => `${o.name}(${o.wear}) ${fmt(o.netPrice)} @${(o.probability * 100).toFixed(0)}%`).join(" | ")}`);
}

console.log(`\n=== ACCEPTANCE: Dead Hand ===`);
const dh = contracts.filter((c) => /dead hand/i.test(c.collection.name));
if (dh.length === 0) console.log("  !! no Dead Hand spam contract produced");
else dh.forEach(show);

console.log(`\n\n=== TOP 5 GRIND (highest P(profit), netEV ≥ 0) ===`);
[...contracts].filter((c) => c.netEV >= 0).sort((a, b) => b.pProfit - a.pProfit).slice(0, 5).forEach(show);

console.log(`\n\n=== TOP 5 JACKPOT (biggest jackpot × hit-rate) ===`);
[...contracts]
  .filter((c) => c.jackpot)
  .sort((a, b) => (b.jackpot!.netPrice * b.jackpot!.probability) - (a.jackpot!.netPrice * a.jackpot!.probability))
  .slice(0, 5)
  .forEach(show);

console.log(`\n\ntotal spam contracts found: ${contracts.length}`);
