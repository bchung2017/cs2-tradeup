/**
 * IGL-9000 — Covert ×5 → knife/glove sweep, priced off Steam.
 *
 *   npx tsx scripts/igl9000-knife.ts [--top 15] [--fee 0.025] [--max-cost 5000] [--min-depth 0.1]
 *                                    [--verify-steam K] [--steam-gap 8]
 *
 * Steam caps listings near $1,800 and prices Dopplers as one item, so knife
 * outcomes are priced from the Buff163 and CSFloat feeds, per phase:
 *   fast sale    = top buy order × (1 − fee)        (ranking value)
 *   patient sale = lowest ask × (1 − fee), or the buy order when ask > 3× it
 * A Doppler's share is split evenly across its phases (7 for Doppler, 5 for Gamma
 * Doppler). Real drop rates for the rare phases are unknown and probably lower,
 * so the even split is an upper bound on their value.
 *
 * Contracts: 5 Coverts from one collection (collections that share a knife pool,
 * like Gamma and Gamma 2, give the same odds). For every average normalized
 * float T just under an outcome's wear boundary, each slot takes the cheapest
 * input that reaches it. Inputs are priced two ways:
 *   cash   third-party lowest ask for the wear grade (float-blind)
 *   steam  Steam feed price for the grade; --verify-steam prices the top K from
 *          the n cheapest Steam listings under the float cap
 * Ranking is cash in, cash out. Steam in, cash out is reported beside it: that
 * also converts Steam balance to cash, which is a different trade.
 */
import { WEAR_RANGES, type PriceTable, type Skin, type Wear } from "@/types/cs2";
import { loadPrices, loadSkins } from "@/lib/data";
import { floatToWear } from "@/lib/tradeup";
import { FEEDS, loadFeed, phasesOf, quoteOf } from "@/lib/third-party-feeds";
import { steamMarket } from "@/lib/steam-market";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TOP = Number(arg("top") ?? 15);
const FEE = Number(arg("fee") ?? 0.025); // third-party seller fee (Buff 2.5%; an assumption, see the spec)
const MAX_COST = Number(arg("max-cost") ?? 5000);
const VERIFY = Number(arg("verify-steam") ?? 0);
const MIN_DEPTH = Number(arg("min-depth") ?? 0.1); // never buy in the bottom 10% of a wear grade
const N = 5;
const BOUNDARIES = WEAR_RANGES.slice(0, -1).map((w) => w.max);
const EXCLUDED = "Limited Edition Item";

const skins: Skin[] = loadSkins();
const prices: PriceTable = loadPrices();
const tables = FEEDS.map(loadFeed);

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const ABBR: Record<string, string> = { "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS" };
const short = (n: string) => n.replace(/^The /, "").replace(/ Collection$/, "");
const colsOf = (s: Skin) => s.collections.filter((c) => c.name !== EXCLUDED);

// ── outcome values ──────────────────────────────────────────────────────────
interface Value { fast: number | null; patient: number | null; phases?: { phase: string; fast: number | null }[] }
const valueCache = new Map<string, Value>();
function sale(name: string, phase?: string): { fast: number | null; patient: number | null } {
  const { ask, bid } = quoteOf(tables, name, phase);
  const fast = bid == null ? null : bid * (1 - FEE);
  // a lone ask far above the buy orders is a hope, not a price
  const patient = ask == null ? fast : bid != null && ask > 3 * bid ? fast : ask * (1 - FEE);
  return { fast: fast ?? patient, patient };
}
function valueOf(knife: Skin, wear: Wear): Value {
  const name = `${knife.name} (${wear})`;
  const hit = valueCache.get(name);
  if (hit) return hit;
  const phases = phasesOf(knife.name);
  let v: Value;
  if (!phases) v = sale(name);
  else {
    const per = phases.map((phase) => ({ phase, ...sale(name, phase) }));
    const ok = per.every((p) => p.fast != null);
    v = {
      fast: ok ? per.reduce((a, p) => a + p.fast!, 0) / per.length : null,
      patient: ok ? per.reduce((a, p) => a + (p.patient ?? p.fast!), 0) / per.length : null,
      phases: per.map(({ phase, fast }) => ({ phase, fast })),
    };
  }
  valueCache.set(name, v);
  return v;
}

