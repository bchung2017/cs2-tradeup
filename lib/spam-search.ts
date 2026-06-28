// Spam Trade-Up finder (market-wide). Generalizes the "elsu" method: fill most
// slots with the CHEAPEST exterior whose float cap can't blow past the target,
// then use a few low-float "steering" inputs to pull the 10-input average to the
// target wear — so the output reliably lands where the jackpot is valuable. Then
// you spam it.
//
// Nothing is hardcoded to Well-Worn / Field-Tested: the solver is parameterized
// by a TARGET average normalized float. "WW filler + FT steering" is just what
// falls out when you target Field-Tested; target a different wear and it derives
// different fillers. Pure module — reuses computeTradeup as the scoring kernel.
import { computeTradeup, floatToWear, nextRarity } from "@/lib/tradeup";
import { WEAR_RANGES, type PriceTable, type Rarity, type Skin, type Wear } from "@/types/cs2";

const N = 10;
export const DEFAULT_FEE = 0.15;
const EPS = 0.001;

// Float ceilings we cache CSFloat "cheapest under X" prices at (see scripts/
// sync-floatprices + lib/csfloat). The solver prices a steering slot at the
// largest tier ≤ its required float ceiling.
export const FLOAT_TIERS = [0.1, 0.14, 0.18, 0.22, 0.26, 0.3, 0.34, 0.38];
function tierFor(ceiling: number): number | null {
  let t: number | null = null;
  for (const x of FLOAT_TIERS) if (x <= ceiling + EPS) t = x; else break;
  return t;
}

const wearMid = (w: Wear) => {
  const r = WEAR_RANGES.find((x) => x.wear === w)!;
  return (r.min + r.max) / 2;
};
const wearMax = (w: Wear) => WEAR_RANGES.find((x) => x.wear === w)!.max;
const norm = (f: number, min: number, max: number) => (max <= min ? 0 : Math.min(1, Math.max(0, (f - min) / (max - min))));
const denorm = (nf: number, min: number, max: number) => min + nf * (max - min);

/** Default target = land the output just inside Field-Tested (cheapest FT). */
export function targetForWear(w: Wear = "Field-Tested"): number {
  return Math.max(0, wearMax(w) - 0.01);
}

export interface SpamRecipe {
  fillerWear: Wear; // cheapest exterior used to bulk-fill (cap does the work)
  fillerCount: number; // how many filler slots
  fillerSkin: { id: string; name: string; price: number | null };
  steerWear: Wear; // exterior the steering slots are sniped at
  steerCount: number;
  steerFloatCeiling: number; // max float to snipe the steering inputs under
  steerSkin: { id: string; name: string; price: number | null };
}

export interface SpamOutcome {
  name: string;
  image?: string | null;
  wear: Wear;
  probability: number;
  netPrice: number | null; // after-fee sell value at the rolled wear
}

export interface SpamContract {
  id: string;
  collection: { id: string; name: string };
  inputRarity: Rarity;
  outputRarity: Rarity;
  stattrak: boolean;
  recipe: SpamRecipe;
  perRunCost: number; // gross input cost for one run
  outcomes: SpamOutcome[]; // sorted by value desc
  jackpot: { name: string; netPrice: number; probability: number } | null;
  pProfit: number; // chance a single run clears cost
  netEV: number; // expected net payout − cost (per run)
  // repeated-play economics
  runsToHitMedian: number; // median spams until first jackpot
  stake90: number; // bankroll to be ~90% sure of landing ≥1 jackpot
}

export interface SpamArgs {
  skinById: Map<string, Skin>;
  prices: PriceTable;
  fee?: number;
  targetAvgFloat?: number; // the configurable knob (default = Field-Tested)
  limit?: number;
  // CSFloat float-indexed steering prices, keyed `${skinId}|${tag}|${tier}` —
  // when present, the solver prices steering slots from real sub-float listings.
  floatPrices?: Record<string, number>;
}

/** cheapest median (+ the skin) among a pool at a given wear/tag. */
function cheapestAt(pool: Skin[], wear: Wear, tag: string, prices: PriceTable) {
  let best: { skin: Skin; price: number } | null = null;
  for (const s of pool) {
    const p = prices[`${s.id}|${wear}|${tag}`]?.median;
    if (p != null && (best == null || p < best.price)) best = { skin: s, price: p };
  }
  return best;
}

/** Cheapest steering input under a float ceiling. Uses CSFloat float-indexed
 *  prices when available (the largest cached tier ≤ ceiling); else the flat
 *  wear-bucket median as a proxy. */
function cheapestSteer(
  pool: Skin[], steerFloat: number, steerWear: Wear, tag: string,
  prices: PriceTable, floatPrices?: Record<string, number>,
) {
  if (floatPrices) {
    const tier = tierFor(steerFloat);
    if (tier != null) {
      let best: { skin: Skin; price: number } | null = null;
      for (const s of pool) {
        const p = floatPrices[`${s.id}|${tag}|${tier}`];
        if (p != null && (best == null || p < best.price)) best = { skin: s, price: p };
      }
      if (best) return best;
    }
  }
  return cheapestAt(pool, steerWear, tag, prices);
}

