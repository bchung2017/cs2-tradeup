/**
 * IGL-9000 — knife contract longlist, indexed by the red you already own.
 *
 *   npx tsx scripts/igl9000-knife-longlist.ts [--per 5] [--fee 0.025] [--out knife-longlist]
 *
 * For every Covert that can go into a knife contract, in every wear it exists in,
 * and for owning 1 or 2 of it: the best few ways to complete the contract. Each
 * completion fills the other slots with the cheapest Covert of one collection,
 * the owned item's own (one knife pool) or any other (two pools mixed: each
 * collection's items share its slot count / 5 of the odds).
 *
 * Deliberately rough, it's a menu, not a buy list:
 *   - the owned item is valued at what selling it nets (its opportunity cost)
 *   - fillers at the third-party lowest ask, float-blind, from their cheapest grade
 *   - every float at the middle of its wear grade (owned floats aren't known)
 *   - knives at the top buy order (Doppler phases split evenly, see lib/igl9000-knife.ts)
 *   - non-StatTrak only
 * Writes <out>.csv and <out>.json.
 */
import { writeFileSync } from "node:fs";
import { WEAR_RANGES, type Skin, type Wear } from "@/types/cs2";
import { loadSkins } from "@/lib/data";
import { floatToWear } from "@/lib/tradeup";
import { FEEDS, loadFeed, quoteOf } from "@/lib/third-party-feeds";
import { buildPools, knifeValuer, type Pool } from "@/lib/igl9000-knife";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PER = Number(arg("per") ?? 5); // completions kept per owned item, wear and count
const FEE = Number(arg("fee") ?? 0.025);
const OUT = arg("out") ?? "knife-longlist";
const N = 5;

const skins: Skin[] = loadSkins();
const tables = FEEDS.map(loadFeed);
const { sale, valueOf } = knifeValuer(tables, FEE);
const pools = [...buildPools(skins).values()];
const poolOf = new Map<string, Pool>();
for (const p of pools) for (const s of p.inputs) poolOf.set(s.id, p);

// wear grades a skin exists in, with the middle float of each
function grades(s: Skin): { wear: Wear; mid: number }[] {
  return WEAR_RANGES.flatMap((g) => {
    const lo = Math.max(g.min, s.min_float), hi = Math.min(g.max, s.max_float);
    return hi > lo ? [{ wear: g.wear, mid: (lo + hi) / 2 }] : [];
  });
}
const norm = (s: Skin, f: number) => (f - s.min_float) / (s.max_float - s.min_float);

// The cheapest Covert of each pool to fill slots with, at its cheapest grade.
const fillerOf = new Map<string, { skin: Skin; wear: Wear; mid: number; ask: number }>();
for (const p of pools) {
  for (const s of p.inputs) {
    for (const g of grades(s)) {
      const ask = quoteOf(tables, `${s.name} (${g.wear})`).ask;
      const cur = fillerOf.get(p.id);
      if (ask != null && (!cur || ask < cur.ask)) fillerOf.set(p.id, { skin: s, wear: g.wear, mid: g.mid, ask });
    }
  }
}

interface Row {
  owned: string; ownedWear: string; ownedCount: number; ownedValue: number;
  filler: string; fillerWear: string; fillerCount: number; fillerAsk: number;
  pools: string; knifeItems: number; adjustedFloat: number;
  cost: number; evFast: number; evPatient: number; rtp: number; pProfit: number; p1k: number;
  best: string; bestValue: number;
}
const rows: Row[] = [];
const short = (n: string) => n.replace(/^The /, "").replace(/ Collection$/, "");
const ABBR: Record<string, string> = { "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS" };

let ownedItems = 0;
for (const A of pools) {
  for (const s of A.inputs) {
    for (const g of grades(s)) {
      const v = sale(`${s.name} (${g.wear})`).fast;
      if (v == null) continue; // no market for this one: can't say what owning it costs
      ownedItems++;
      for (const own of [1, 2]) {
        const options: Row[] = [];
        for (const B of pools) {
          const f = fillerOf.get(B.id);
          if (!f) continue;
          const nf = N - own;
          const T = (own * norm(s, g.mid) + nf * norm(f.skin, f.mid)) / N;
          // each pool's items share (its slots / 5) of the odds
          const share = new Map<Pool, number>([[A, own / N]]);
          share.set(B, (share.get(B) ?? 0) + nf / N);
          let ev = 0, evP = 0, priced = 0;
          const outs: { name: string; p: number; v: number }[] = [];
          for (const [P, sh] of share) {
            for (const k of P.knives) {
              const kf = k.min_float + T * (k.max_float - k.min_float);
              const w = floatToWear(kf);
              const kv = valueOf(k, w);
              const p = sh / P.knives.length;
              if (kv.fast == null) continue;
              priced += p;
              ev += p * kv.fast;
              evP += p * (kv.patient ?? kv.fast);
              outs.push({ name: `${k.name} (${ABBR[w]})`, p, v: kv.fast });
            }
          }
          if (priced < 0.95) continue; // too much of the pool unpriced to say anything
          const cost = own * v + nf * f.ask;
          const best = outs.reduce((a, o) => (o.v > a.v ? o : a));
          options.push({
            owned: s.name, ownedWear: ABBR[g.wear], ownedCount: own, ownedValue: v,
            filler: f.skin.name, fillerWear: ABBR[f.wear], fillerCount: nf, fillerAsk: f.ask,
            pools: [...share.keys()].map((P) => short(P.name)).join(" + "),
            knifeItems: outs.length, adjustedFloat: T,
            cost, evFast: ev, evPatient: evP, rtp: ev / cost,
            pProfit: outs.filter((o) => o.v > cost).reduce((a, o) => a + o.p, 0),
            p1k: outs.filter((o) => o.v >= 1000).reduce((a, o) => a + o.p, 0),
            best: best.name, bestValue: best.v,
          });
        }
        options.sort((a, b) => b.rtp - a.rtp);
        rows.push(...options.slice(0, PER));
      }
    }
  }
}

rows.sort((a, b) => b.rtp - a.rtp);
const r2 = (n: number) => Math.round(n * 100) / 100;
const cols: (keyof Row)[] = ["owned", "ownedWear", "ownedCount", "ownedValue", "filler", "fillerWear", "fillerCount", "fillerAsk", "pools", "knifeItems", "adjustedFloat", "cost", "evFast", "evPatient", "rtp", "pProfit", "p1k", "best", "bestValue"];
const cell = (v: unknown) => (typeof v === "number" ? String(r2(v)) : `"${String(v).replace(/"/g, '""')}"`);
writeFileSync(`${OUT}.csv`, [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n");
writeFileSync(`${OUT}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), fee: FEE, rows }, null, 0));

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
console.log(`\nIGL-9000 · knife longlist   ${pools.length} collections with a knife pool   ${ownedItems} owned-item wears priced   ${rows.length} contracts → ${OUT}.csv / .json`);
const band = (lo: number, hi: number) => rows.filter((r) => r.rtp >= lo && r.rtp < hi).length;
console.log(`  RTP ≥100%: ${band(1, 99)}   90–100%: ${band(0.9, 1)}   80–90%: ${band(0.8, 0.9)}   <80%: ${band(0, 0.8)}   (fast sale, floats at grade middles)`);
console.log(`  contracts with a ≥$1,000 outcome: ${rows.filter((r) => r.p1k > 0).length}\n`);