// ── collections: Covert inputs and their knife pool ─────────────────────────
interface Pool { id: string; name: string; inputs: Skin[]; knives: Skin[] }
const pools = new Map<string, Pool>();
for (const s of skins) {
  if (s.souvenir) continue;
  for (const c of colsOf(s)) {
    const p = pools.get(c.id) ?? { id: c.id, name: c.name, inputs: [], knives: [] };
    if (s.rarity.name === "Covert" && colsOf(s).length === 1) p.inputs.push(s);
    if (s.rarity.name === "Extraordinary" && !p.knives.some((k) => k.name === s.name)) p.knives.push(s); // Doppler rows collapse to one name
    pools.set(c.id, p);
  }
}

const steamFeed = (s: Skin, wear: string) => {
  const v = prices[`${s.id}|${wear}|norm`]?.sources?.steam;
  return typeof v === "number" && v > 0 ? v : null;
};

interface Input { skin: Skin; wear: Wear; lo: number; cap: number; cash: number | null; steam: number | null }
// Cheapest input of the pool whose normalized float can be ≤ T, per price basis.
function inputsAt(p: Pool, T: number): { cash: Input | null; steam: Input | null } {
  let cash: Input | null = null;
  let steam: Input | null = null;
  for (const s of p.inputs) {
    const f = s.min_float + T * (s.max_float - s.min_float);
    for (const g of WEAR_RANGES) {
      const lo = Math.max(g.min, s.min_float);
      if (lo > f || lo >= Math.min(g.max, s.max_float)) continue;
      const hi = Math.min(g.max, s.max_float) - 1e-4;
      const cap = Math.min(f, hi);
      // the lowest floats in a grade are collector pieces: a cap down there has
      // no listings to fill it (gloves-FN contracts needed inputs ≤0.009; Steam had 0–4)
      if (cap < lo + MIN_DEPTH * (hi - lo)) continue;
      const c = quoteOf(tables, `${s.name} (${g.wear})`).ask;
      const st = steamFeed(s, g.wear);
      const it: Input = { skin: s, wear: g.wear, lo, cap, cash: c, steam: st };
      if (c != null && (!cash || c < cash.cash!)) cash = it;
      if (st != null && (!steam || st < steam.steam!)) steam = it;
    }
  }
  return { cash, steam };
}

interface Outcome { knife: Skin; wear: Wear; float: number; p: number; v: Value }
interface Contract { pool: Pool; T: number; cash: Input; steam: Input | null; outcomes: Outcome[]; evFast: number; evPatient: number; costCash: number }

const contracts: Contract[] = [];
for (const p of pools.values()) {
  if (!p.inputs.length || !p.knives.length) continue;
  const Ts = new Set<number>([1]);
  for (const k of p.knives) {
    for (const b of BOUNDARIES) {
      const t = (b - k.min_float) / (k.max_float - k.min_float) - 1e-4;
      if (t > 0 && t < 1) Ts.add(Math.round(t * 1e5) / 1e5);
    }
  }
  let best: Contract | null = null;
  for (const T of Ts) {
    const { cash, steam } = inputsAt(p, T);
    if (!cash) continue;
    const outcomes: Outcome[] = [];
    let ok = true;
    for (const k of p.knives) {
      const float = k.min_float + T * (k.max_float - k.min_float);
      const wear = floatToWear(float);
      const v = valueOf(k, wear);
      if (v.fast == null) { ok = false; break; }
      outcomes.push({ knife: k, wear, float, p: 1 / p.knives.length, v });
    }
    if (!ok) continue;
    const evFast = outcomes.reduce((a, o) => a + o.p * o.v.fast!, 0);
    const evPatient = outcomes.reduce((a, o) => a + o.p * (o.v.patient ?? o.v.fast!), 0);
    const costCash = N * cash.cash!;
    if (costCash > MAX_COST) continue;
    const c = { pool: p, T, cash, steam, outcomes, evFast, evPatient, costCash };
    if (!best || evFast / costCash > best.evFast / best.costCash) best = c;
  }
  if (best) contracts.push(best);
}

// One contract per knife pool: collections sharing a pool are the same bet.
const byPool = new Map<string, Contract>();
for (const c of contracts) {
  const key = c.pool.knives.map((k) => k.name).sort().join("|");
  const cur = byPool.get(key);
  if (!cur || c.evFast / c.costCash > cur.evFast / cur.costCash) byPool.set(key, c);
}
const ranked = [...byPool.values()].sort((a, b) => b.evFast / b.costCash - a.evFast / a.costCash).slice(0, TOP);

