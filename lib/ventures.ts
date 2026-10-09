/**
 * Ventures: trade-up contracts found by the IGL-9000 sweeps, in one shape for the
 * Venture surface. Written by scripts/igl9000-ventures.ts into
 *   public/data/ventures.json            market ventures (sweep + knife), full detail
 *   public/data/ventures-longlist.json   knife contracts indexed by the red you own
 *   public/data/ventures-expired.json    contracts that dropped out, for a "gone" badge
 * Read-only on the site: Steam rate limits rule out pricing per page view.
 */

export type VentureSource = "sweep" | "knife";
export type Venue = "steam" | "cash";
// holds: pays back more than it costs at live sale prices
// paper: only through outcomes nobody bought in 24h
// dead: costs more than it pays back at live prices
// unverified: some live price wasn't fetched
// short: Steam has fewer listings under a float cap than the contract needs
// model: priced from feeds only, no live check
export type Verdict = "holds" | "paper" | "dead" | "unverified" | "short" | "model";

export interface VentureInput {
  skin: string;
  skinId: string;
  collection: string;
  rarity: string;
  wear: string;
  count: number;
  floatMin: number; // buy at or above (bottom of the grade or the skin's own minimum)
  floatMax: number; // buy at or under (the cap)
  priceEach: number | null; // what one costs, by `basis`
  basis: "steam-listings" | "steam-feed" | "cash-ask";
  listed: number | null; // listings Steam has in [floatMin, floatMax]
}

export interface VentureOutcome {
  name: string; // "★ Karambit | Doppler"
  skinId: string;
  collection: string;
  rarity: string;
  probability: number;
  float: number;
  wear: string;
  skinMin: number; // the outcome skin's own float range, for the float bar
  skinMax: number;
  value: number | null; // what selling it nets (live when checked, else model)
  checked: boolean; // value is a live price
  sold24h: number | null;
  win: boolean; // sells for more than the contract cost, and has sold
  rarePhases?: { phase: string; value: number | null }[];
}

export interface Venture {
  key: string;
  source: VentureSource;
  tier: string;
  outputTier: string;
  size: number; // 10, or 5 for Covert → knife
  collections: string[];
  venue: Venue;
  inputs: VentureInput[];
  outcomes: VentureOutcome[];
  float: {
    adjusted: number; // mean normalized input float
    sum: number; // Σ normalized floats over the inputs
    max: number; // Σ before the first outcome changes wear
    firstChange: string | null; // the outcome that changes wear first
  };
  cost: number;
  value: number; // average sale value of one pull
  valuePatient: number | null; // at the lowest ask instead of the top buy order (knives)
  backPerDollar: number; // value / cost
  pProfit: number; // chance one pull sells for more than the cost
  pAhead: { n: number; p: number }[]; // chance of being ahead after n contracts
  best: { name: string; wear: string; value: number; probability: number };
  rareShare: number | null; // share of `value` from rare Doppler phases at the even split
  verdict: Verdict;
  warnings: string[];
  verifiedAt: string | null;
  firstSeenAt: string;
  sources: string[];
}

export interface LonglistRow {
  key: string;
  owned: string;
  ownedWear: string;
  ownedCount: number;
  ownedValue: number; // what selling one nets
  filler: string;
  fillerWear: string;
  fillerCount: number;
  fillerAsk: number;
  pools: string[];
  knifeItems: number;
  adjustedFloat: number;
  cost: number;
  value: number;
  valuePatient: number;
  backPerDollar: number;
  pProfit: number;
  p1k: number; // chance of an outcome worth $1,000 or more
  top: { name: string; probability: number; value: number }[];
  firstSeenAt: string;
}

// Some outcome sells for more than the contract costs, however unlikely or
// slow to sell. Contracts where every outcome loses are dropped from the surface.
export const canProfit = (v: Venture) => v.outcomes.some((o) => (o.value ?? 0) > v.cost);
export const rowCanProfit = (r: LonglistRow) => (r.top[0]?.value ?? 0) > r.cost;

// Longlist outcome names carry the wear ("★ Karambit | Fade (FN)"); catalog
// pictures are keyed by the bare skin name.
export const prizeKey = (name: string) => name.replace(/ \([^)]+\)$/, "");
// The top few outcomes by value, for the best-rolls pictures.
export const topOutcomes = (v: Venture, n = 3) => [...v.outcomes].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, n);

export interface VenturesFile {
  generatedAt: string;
  ventures: Venture[];
}
export interface LonglistFile {
  generatedAt: string;
  rows: LonglistRow[];
}
export interface ExpiredFile {
  rows: { key: string; title: string; firstSeenAt: string; expiredAt: string; backPerDollar: number }[];
}

// Same contract, same key, run to run: tier, then each input group sorted.
export function ventureKey(tier: string, inputs: { skinId: string; wear: string; count: number; floatMax: number }[]): string {
  const parts = inputs.map((i) => `${i.count}x${i.skinId}@${i.wear}<=${i.floatMax.toFixed(3)}`).sort();
  return `${tier}|${parts.join("+")}`;
}

// Chance the sum of n pulls beats n × cost, exact on $1 bins.
export function pAhead(outcomes: { p: number; v: number }[], cost: number, ns = [1, 2, 5]): { n: number; p: number }[] {
  const vals = outcomes.filter((o) => o.p > 0).map((o) => ({ p: o.p, v: Math.round(o.v) }));
  const out: { n: number; p: number }[] = [];
  let dist = new Map<number, number>([[0, 1]]);
  for (let n = 1; n <= Math.max(...ns); n++) {
    const next = new Map<number, number>();
    for (const [s, ps] of dist) for (const { p, v } of vals) next.set(s + v, (next.get(s + v) ?? 0) + ps * p);
    dist = next;
    if (ns.includes(n)) {
      let up = 0;
      for (const [s, ps] of dist) if (s > n * cost) up += ps;
      out.push({ n, p: up });
    }
  }
  return out;
}
