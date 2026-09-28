/**
 * IGL-9000 — mixed-collection, float-steered trade-up sweep.
 *
 *   npx tsx scripts/igl9000-mix.ts [--top 25] [--min-cost 1] [--max-cost 50]
 *                                  [--float-skew 0.2] [--tier "Mil-Spec Grade"] [--sort rtp|pwin]
 *
 * The plain catalog sweep (igl9000-gamble.ts) builds one-collection contracts at
 * mid-bracket floats. Profitable budget trade-ups use two levers it never pulls:
 *   1. MIX two collections: k inputs from A, N−k from B. Each collection's
 *      outcomes get probability (its input count / N) / (its outcome count).
 *   2. STEER the float: output float = outMin + T·(outMax − outMin), where T is
 *      the mean of the inputs' normalized floats. Buying inputs just low enough
 *      lands outcomes one wear grade up.
 *
 * Search: for every ordered collection pair, every split k, and every T that
 * sits just under an outcome's wear boundary, find the cheapest inputs with mean
 * normalized float ≤ T. Input cost per collection is precomputed as a step
 * function c(n) = min ask to own an input with normalized float ≤ n, so a pair
 * costs a scan over A's frontier. Finalists are re-valued by the engine's own
 * valueContract with the chosen floats.
 *
 * The float premium comes from the quote's floatSkew (low edge of a bracket
 * costs +skew/2). It is a model, not listing data: rerun with a higher
 * --float-skew to see which contracts survive expensive low-float fillers.
 */
import { RARITY_ORDER, WEAR_RANGES, type PriceTable, type Rarity, type Skin } from "@/types/cs2";
import { loadPrices, loadSkins } from "@/lib/data";
import { marketAvgPriceProvider, type PriceProvider } from "@/lib/igl9000-quote";
import { valueContract, type CandidateContract, type ValuedContract } from "@/lib/igl9000-engine";
import { floatToWear } from "@/lib/tradeup";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TOP = Number(arg("top") ?? 25);
const MIN_COST = Number(arg("min-cost") ?? 1);
const MAX_COST = Number(arg("max-cost") ?? 50);
const FLOAT_SKEW = Number(arg("float-skew") ?? 0.2);
const ONLY_TIER = arg("tier");
const MAX_SPREAD = Number(arg("max-spread") ?? 2);
const MIN_DEPTH = Number(arg("min-depth") ?? 0.1);
const SORT = arg("sort") === "pwin" ? "pwin" : "rtp";

const EXCLUDED = "Limited Edition Item";
const G = 1000; // normalized-float grid resolution
const BOUNDARIES = WEAR_RANGES.slice(0, -1).map((w) => w.max); // 0.07 0.15 0.38 0.45
const SHOCK = 0.3;

const skins: Skin[] = loadSkins();
const prices: PriceTable = loadPrices();
const skinById = new Map(skins.map((s) => [s.id, s]));
// The market-avg quote excludes Steam, so with one other venue its dispersion
// guard never fires and a single stale Skinport listing ($334 vs Steam's $12)
// becomes a jackpot. Corroborate against Steam before trusting any price.
const baseQuote = marketAvgPriceProvider(prices, { floatSkew: FLOAT_SKEW });
const quote: PriceProvider = (id, wear, st, f) => {
  const src = prices[`${id}|${wear}|${st ? "st" : "norm"}`]?.sources;
  const v = src ? Object.values(src).filter((p): p is number => typeof p === "number" && p > 0) : [];
  if (v.length > 1 && Math.max(...v) / Math.min(...v) > MAX_SPREAD) return null;
  return baseQuote(id, wear, st, f);
};

const colsOf = (s: Skin) => s.collections.filter((c) => c.name !== EXCLUDED);

interface Col {
  id: string;
  name: string;
  outputs: Skin[]; // distinct by name
  cost: Float64Array; // cost[i] = cheapest input with normalized float ≤ i/G
  pickSkin: (Skin | null)[];
  pickFloat: Float64Array;
  frontier: number[]; // indices where cost strictly drops
  breakpoints: number[]; // T values just under an output's wear boundary
}

