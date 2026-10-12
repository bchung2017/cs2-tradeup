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
 *   - knives at the top buy order, each Doppler phase its own outcome (lib/doppler.ts)
 *   - non-StatTrak only
 * Writes <out>.csv and <out>.json. The JSON also carries every knife pool (one
 * entry per Doppler phase) and each entry's value per wear, so the site can
 * expand any row into a full contract (lib/longlist-venture.ts).
 */
import { writeFileSync } from "node:fs";
import { WEAR_RANGES, type Skin, type Wear } from "@/types/cs2";
import { loadSkins } from "@/lib/data";
import { floatToWear } from "@/lib/tradeup";
import { FEEDS, loadFeed, quoteOf } from "@/lib/third-party-feeds";
import { buildPools, knifeValuer, type Pool } from "@/lib/igl9000-knife";
import type { LonglistFile, LonglistRow } from "@/lib/ventures";
import { phaseShares, withPhase } from "@/lib/doppler";

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
const phaseRows = new Map<string, Skin[]>();
for (const s of skins) if (s.phase) phaseRows.set(s.name, [...(phaseRows.get(s.name) ?? []), s]);

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
  owned: string; ownedId: string; ownedWear: string; ownedCount: number; ownedValue: number; ownedFloat: number; ownedPool: string;
  filler: string; fillerId: string; fillerWear: string; fillerCount: number; fillerAsk: number; fillerFloat: number; fillerPool: string;
  pools: string; knifeItems: number; adjustedFloat: number;
  cost: number; evFast: number; evPatient: number; rtp: number; pProfit: number; p1k: number;
  best: string; bestValue: number;
  top: { name: string; probability: number; value: number }[];
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
              if (!kv.phases) { outs.push({ name: `${k.name} (${ABBR[w]})`, p, v: kv.fast }); continue; }
              const ps = phaseShares(kv.phases.map((x) => x.phase));
              for (const ph of kv.phases) outs.push({ name: `${withPhase(k.name, ph.phase)} (${ABBR[w]})`, p: p * ps.get(ph.phase)!, v: ph.fast! });
            }
          }
          if (priced < 0.95) continue; // too much of the pool unpriced to say anything
          const cost = own * v + nf * f.ask;
          const best = outs.reduce((a, o) => (o.v > a.v ? o : a));
          if (best.v <= cost) continue; // no outcome beats the cost
          options.push({
            owned: s.name, ownedId: s.id, ownedWear: ABBR[g.wear], ownedCount: own, ownedValue: v, ownedFloat: g.mid, ownedPool: short(A.name),
            filler: f.skin.name, fillerId: f.skin.id, fillerWear: ABBR[f.wear], fillerCount: nf, fillerAsk: f.ask, fillerFloat: f.mid, fillerPool: short(B.name),
            pools: [...share.keys()].map((P) => short(P.name)).join(" + "),
            knifeItems: outs.length, adjustedFloat: T,
            cost, evFast: ev, evPatient: evP, rtp: ev / cost,
            pProfit: outs.filter((o) => o.v > cost).reduce((a, o) => a + o.p, 0),
            p1k: outs.filter((o) => o.v >= 1000).reduce((a, o) => a + o.p, 0),
            best: best.name, bestValue: best.v,
            top: [...outs].sort((a, b) => b.v - a.v).slice(0, 3).map((o) => ({ name: o.name, probability: o.p, value: o.v })),
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
const cols: (keyof Omit<Row, "top">)[] = ["owned", "ownedWear", "ownedCount", "ownedValue", "filler", "fillerWear", "fillerCount", "fillerAsk", "pools", "knifeItems", "adjustedFloat", "cost", "evFast", "evPatient", "rtp", "pProfit", "p1k", "best", "bestValue"];
const cell = (v: unknown) => (typeof v === "number" ? String(r2(v)) : `"${String(v).replace(/"/g, '""')}"`);
writeFileSync(`${OUT}.csv`, [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n");
const now = new Date().toISOString();
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const longlist: LonglistRow[] = rows.map((r) => ({
  key: `${r.owned}@${r.ownedWear}x${r.ownedCount}+${r.filler}@${r.fillerWear}x${r.fillerCount}`,
  owned: r.owned, ownedId: r.ownedId, ownedWear: r.ownedWear, ownedCount: r.ownedCount, ownedValue: r2(r.ownedValue), ownedFloat: r4(r.ownedFloat), ownedPool: r.ownedPool,
  filler: r.filler, fillerId: r.fillerId, fillerWear: r.fillerWear, fillerCount: r.fillerCount, fillerAsk: r2(r.fillerAsk), fillerFloat: r4(r.fillerFloat), fillerPool: r.fillerPool,
  pools: r.pools.split(" + "), knifeItems: r.knifeItems, adjustedFloat: r4(r.adjustedFloat),
  cost: r2(r.cost), value: r2(r.evFast), valuePatient: r2(r.evPatient), backPerDollar: r4(r.rtp),
  pProfit: r4(r.pProfit), p1k: r4(r.p1k),
  top: r.top.map((t) => ({ name: t.name, probability: r4(t.probability), value: r2(t.value) })),
  firstSeenAt: now,
}));
// every pool a row draws on: its knives (one entry per Doppler phase) and what
// each sells for at each wear, so a row can be expanded into a full contract
const used = new Set(rows.flatMap((r) => [r.ownedPool, r.fillerPool]));
const poolTable: NonNullable<LonglistFile["pools"]> = {};
const values: NonNullable<LonglistFile["values"]> = {};
for (const P of pools) {
  if (!used.has(short(P.name))) continue;
  const knives: NonNullable<LonglistFile["pools"]>[string]["knives"] = [];
  for (const k of P.knives) {
    const entries = phaseRows.get(k.name) ?? [k];
    for (const e of entries) knives.push({ skinId: e.id, name: e.name, ...(e.phase ? { phase: e.phase } : {}), min: e.min_float, max: e.max_float });
    for (const g of WEAR_RANGES) {
      if (g.min >= k.max_float || g.max <= k.min_float) continue;
      const kv = valueOf(k, g.wear);
      for (const e of entries) {
        const val = e.phase ? kv.phases?.find((x) => x.phase === e.phase)?.fast : kv.fast;
        if (val != null) values[`${e.id}|${g.wear}`] = r2(val);
      }
    }
  }
  poolTable[short(P.name)] = { name: P.name, knives };
}
writeFileSync(`${OUT}.json`, JSON.stringify({ generatedAt: now, rows: longlist, pools: poolTable, values } satisfies LonglistFile));

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
console.log(`\nIGL-9000 · knife longlist   ${pools.length} collections with a knife pool   ${ownedItems} owned-item wears priced   ${rows.length} contracts → ${OUT}.csv / .json`);
const band = (lo: number, hi: number) => rows.filter((r) => r.rtp >= lo && r.rtp < hi).length;
console.log(`  RTP ≥100%: ${band(1, 99)}   90–100%: ${band(0.9, 1)}   80–90%: ${band(0.8, 0.9)}   <80%: ${band(0, 0.8)}   (fast sale, floats at grade middles)`);
console.log(`  contracts with a ≥$1,000 outcome: ${rows.filter((r) => r.p1k > 0).length}\n`);