export function findSpamTradeups(args: SpamArgs): SpamContract[] {
  const { skinById, prices } = args;
  const fee = args.fee ?? DEFAULT_FEE;
  const net = 1 - fee;
  const A = args.targetAvgFloat ?? targetForWear("Field-Tested");
  const limit = args.limit ?? 40;
  const all = [...skinById.values()];

  // group skins by collection id
  const byColl = new Map<string, { name: string; skins: Skin[] }>();
  for (const s of all) for (const c of s.collections ?? []) {
    const b = byColl.get(c.id) ?? { name: c.name, skins: [] };
    b.skins.push(s);
    byColl.set(c.id, b);
  }

  const out: SpamContract[] = [];

  for (const [collId, { name, skins }] of byColl) {
    // rarities present in this collection
    const rarities = new Set(skins.map((s) => s.rarity.name));
    for (const inputRarity of rarities) {
      const outputRarity = nextRarity(inputRarity);
      if (!outputRarity || outputRarity === "Extraordinary") continue; // skip knife tier
      const inputs = skins.filter((s) => s.rarity.name === inputRarity && !s.souvenir);
      const outputs = skins.filter((s) => s.rarity.name === outputRarity && !s.souvenir);
      if (inputs.length === 0 || outputs.length === 0) continue;

      for (const tag of ["norm", "st"] as const) {
        const recipe = solveRecipe(inputs, A, tag, prices, args.floatPrices);
        if (!recipe) continue;
        const scored = scoreRun(recipe, collId, name, inputRarity, outputRarity, tag, skinById, prices, net);
        if (scored) out.push(scored);
      }
    }
  }

  // confident-ish first, then by netEV (grind) — caller re-sorts per mode
  return out.sort((a, b) => b.netEV - a.netEV).slice(0, limit);
}

/** Derive the cheapest filler-exterior + steering split that guarantees avg ≤ A. */
function solveRecipe(inputs: Skin[], A: number, tag: string, prices: PriceTable, floatPrices?: Record<string, number>): SpamRecipe | null {
  // representative float range (use the median-range skin; most CS2 skins are 0–1)
  const rep = inputs[0];
  const repNorm = (f: number) => norm(f, rep.min_float, rep.max_float);

  let best: { recipe: SpamRecipe; cost: number } | null = null;

  // try each exterior as the cheap bulk filler
  for (const fw of WEAR_RANGES) {
    const filler = cheapestAt(inputs, fw.wear, tag, prices);
    if (!filler) continue;
    const nf = repNorm(wearMid(fw.wear)); // expected filler normalized float

    // sweep how many steering slots b we use
    for (let b = 1; b < N; b++) {
      const a = N - b;
      // need (a*nf + b*nc) / N ≤ A  →  nc ≤ ncMax
      const ncMax = (A * N - a * nf) / b;
      if (ncMax <= 0 || ncMax >= nf) continue; // infeasible or steering not lower-float than filler
      const steerFloat = denorm(ncMax, rep.min_float, rep.max_float);
      const steerWear = floatToWear(steerFloat);
      const steer = cheapestSteer(inputs, steerFloat, steerWear, tag, prices, floatPrices);
      if (!steer) continue;
      const cost = a * filler.price + b * steer.price;
      if (best == null || cost < best.cost) {
        best = {
          cost,
          recipe: {
            fillerWear: fw.wear, fillerCount: a,
            fillerSkin: { id: filler.skin.id, name: filler.skin.name, price: filler.price },
            steerWear, steerCount: b, steerFloatCeiling: steerFloat,
            steerSkin: { id: steer.skin.id, name: steer.skin.name, price: steer.price },
          },
        };
      }
    }
  }
  return best?.recipe ?? null;
}

function scoreRun(
  recipe: SpamRecipe, collId: string, collName: string,
  inputRarity: Rarity, outputRarity: Rarity, tag: string,
  skinById: Map<string, Skin>, prices: PriceTable, net: number,
): SpamContract | null {
  const stattrak = tag === "st";
  const fillerSkin = skinById.get(recipe.fillerSkin.id)!;
  const steerSkin = skinById.get(recipe.steerSkin.id)!;
  const tradeInputs = [
    ...Array.from({ length: recipe.fillerCount }, () => ({ skinId: fillerSkin.id, float: wearMid(recipe.fillerWear) })),
    ...Array.from({ length: recipe.steerCount }, () => ({ skinId: steerSkin.id, float: recipe.steerFloatCeiling })),
  ];
  let result;
  try {
    result = computeTradeup({ inputs: tradeInputs, skinById, prices, isStatTrak: stattrak });
  } catch {
    return null;
  }

  const perRunCost = (recipe.fillerSkin.price ?? 0) * recipe.fillerCount + (recipe.steerSkin.price ?? 0) * recipe.steerCount;
  const outcomes: SpamOutcome[] = result.outcomes.map((o) => ({
    name: o.skin.name,
    image: o.skin.image ?? null,
    wear: o.outputWear,
    probability: o.probability,
    netPrice: o.estimatedPrice == null ? null : o.estimatedPrice * net,
  })).sort((a, b) => (b.netPrice ?? -1) - (a.netPrice ?? -1));

  let pProfit = 0, netEV = 0;
  for (const o of outcomes) {
    if (o.netPrice == null) continue;
    netEV += o.probability * o.netPrice;
    if (o.netPrice > perRunCost) pProfit += o.probability;
  }
  netEV -= perRunCost;

  const top = outcomes.find((o) => o.netPrice != null) ?? null;
  const jackpot = top && top.netPrice != null ? { name: top.name, netPrice: top.netPrice, probability: top.probability } : null;
  const jp = jackpot?.probability ?? 0;
  const runsToHitMedian = jp > 0 ? Math.log(0.5) / Math.log(1 - jp) : Infinity;
  const stake90 = jp > 0 ? Math.ceil(Math.log(0.1) / Math.log(1 - jp)) * perRunCost : Infinity;

  return {
    id: `spam|${collId}|${inputRarity}|${tag}`,
    collection: { id: collId, name: collName },
    inputRarity, outputRarity, stattrak,
    recipe, perRunCost, outcomes, jackpot, pProfit, netEV,
    runsToHitMedian, stake90,
  };
}