function buildCol(id: string, name: string, inputs: Skin[], outputs: Skin[]): Col | null {
  const cost = new Float64Array(G + 1).fill(Infinity);
  const pickSkin: (Skin | null)[] = Array(G + 1).fill(null);
  const pickFloat = new Float64Array(G + 1);

  for (const s of inputs) {
    const span = s.max_float - s.min_float;
    if (span <= 0) continue;
    for (const wr of WEAR_RANGES) {
      const bLo = Math.max(wr.min, s.min_float);
      const hi = Math.min(wr.max, s.max_float) - 1e-4;
      if (hi <= bLo) continue;
      // the lowest floats in a bracket are collector pieces, not buyable filler
      const lo = bLo + MIN_DEPTH * (hi - bLo);
      // ask is linear in float inside a bracket (floatMultiplier), so two quotes suffice
      const qLo = quote(s.id, wr.wear, false, lo);
      const qHi = quote(s.id, wr.wear, false, hi);
      if (!qLo || !qHi) continue;
      for (let i = Math.max(0, Math.ceil(((lo - s.min_float) / span) * G)); i <= G; i++) {
        const f = Math.min(s.min_float + (i / G) * span, hi);
        const ask = qLo.ask + ((f - lo) / (hi - lo)) * (qHi.ask - qLo.ask);
        if (ask < cost[i]) { cost[i] = ask; pickSkin[i] = s; pickFloat[i] = f; }
      }
    }
  }
  for (let i = 1; i <= G; i++) {
    if (cost[i - 1] <= cost[i]) { cost[i] = cost[i - 1]; pickSkin[i] = pickSkin[i - 1]; pickFloat[i] = pickFloat[i - 1]; }
  }
  if (!Number.isFinite(cost[G])) return null;

  const frontier: number[] = [];
  for (let i = 0; i <= G; i++) if (Number.isFinite(cost[i]) && (i === 0 || cost[i] < cost[i - 1])) frontier.push(i);

  const bp = new Set<number>([1]);
  for (const o of outputs) {
    const r = o.max_float - o.min_float;
    if (r <= 0) continue;
    for (const b of BOUNDARIES) {
      const t = (b - o.min_float) / r - 1e-4;
      if (t > 0 && t < 1) bp.add(Math.round(t * 1e5) / 1e5);
    }
  }
  return { id, name, outputs, cost, pickSkin, pickFloat, frontier, breakpoints: [...bp] };
}

// Net sale value of each of a collection's outcomes at contract float T.
const evCache = new Map<string, number[] | null>();
function outcomeBids(c: Col, T: number): number[] | null {
  const key = `${c.id}|${T}`;
  if (evCache.has(key)) return evCache.get(key)!;
  const bids: number[] = [];
  let ok = true;
  for (const o of c.outputs) {
    const f = o.min_float + T * (o.max_float - o.min_float);
    const q = quote(o.id, floatToWear(f), false, f);
    if (!q) { ok = false; break; }
    bids.push(q.bid_net);
  }
  const res = ok ? bids : null;
  evCache.set(key, res);
  return res;
}

