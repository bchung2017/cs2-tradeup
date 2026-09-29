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
// Edge premium: floats just past a wear boundary look like the better grade and
// are priced like it. First run (2026-09-29) paid 3.4-5.4x the model for P250
// Red Tide FT @0.17 and MAG-7 Resupply MW @0.08, both within 0.02 of a boundary.
// The premium is about looks, so the band is an absolute float distance above the
// grade's lower bound, not a fraction of the grade (Battle-Scarred is 0.55 wide):
// EDGE_MULT within EDGE_BAND, tapering linearly to 1x at 2*EDGE_BAND.
const EDGE_MULT = Number(arg("edge-mult") ?? 1);
const EDGE_BAND = Number(arg("edge-band") ?? 0.03);
const edgeFactor = (dist: number) =>
  dist < EDGE_BAND ? EDGE_MULT : dist < 2 * EDGE_BAND ? EDGE_MULT - (EDGE_MULT - 1) * ((dist - EDGE_BAND) / EDGE_BAND) : 1;

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

// Position of a float inside its (skin-clipped) wear grade, and the part of the
// grade free of the edge premium.
function gradeOf(sk: Skin, f: number) {
  const br = WEAR_RANGES.find((w) => w.wear === floatToWear(f))!;
  const lo = Math.max(br.min, sk.min_float);
  const hi = Math.min(br.max, sk.max_float) - 1e-4;
  return { br, lo, hi, dist: f - lo, clean: Math.min(hi, lo + 2 * EDGE_BAND) };
}

// Same quote, with the edge premium on the BUY side. Sale values are left alone:
// a low-float outcome selling at a premium is upside we don't count on.
const buyQuote: PriceProvider = (id, wear, st, f) => {
  const q = quote(id, wear, st, f);
  const sk = skinById.get(id);
  if (!q || f == null || !sk || EDGE_MULT === 1) return q;
  return { ...q, ask: q.ask * edgeFactor(gradeOf(sk, f).dist) };
};

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
        const ask = (qLo.ask + ((f - lo) / (hi - lo)) * (qHi.ask - qLo.ask)) * edgeFactor(f - bLo);
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

interface Slot { col: Col; j: number } // j indexes the DP grid (normalized float ≤ j/GD)

interface Hit {
  tier: Rarity;
  size: number;
  slots: Slot[];
  T: number;
  cost: number; ev: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Coarser float grid for the knapsack. A slot's float is rounded UP to the grid,
// so any contract the DP accepts really does fit the float budget.
const GD = 200;
const STEP = G / GD;

interface Item { col: Col; j: number; cost: number; val: number; isA: boolean }

// Exact best contract that includes at least one input from `A`, for a fixed
// target average float T: choose N slots, each any (collection, float) item,
// with Σ float ≤ N·T, maximizing Σ (collection EV share − input cost).
// Pure-EV optima need at most two item types (an LP with two constraints has
// basic solutions of support two); the integer DP can use more when rounding
// or the "include A" requirement makes that better.
// With A = null there is no anchor requirement: the unconstrained optimum.
function bestWithAnchor(A: Col | null, T: number, N: number, others: Col[]): { slots: Slot[]; delta: number; cost: number } | null {
  const bA = A ? outcomeBids(A, T) : null;
  if (A && !bA) return null;
  const W = Math.floor(N * T * GD + 1e-9);
  const pool: Item[] = [];
  const addCol = (c: Col, v: number, isA: boolean) => {
    let last = Infinity;
    for (let j = 0; j <= Math.min(GD, W); j++) {
      const cost = c.cost[j * STEP];
      if (!Number.isFinite(cost) || cost >= last) continue;
      last = cost;
      pool.push({ col: c, j, cost, val: v - cost, isA });
    }
  };
  if (A) addCol(A, mean(bA!) / N, true);
  for (const c of others) {
    if (c === A) continue;
    const b = outcomeBids(c, T);
    if (b) addCol(c, mean(b) / N, !A);
  }
  // Pareto prune: a non-anchor item is useless if another item is at least as
  // light and at least as valuable. Anchor items stay (the DP must use one).
  pool.sort((x, y) => x.j - y.j || y.val - x.val);
  const items: Item[] = [];
  let bestVal = -Infinity;
  for (const it of pool) {
    if ((A && it.isA) || it.val > bestVal + 1e-12) items.push(it);
    if (it.val > bestVal) bestVal = it.val;
  }

  const S = (W + 1) * 2;
  const dp = new Float64Array((N + 1) * S).fill(-Infinity);
  const via = new Int32Array((N + 1) * S).fill(-1); // item index
  const from = new Int32Array((N + 1) * S).fill(-1); // previous state offset
  dp[0] = 0;
  for (let sl = 0; sl < N; sl++) {
    const base = sl * S, next = (sl + 1) * S;
    for (let w = 0; w <= W; w++) {
      for (let f = 0; f < 2; f++) {
        const cur = dp[base + w * 2 + f];
        if (cur === -Infinity) continue;
        for (let k = 0; k < items.length; k++) {
          const it = items[k];
          const w2 = w + it.j;
          if (w2 > W) break;
          const idx = next + w2 * 2 + (it.isA ? 1 : f);
          const nv = cur + it.val;
          if (nv > dp[idx]) { dp[idx] = nv; via[idx] = k; from[idx] = base + w * 2 + f; }
        }
      }
    }
  }
  let bi = -1;
  for (let w = 0; w <= W; w++) {
    const idx = N * S + w * 2 + 1;
    if (dp[idx] > -Infinity && (bi < 0 || dp[idx] > dp[bi])) bi = idx;
  }
  if (bi < 0) return null;
  const slots: Slot[] = [];
  let cost = 0;
  for (let idx = bi; idx >= S; idx = from[idx]) {
    const it = items[via[idx]];
    slots.push({ col: it.col, j: it.j });
    cost += it.cost;
  }
  return { slots, delta: dp[bi], cost };
}

const tiers = RARITY_ORDER.slice(0, RARITY_ORDER.indexOf("Covert") + 1).filter((t) => !ONLY_TIER || t === ONLY_TIER);
const hits: Hit[] = [];
let anchorsScanned = 0;
const freeCols = new Map<number, number>(); // collections used by unconstrained per-T optima

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