// Chance of being ahead after n contracts, exact on $1 bins.
function pAhead(c: Contract, cost: number, n: number): number {
  const vals = c.outcomes.map((o) => ({ p: o.p, v: Math.round(o.v.fast!) }));
  let dist = new Map<number, number>([[0, 1]]);
  for (let i = 0; i < n; i++) {
    const next = new Map<number, number>();
    for (const [s, ps] of dist) for (const { p, v } of vals) next.set(s + v, (next.get(s + v) ?? 0) + ps * p);
    dist = next;
  }
  let up = 0;
  for (const [s, ps] of dist) if (s > n * cost) up += ps;
  return up;
}

const market = VERIFY > 0 ? steamMarket({ gapMs: Number(arg("steam-gap") ?? 8) * 1000 }) : null;

console.log(`\nIGL-9000 · Covert ×5 → knife sweep   outcomes: Buff163 + CSFloat feeds, fee ${pct(FEE)}   Doppler phases split evenly (upper bound for rare phases)`);
console.log(`  pools ${pools.size} → contracts ${contracts.length} → distinct knife pools ${byPool.size}, top ${ranked.length} by cash-in, cash-out RTP\n`);

ranked.forEach((c, i) => {
  const rtp = c.evFast / c.costCash;
  const wins = c.outcomes.filter((o) => o.v.fast! > c.costCash);
  const pWin = wins.reduce((a, o) => a + o.p, 0);
  const top = [...c.outcomes].sort((a, b) => b.v.fast! - a.v.fast!);
  console.log(
    `${String(i + 1).padStart(2)}. ${short(c.pool.name)}   ${c.pool.knives.length} knife items   adjusted float ≤ ${c.T.toFixed(4)}` +
      `   cost ${money(c.costCash)} (cash)   EV ${money(c.evFast)} fast / ${money(c.evPatient)} patient   RTP ${(rtp * 100).toFixed(0)}% / ${((c.evPatient / c.costCash) * 100).toFixed(0)}%`,
  );
  console.log(
    `    P(profit) ${pct(pWin)}   P(ahead) after 2: ${pct(pAhead(c, c.costCash, 2))}  after 5: ${pct(pAhead(c, c.costCash, 5))}` +
      `   best ${top[0].knife.name} (${ABBR[top[0].wear]}) ${money(top[0].v.fast!)}`,
  );
  const s = c.steam;
  console.log(
    `    inputs: 5× ${c.cash.skin.name} (${ABBR[c.cash.wear]}) ${c.cash.lo.toFixed(3)}–${c.cash.cap.toFixed(3)}  cash ask ${money(c.cash.cash!)} ea` +
      (s ? `   | Steam: 5× ${s.skin.name} (${ABBR[s.wear]}) feed ${money(s.steam!)} ea → ${money(5 * s.steam!)}, ${((c.evFast / (5 * s.steam!)) * 100).toFixed(0)}% cash per Steam $` : ""),
  );
  for (const o of top.slice(0, 4)) {
    const rare = o.v.phases?.filter((ph) => !ph.phase.startsWith("Phase")).map((ph) => `${ph.phase} ${money(ph.fast ?? 0)}`).join(", ");
    console.log(`      ${pct(o.p).padStart(5)}  ${money(o.v.fast!).padStart(10)}  ${o.knife.name} (${ABBR[o.wear]} ${o.float.toFixed(4)})${rare ? `   phases avg, rare: ${rare}` : ""}`);
  }
  const rareEv = c.outcomes.reduce((a, o) => {
    const ph = o.v.phases?.filter((x) => !x.phase.startsWith("Phase")) ?? [];
    return a + o.p * ph.reduce((b, x) => b + (x.fast ?? 0), 0) / (o.v.phases?.length ?? 1);
  }, 0);
  if (rareEv > 0) console.log(`    rare Doppler phases add ${money(rareEv)} of the EV at the even split`);

  if (market && i < VERIFY && s) {
    const book = market.cheapestAtFloat(`${s.skin.name} (${s.wear})`, s.lo, s.cap, N);
    if (!book) console.log(`    live Steam: not fetched`);
    else {
      const paid = book.listings.reduce((a, l) => a + l.price, 0);
      console.log(
        `    live Steam: ${book.listings.length} of 5 under ${s.cap.toFixed(3)} for ${money(paid)}` +
          (book.listings.length === 5 ? ` → ${((c.evFast / paid) * 100).toFixed(0)}% cash per Steam $` : "  ⚠ short") +
          `   (${book.total} listed in range)`,
      );
    }
  }
  console.log("");
});