interface Hit {
  tier: Rarity;
  size: number;
  A: Col; B: Col | null; k: number; T: number;
  iA: number; iB: number;
  cost: number; ev: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const tiers = RARITY_ORDER.slice(0, RARITY_ORDER.indexOf("Covert") + 1).filter((t) => !ONLY_TIER || t === ONLY_TIER);
const hits: Hit[] = [];
let pairsScanned = 0;

for (const tier of tiers) {
  const out = RARITY_ORDER[RARITY_ORDER.indexOf(tier) + 1];
  const N = tier === "Covert" ? 5 : 10;
  const byCol = new Map<string, { name: string; inputs: Skin[]; outputs: Map<string, Skin> }>();
  for (const s of skins) {
    if (s.souvenir) continue;
    const cs = colsOf(s);
    if (s.rarity.name === tier) {
      if (cs.length !== 1) continue; // multi-collection inputs split weight; keep the model exact
      const e = byCol.get(cs[0].id) ?? { name: cs[0].name, inputs: [] as Skin[], outputs: new Map<string, Skin>() };
      e.inputs.push(s);
      byCol.set(cs[0].id, e);
    }
  }
  for (const s of skins) {
    if (s.souvenir || s.rarity.name !== out) continue;
    for (const c of colsOf(s)) {
      const e = byCol.get(c.id);
      if (e && !e.outputs.has(s.name)) e.outputs.set(s.name, s);
    }
  }
  const cols: Col[] = [];
  for (const [id, e] of byCol) {
    if (!e.inputs.length || !e.outputs.size) continue;
    const c = buildCol(id, e.name, e.inputs, [...e.outputs.values()]);
    if (c) cols.push(c);
  }

  // Best hit per (A, B) — ordered, so A carries k inputs. B null = single collection.
  for (const A of cols) {
    for (const B of [null, ...cols]) {
      if (B === A) continue;
      pairsScanned++;
      let best: Hit | null = null;
      const Ts = B ? [...new Set([...A.breakpoints, ...B.breakpoints])] : A.breakpoints;
      for (const T of Ts) {
        const bA = outcomeBids(A, T);
        if (!bA) continue;
        const bB = B ? outcomeBids(B, T) : null;
        if (B && !bB) continue;
        const evA = mean(bA), evB = bB ? mean(bB) : 0;
        for (let k = B ? 1 : N; k <= (B ? N - 1 : N); k++) {
          const ev = (k * evA + (N - k) * evB) / N;
          let cost = Infinity, iA = -1, iB = -1;
          for (const ia of A.frontier) {
            const nA = ia / G;
            if (k * nA > N * T + 1e-12) break;
            let ib = -1, c = k * A.cost[ia];
            if (B) {
              const nB = Math.min(1, (N * T - k * nA) / (N - k));
              ib = Math.floor(nB * G + 1e-9);
              c += (N - k) * B.cost[ib];
            }
            if (c < cost) { cost = c; iA = ia; iB = ib; }
          }
          if (!Number.isFinite(cost) || cost < MIN_COST || cost > MAX_COST) continue;
          if (!best || ev - cost > best.ev - best.cost) best = { tier, size: N, A, B, k, T, iA, iB, cost, ev };
        }
      }
      if (best && best.ev > best.cost) hits.push(best);
    }
  }
}

// ── verify finalists with the engine ────────────────────────────────────────
function toContract(h: Hit): CandidateContract {
  const slots = [
    ...Array(h.k).fill(0).map(() => ({ skinId: h.A.pickSkin[h.iA]!.id, float: h.A.pickFloat[h.iA], owned: false })),
    ...(h.B ? Array(h.size - h.k).fill(0).map(() => ({ skinId: h.B!.pickSkin[h.iB]!.id, float: h.B!.pickFloat[h.iB], owned: false })) : []),
  ];
  return { tier: h.tier, size: h.size, collectionId: h.B ? "*mixed*" : h.A.id, collectionName: h.B ? `${h.A.name} + ${h.B.name}` : h.A.name, slots, buys: h.size };
}

// One row per unordered collection pair: A+B and B+A are the same contract family.
const seen = new Set<string>();
const seenWins = new Set<string>();
const norm = (f: number, s: Skin) => (f - s.min_float) / (s.max_float - s.min_float);
const inputColIds = (v: ValuedContract) =>
  new Set(v.contract.slots.flatMap((sl) => colsOf(skinById.get(sl.skinId)!).map((c) => c.id)));

// Inputs are bought as "≤ cap", so a real fill lands anywhere between the bottom
// of the cap's wear bracket and the cap. That brackets the contract's mean
// normalized float, and with it every outcome's float.
function floatWindow(v: ValuedContract): { tLo: number; tHi: number } {
  let lo = 0, hi = 0;
  for (const sl of v.contract.slots) {
    const sk = skinById.get(sl.skinId)!;
    const br = WEAR_RANGES.find((w) => w.wear === floatToWear(sl.float))!;
    lo += norm(Math.max(br.min, sk.min_float), sk);
    hi += norm(sl.float, sk);
  }
  const n = v.contract.slots.length;
  return { tLo: lo / n, tHi: hi / n };
}

const verified = hits
  .sort((a, b) => b.ev / b.cost - a.ev / a.cost)
  .filter((h) => {
    const key = [h.tier, h.A.id, h.B?.id ?? ""].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0, TOP * 20)
  .map((h) => ({ h, v: valueContract(toContract(h), skinById, quote, false) }))
  .filter((x) => x.v && !x.v.approx && x.v.delta > 0)
  .map((x) => {
    const v = x.v!;
    const wins = v.outcomes.filter((o) => (o.bidNet ?? 0) > v.cost);
    const pWin = wins.reduce((a, o) => a + o.probability, 0);
    const top = [...v.outcomes].sort((a, b) => (b.bidNet ?? 0) - (a.bidNet ?? 0))[0];
    // Shock EVERY winning outcome, not just the top one: a contract carried by
    // several profitable outcomes should survive a broad drop, one carried by a
    // single jackpot should not.
    const shockedEv = v.ev - wins.reduce((a, o) => a + o.probability * (o.bidNet ?? 0), 0) * SHOCK;
    return { ...x, v, wins, pWin, top, robust: shockedEv > v.cost, rtp: v.ev / v.cost };
  })
  .sort((a, b) => (SORT === "pwin" ? b.pWin - a.pWin || b.rtp - a.rtp : b.rtp - a.rtp))
  // One row per set of winning outcomes: a strong collection paired with twenty
  // interchangeable fillers is one opportunity, not twenty.
  .filter((x) => {
    const key = `${x.h.tier}|${x.wins.map((o) => `${o.name}|${o.wear}`).sort().join(",")}`;
    if (seenWins.has(key)) return false;
    seenWins.add(key);
    return true;
  })
  .slice(0, TOP);

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const short = (n: string) => n.replace(/^The /, "").replace(/ Collection$/, "");
const WEAR_ABBR: Record<string, string> = { "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS" };
const W = (f: number) => WEAR_ABBR[floatToWear(f)];

console.log(`\nIGL-9000 · mixed-collection float-steered sweep   float-skew ${FLOAT_SKEW}   min-depth ${MIN_DEPTH}   max-spread ${MAX_SPREAD}×   cost $${MIN_COST}–$${MAX_COST}   sort ${SORT}`);
console.log(`  collection pairs scanned ${pairsScanned} → +EV hits ${hits.length} → engine-verified shown ${verified.length}`);
console.log(`  outcome floats are a range: inputs bought "≤ cap" can fill anywhere from the bottom of that wear grade up to the cap.`);
console.log(`  Payouts are valued at the WORST end (inputs at the cap); a lower fill can only improve wear.\n`);

verified.forEach(({ h, v, wins, pWin, robust, rtp }, i) => {
  const { tLo, tHi } = floatWindow(v);
  const cols = inputColIds(v);

  const groups = new Map<string, { n: number; f: number }>();
  for (const sl of v.contract.slots) {
    const g = groups.get(sl.skinId) ?? { n: 0, f: sl.float };
    g.n++;
    groups.set(sl.skinId, g);
  }

  const winValue = wins.reduce((a, o) => a + o.probability * (o.bidNet ?? 0), 0) / (pWin || 1);
  console.log(
    `${String(i + 1).padStart(2)}. ${h.tier} → ${v.outputRarity}   cost ${money(v.cost)}   EV ${money(v.ev)}   RTP ${(rtp * 100).toFixed(0)}%` +
      `   P(profit) ${pct(pWin)} across ${wins.length} of ${v.outcomes.length} outcomes   avg win ${money(winValue)}` +
      (robust ? "" : "   [fragile: −30% on the winners kills it]"),
  );
  console.log(`    inputs (avg normalized float ${tLo.toFixed(4)}–${tHi.toFixed(4)})`);
  for (const [id, g] of groups) {
    const sk = skinById.get(id)!;
    const br = WEAR_RANGES.find((w) => w.wear === floatToWear(g.f))!;
    const lo = Math.max(br.min, sk.min_float);
    console.log(
      `      ${String(g.n).padStart(2)}× ${sk.name.padEnd(32)} ${WEAR_ABBR[br.wear]} ${lo.toFixed(3)}–${g.f.toFixed(3)}` +
        `   ${money(quote(id, br.wear, false, g.f)!.ask)} ea   [${short(colsOf(sk)[0].name)}]`,
    );
  }
  console.log(`    outcomes`);
  for (const o of [...v.outcomes].sort((a, b) => (b.bidNet ?? 0) - (a.bidNet ?? 0))) {
    const sk = skinById.get(o.skinId)!;
    const fLo = sk.min_float + tLo * (sk.max_float - sk.min_float);
    const fHi = sk.min_float + tHi * (sk.max_float - sk.min_float);
    const wear = W(fLo) === W(fHi) ? W(fHi) : `${W(fLo)}/${W(fHi)}`;
    const col = colsOf(sk).find((c) => cols.has(c.id)) ?? colsOf(sk)[0];
    const win = (o.bidNet ?? 0) > v.cost;
    console.log(
      `      ${win ? "WIN " : "    "}${pct(o.probability).padStart(6)}  ${money(o.bidNet ?? 0).padStart(8)}  ` +
        `${fLo.toFixed(4)}–${fHi.toFixed(4)} ${wear.padEnd(5)}  ${sk.name.padEnd(34)} [${short(col.name)}]`,
    );
  }
  console.log("");
});