  // Best contract per anchor collection, over every T at one of its breakpoints.
  for (const A of cols) {
    anchorsScanned++;
    let best: Hit | null = null;
    for (const T of A.breakpoints) {
      const r = bestWithAnchor(A, T, N, cols);
      if (!r || r.delta <= 0 || r.cost < MIN_COST || r.cost > MAX_COST) continue;
      if (!best || r.delta > best.ev - best.cost) best = { tier, size: N, slots: r.slots, T, cost: r.cost, ev: r.cost + r.delta };
    }
    if (best) hits.push(best);
  }

  // Unconstrained optimum at every breakpoint of every collection: answers
  // whether 3+ collections ever win on their own, without a forced anchor.
  const allTs = [...new Set(cols.flatMap((c) => c.breakpoints))];
  for (const T of allTs) {
    const r = bestWithAnchor(null, T, N, cols);
    if (!r || r.delta <= 0 || r.cost < MIN_COST || r.cost > MAX_COST) continue;
    const k = new Set(r.slots.map((x) => x.col.id)).size;
    freeCols.set(k, (freeCols.get(k) ?? 0) + 1);
    hits.push({ tier, size: N, slots: r.slots, T, cost: r.cost, ev: r.cost + r.delta });
  }
}

// The average normalized float may rise until the first outcome changes grade.
function tMaxOf(h: Hit): number {
  let tMax = 1;
  for (const c of new Set(h.slots.map((x) => x.col))) {
    for (const o of c.outputs) {
      const r = o.max_float - o.min_float;
      if (r <= 0) continue;
      for (const b of BOUNDARIES) {
        const t = (b - o.min_float) / r - 1e-4;
        if (t >= h.T - 1e-9 && t < tMax) tMax = t;
      }
    }
  }
  return tMax;
}

// ── verify finalists with the engine ────────────────────────────────────────
function toContract(h: Hit): CandidateContract {
  // The cost curve stores the LOWEST float that reaches a price, which would pin
  // every cap to the start of the clean zone. The slot's float budget is j/GD,
  // so any float up to that (inside the picked grade) is equally acceptable.
  const raw = h.slots.map(({ col, j }) => {
    const sk = col.pickSkin[j * STEP]!;
    const g = gradeOf(sk, col.pickFloat[j * STEP]);
    const budget = sk.min_float + (j / GD) * (sk.max_float - sk.min_float);
    return { skinId: sk.id, float: Math.max(col.pickFloat[j * STEP], Math.min(budget, g.hi)), owned: false };
  });
  // The DP spends only the float budget it needs. Hand the unused budget back as
  // looser caps (water-filling, each slot kept inside its own wear grade): a
  // wider buy zone is easier to fill and further from the priced-up edge.
  const nz = (sl: { skinId: string; float: number }) => norm(sl.float, skinById.get(sl.skinId)!);
  const tMax = tMaxOf(h);
  let slack = h.size * tMax - raw.reduce((a, sl) => a + nz(sl), 0) - 1e-6;
  for (let round = 0; round < 20 && slack > 1e-9; round++) {
    const open = raw.filter((sl) => {
      const sk = skinById.get(sl.skinId)!;
      return norm(gradeOf(sk, sl.float).hi, sk) - nz(sl) > 1e-9;
    });
    if (!open.length) break;
    const share = slack / open.length;
    for (const sl of open) {
      const sk = skinById.get(sl.skinId)!;
      const add = Math.min(share, norm(gradeOf(sk, sl.float).hi, sk) - nz(sl));
      sl.float += add * (sk.max_float - sk.min_float);
      slack -= add;
    }
  }
  // Grid rounding scatters one skin across near-identical caps (0.449, 0.446…).
  // Collapse each skin+grade to its strictest cap: lower floats only help.
  const capOf = new Map<string, number>();
  for (const sl of raw) {
    const k = `${sl.skinId}|${floatToWear(sl.float)}`;
    capOf.set(k, Math.min(capOf.get(k) ?? Infinity, sl.float));
  }
  const slots = raw.map((sl) => ({ ...sl, float: capOf.get(`${sl.skinId}|${floatToWear(sl.float)}`)! }));
  const names = [...new Set(h.slots.map((s) => s.col.name))];
  return { tier: h.tier, size: h.size, collectionId: names.length > 1 ? "*mixed*" : h.slots[0].col.id, collectionName: names.join(" + "), slots, buys: h.size };
}

// One row per set of collections used.
const seen = new Set<string>();
const seenWins = new Set<string>();
const variants = new Map<string, number>();
function dominant(h: Hit): Col {
  const n = new Map<Col, number>();
  for (const x of h.slots) n.set(x.col, (n.get(x.col) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0][0];
}
const norm = (f: number, s: Skin) => (f - s.min_float) / (s.max_float - s.min_float);
const inputColIds = (v: ValuedContract) =>
  new Set(v.contract.slots.flatMap((sl) => colsOf(skinById.get(sl.skinId)!).map((c) => c.id)));

// Inputs are bought as "≤ cap", so a real fill lands anywhere between the bottom
// of the cap's wear bracket and the cap. That brackets the contract's mean
// normalized float, and with it every outcome's float.
// Where to actually buy: from the end of the edge band up to the cap. If the cap
// itself sits in the edge band, there is no clean zone and the row is flagged.
function buyLow(sk: Skin, cap: number): { lo: number; edge: boolean } {
  const g = gradeOf(sk, cap);
  if (EDGE_MULT === 1) return { lo: g.lo, edge: false };
  return g.clean < cap ? { lo: g.clean, edge: false } : { lo: g.lo, edge: true };
}

function floatWindow(v: ValuedContract): { tLo: number; tHi: number } {
  let lo = 0, hi = 0;
  for (const sl of v.contract.slots) {
    const sk = skinById.get(sl.skinId)!;
    lo += norm(buyLow(sk, sl.float).lo, sk);
    hi += norm(sl.float, sk);
  }
  const n = v.contract.slots.length;
  return { tLo: lo / n, tHi: hi / n };
}

const verified = hits
  .sort((a, b) => b.ev / b.cost - a.ev / a.cost)
  .filter((h) => {
    const key = [h.tier, ...new Set(h.slots.map((x) => x.col.id))].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0, TOP * 20)
  .map((h) => ({ h, v: valueContract(toContract(h), skinById, buyQuote, false) }))
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
  // One row per set of winning outcomes, then one row per FAMILY: the collection
  // holding the most slots. A strong collection with a dozen interchangeable
  // single fillers is one opportunity; the variant count says how many.
  .filter((x) => {
    const key = `${x.h.tier}|${x.wins.map((o) => `${o.name}|${o.wear}`).sort().join(",")}`;
    if (seenWins.has(key)) return false;
    seenWins.add(key);
    return true;
  })
  .filter((x) => {
    const key = `${x.h.tier}|${dominant(x.h).id}`;
    variants.set(key, (variants.get(key) ?? 0) + 1);
    return variants.get(key) === 1;
  })
  .slice(0, TOP);

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const short = (n: string) => n.replace(/^The /, "").replace(/ Collection$/, "");
const WEAR_ABBR: Record<string, string> = { "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS" };
const W = (f: number) => WEAR_ABBR[floatToWear(f)];

console.log(`\nIGL-9000 · mixed-collection float-steered sweep   float-skew ${FLOAT_SKEW}   min-depth ${MIN_DEPTH}   edge ${EDGE_MULT}× within ${EDGE_BAND} of a grade boundary   max-spread ${MAX_SPREAD}×   cost $${MIN_COST}–$${MAX_COST}   sort ${SORT}`);
console.log(`  anchor collections scanned ${anchorsScanned} → +EV hits ${hits.length} → engine-verified shown ${verified.length}`);
const nCols = (h: Hit) => new Set(h.slots.map((x) => x.col.id)).size;
const dist = new Map<number, number>();
for (const h of hits) dist.set(nCols(h), (dist.get(nCols(h)) ?? 0) + 1);
console.log(`  collections per +EV hit (anchor-forced + free): ${[...dist].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}→${n}`).join("  ")}`);
console.log(`  collections per unconstrained optimum (one per target float): ${[...freeCols].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}→${n}`).join("  ")}`);
console.log(`  outcome floats are a range: inputs bought "≤ cap" can fill anywhere from the bottom of that wear grade up to the cap.`);
console.log(`  Payouts are valued at the WORST end (inputs at the cap); a lower fill can only improve wear.`);
if (EDGE_MULT !== 1) console.log(`  With the edge premium on, input ranges start where the edge band ends: buying lower pays the premium for no gain.`);
console.log("");

verified.forEach(({ h, v, wins, pWin, robust, rtp }, i) => {
  const { tLo, tHi } = floatWindow(v);
  const cols = inputColIds(v);

  const groups = new Map<string, { id: string; n: number; f: number }>();
  for (const sl of v.contract.slots) {
    const key = `${sl.skinId}|${floatToWear(sl.float)}`;
    const g = groups.get(key) ?? { id: sl.skinId, n: 0, f: sl.float };
    g.n++;
    groups.set(key, g);
  }

  const winValue = wins.reduce((a, o) => a + o.probability * (o.bidNet ?? 0), 0) / (pWin || 1);
  console.log(
    `${String(i + 1).padStart(2)}. ${h.tier} → ${v.outputRarity}   cost ${money(v.cost)}   EV ${money(v.ev)}   RTP ${(rtp * 100).toFixed(0)}%` +
      `   P(profit) ${pct(pWin)} across ${wins.length} of ${v.outcomes.length} outcomes   avg win ${money(winValue)}` +
      (robust ? "" : "   [fragile: −30% on the winners kills it]"),
  );
  const nVar = (variants.get(`${h.tier}|${dominant(h).id}`) ?? 1) - 1;
  if (nVar > 0) console.log(`    (+${nVar} variant${nVar > 1 ? "s" : ""} built on ${short(dominant(h).name)} with other fillers)`);
  console.log(
    `    float budget: Σ (float − min)/(max − min) over all ${v.contract.size} inputs ≤ ${(v.contract.size * tMaxOf(h)).toFixed(3)}` +
      `   (these caps use ${(v.contract.size * tHi).toFixed(3)}; avg normalized ${tLo.toFixed(4)}–${tHi.toFixed(4)})`,
  );
  console.log(`    inputs`);
  for (const { id, ...g } of groups.values()) {
    const sk = skinById.get(id)!;
    const br = WEAR_RANGES.find((w) => w.wear === floatToWear(g.f))!;
    const { lo, edge } = buyLow(sk, g.f);
    console.log(
      `      ${String(g.n).padStart(2)}× ${sk.name.padEnd(32)} ${WEAR_ABBR[br.wear]} ${lo.toFixed(3)}–${g.f.toFixed(3)}` +
        `   ${money(buyQuote(id, br.wear, false, g.f)!.ask)} ea   range ${sk.min_float.toFixed(2)}–${sk.max_float.toFixed(2)}   [${short(colsOf(sk)[0].name)}]` +
        (edge ? "   ⚠ cap is inside the edge band: expect edge pricing" : ""),
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
