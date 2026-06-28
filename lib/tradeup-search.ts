// v1 trade-up search — given a resolved inventory, rank the contracts you can
// build from it by P(net profit): the probability that the one skin the contract
// rolls clears what you'd net selling the inputs instead.
//
// Produces three things (all in types/research.ts, the shared UI seam):
//  - single-collection contracts (10 of one collection)
//  - mixed-collection contracts (10 of one rarity across collections) — lower odds
//    from dilution, but real and runnable; surfaced when no single one is possible
//  - near-misses: collections you're a few items short of, as a what-to-collect guide
//
// Pure module: it takes catalog + prices as args and reuses computeTradeup as the
// scoring kernel, so it has no fs/steam/network deps and is unit-testable.
//
// Design notes that matter for reading the numbers:
// - Cost semantics are SELL-VALUE: inputCost = (Σ input medians) × (1−fee), i.e.
//   what you'd take home selling the inputs. A contract "profits" only when trading
//   up beats that baseline — the only honest comparison for items you already own.
//   Output payouts are likewise netted by (1−fee).
// - computeTradeup splits an input's weight across its collections per the real
//   rules, so a mixed contract's outcome distribution stays correct.
import {
  EXCLUDED_COLLECTIONS,
  computeTradeup,
  floatToWear,
  nextRarity,
} from "@/lib/tradeup";
import type {
  PriceTable,
  Rarity,
  Skin,
  TradeupInput,
  Wear,
} from "@/types/cs2";
import type {
  ResearchBuyInPoint,
  ResearchContract,
  ResearchInput,
  ResearchNearMiss,
  ResearchOutcome,
} from "@/types/research";

export const DEFAULT_FEE = 0.15; // Steam sell fee; override per marketplace
const CONTRACT_SIZE = 10; // standard contract; 5-input knife case is a v1 follow-up
const DEFAULT_LIMIT = 25;
const NEARMISS_LIMIT = 16;
const NEARMISS_MIN_HAVE = 1; // show collections you own at least this many of

// RED PILL detection: a contract has "the One" when some outcome lands rarely
// (≤ this probability) yet pays a big multiple of cost (≥ this multiple). These
// usually score low on P(profit) — you lose most rolls — so the default ranking
// buries them; the dedicated mode surfaces them.
const THE_ONE_MAX_PROB = 0.15;
const THE_ONE_MIN_MULTIPLE = 5;
const THE_ONE_LIMIT = 12; // keep this many past the normal cut so they aren't lost

const WEARS: Wear[] = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
];

// Representative float per wear (range midpoint) — seeds a hypothetical bought
// input so the assembled contract's average float (→ output wear) is realistic.
const WEAR_MID: Record<Wear, number> = {
  "Factory New": 0.035,
  "Minimal Wear": 0.11,
  "Field-Tested": 0.265,
  "Well-Worn": 0.415,
  "Battle-Scarred": 0.725,
};

/** One inventory item already resolved to a catalog skin (souvenirs pre-filtered). */
export interface OwnedItem {
  assetid: string;
  skin: Skin;
  float: number; // actual per-item float (required to seed a contract)
  isStatTrak: boolean;
}

type Strategy = ResearchContract["strategy"]; // "cheapest" | "lowest-float"

export interface SearchArgs {
  owned: OwnedItem[];
  skinById: Map<string, Skin>;
  prices: PriceTable;
  fee?: number;
  limit?: number;
}

export interface SearchResult {
  contracts: ResearchContract[];
  nearMisses: ResearchNearMiss[];
}

const norm = (f: number, min: number, max: number) =>
  max <= min ? 0 : Math.min(1, Math.max(0, (f - min) / (max - min)));

/** Reconstruct a market-style name ("StatTrak™ Weapon | Paint (Wear)") so the UI
 *  can display it and PriceModal can resolve it the same way inventory names do. */
function marketName(skin: Skin, wear: Wear, stattrak: boolean): string {
  return `${stattrak ? "StatTrak™ " : ""}${baseName(skin)} (${wear})`;
}
/** Wear-less display name ("StatTrak™ Weapon | Paint") for near-miss reward pools. */
function displayName(skin: Skin, stattrak: boolean): string {
  return `${stattrak ? "StatTrak™ " : ""}${baseName(skin)}`;
}
function baseName(skin: Skin): string {
  // Catalog names already include the weapon ("AK-47 | Redline") — use as-is.
  return skin.name;
}

function inputMedian(item: OwnedItem, prices: PriceTable): number | null {
  const wear = floatToWear(item.float);
  const key = `${item.skin.id}|${wear}|${item.isStatTrak ? "st" : "norm"}`;
  return prices[key]?.median ?? null;
}

/** Best (highest) net price across wears for an output skin — its reward ceiling
 *  when we don't yet know the contract's average float. */
function bestNet(skinId: string, stattrak: boolean, prices: PriceTable, net: number): number | null {
  const tag = stattrak ? "st" : "norm";
  let best: number | null = null;
  for (const w of WEARS) {
    const m = prices[`${skinId}|${w}|${tag}`]?.median;
    if (m != null && (best == null || m > best)) best = m;
  }
  return best == null ? null : best * net;
}

/** Pick CONTRACT_SIZE items from a pool under the given strategy. */
function selectInputs(pool: OwnedItem[], strategy: Strategy, prices: PriceTable): OwnedItem[] {
  const sorted = [...pool];
  if (strategy === "cheapest") {
    // sacrifice the least-valuable items; unpriced items sort last (unknown value)
    sorted.sort(
      (a, b) => (inputMedian(a, prices) ?? Infinity) - (inputMedian(b, prices) ?? Infinity),
    );
  } else {
    // lowest average float → best output wear → usually higher payout
    sorted.sort(
      (a, b) =>
        norm(a.float, a.skin.min_float, a.skin.max_float) -
        norm(b.float, b.skin.min_float, b.skin.max_float),
    );
  }
  return sorted.slice(0, CONTRACT_SIZE);
}

export function searchTradeups(args: SearchArgs): SearchResult {
  const { owned, skinById, prices } = args;
  const fee = args.fee ?? DEFAULT_FEE;
  const limit = args.limit ?? DEFAULT_LIMIT;
  const net = 1 - fee;
  const allSkins = [...skinById.values()];

  // memoized: the output-rarity skins a collection contains (drives both the
  // eligibility gate and near-miss reward pools).
  const outputCache = new Map<string, Skin[]>();
  const outputSkins = (collectionId: string, outputRarity: Rarity): Skin[] => {
    const k = `${collectionId}|${outputRarity}`;
    const hit = outputCache.get(k);
    if (hit) return hit;
    const list = allSkins.filter(
      (s) =>
        s.rarity.name === outputRarity &&
        !s.souvenir &&
        s.collections.some((c) => c.id === collectionId),
    );
    outputCache.set(k, list);
    return list;
  };
  const hasOutput = (collectionId: string, outputRarity: Rarity) =>
    outputSkins(collectionId, outputRarity).length > 0;

  // memoized: the input-rarity skins in a collection — the universe you'd BUY from
  // to fill a candidate's remaining slots. Drives the buy-in floor/ceiling.
  const inputCache = new Map<string, Skin[]>();
  const inputSkinsFor = (collectionId: string, inputRarity: Rarity): Skin[] => {
    const k = `${collectionId}|${inputRarity}`;
    const hit = inputCache.get(k);
    if (hit) return hit;
    const list = allSkins.filter(
      (s) =>
        s.rarity.name === inputRarity &&
        !s.souvenir &&
        s.collections.some((c) => c.id === collectionId),
    );
    inputCache.set(k, list);
    return list;
  };

  // gross min/max median across all (skin, wear) in a pool — the per-item buy-in
  // band, plus WHICH item is cheapest/priciest so the UI can name them.
  const priceBand = (skins: Skin[], stattrak: boolean) => {
    const t = stattrak ? "st" : "norm";
    let min: number | null = null;
    let max: number | null = null;
    let minName: string | null = null;
    let maxName: string | null = null;
    for (const s of skins) {
      for (const w of WEARS) {
        const m = prices[`${s.id}|${w}|${t}`]?.median;
        if (m == null) continue;
        if (min == null || m < min) { min = m; minName = marketName(s, w, stattrak); }
        if (max == null || m > max) { max = m; maxName = marketName(s, w, stattrak); }
      }
    }
    return { min, max, minName, maxName };
  };

  // eligible (non-excluded, output-bearing) collection ids for an item
  const eligCols = (item: OwnedItem, outputRarity: Rarity): string[] =>
    item.skin.collections
      .filter((c) => !EXCLUDED_COLLECTIONS.has(c.name) && hasOutput(c.id, outputRarity))
      .map((c) => c.id);

  // Partition by (rarity, StatTrak): only like combines with like.
  const partitions = new Map<string, OwnedItem[]>();
  for (const item of owned) {
    const key = `${item.skin.rarity.name}|${item.isStatTrak ? "st" : "norm"}`;
    (partitions.get(key) ?? partitions.set(key, []).get(key)!).push(item);
  }

  const bestByKey = new Map<string, ResearchContract>(); // dedupe: keep better strategy
  const nearMisses: ResearchNearMiss[] = [];

  for (const part of partitions.values()) {
    const inputRarity = part[0].skin.rarity.name;
    const outputRarity = nextRarity(inputRarity);
    if (!outputRarity) continue; // top tiers can't be traded up
    // v1 handles the standard 10-input contract only. Covert→Extraordinary is the
    // 5-input KNIFE contract (a deliberate follow-up): skip it so we don't report a
    // wrong "need N/10" for Covert, or surface duplicate-named knife outputs (the
    // Doppler phases share one display name).
    if (outputRarity === "Extraordinary") continue;
    const isStatTrak = part[0].isStatTrak;
    const tag = isStatTrak ? "st" : "norm";

    // group items by each eligible collection
    const byCollection = new Map<string, { name: string; items: OwnedItem[] }>();
    for (const item of part) {
      for (const cid of eligCols(item, outputRarity)) {
        const cname = item.skin.collections.find((c) => c.id === cid)!.name;
        const bucket = byCollection.get(cid) ?? { name: cname, items: [] };
        bucket.items.push(item);
        byCollection.set(cid, bucket);
      }
    }

    // (a) single-collection contracts + (b) near-misses
    for (const [collectionId, { name, items }] of byCollection) {
      if (items.length >= CONTRACT_SIZE) {
        addBestStrategy(bestByKey, `${collectionId}|${inputRarity}|${tag}`, (strategy) =>
          scoreContract({
            chosen: selectInputs(items, strategy, prices),
            skinById, prices, fee, isStatTrak, strategy, kind: "single",
            collectionId, collectionName: name, inputRarity, outputRarity,
          }),
        );
      } else if (items.length >= NEARMISS_MIN_HAVE) {
        // OUTCOMES you could roll — the possible output skins, compared to each
        // other (small winner → big winner by value), each with its picture.
        // Collapse same-named variants (phases, etc.) to their best price.
        // Realistic outcome value: price each output at the wear your EXISTING items'
        // average float would actually roll — NOT the Factory-New/best-wear ceiling,
        // which is misleading because your items aren't all low-float.
        const avgNorm =
          items.reduce((acc, it) => acc + norm(it.float, it.skin.min_float, it.skin.max_float), 0) /
          items.length;
        const byOut = new Map<string, { netPrice: number | null; image?: string | null }>();
        for (const s of outputSkins(collectionId, outputRarity)) {
          const nm = displayName(s, isStatTrak);
          const outFloat = s.min_float + avgNorm * (s.max_float - s.min_float);
          const m = prices[`${s.id}|${floatToWear(outFloat)}|${tag}`]?.median;
          const p = m == null ? null : m * net;
          const cur = byOut.get(nm);
          if (cur === undefined || (p ?? -1) > (cur.netPrice ?? -1)) byOut.set(nm, { netPrice: p, image: s.image ?? null });
        }
        const outputs = [...byOut.entries()]
          .map(([name, v]) => ({ name, image: v.image, netPrice: v.netPrice }))
          .sort((a, b) => (b.netPrice ?? -1) - (a.netPrice ?? -1));

        // WHAT TO BUY — the input skins in this collection you could acquire to fill
        // the remaining slots, each with its picture + cheapest gross price.
        // JACKPOT fillers: pick each skin's LOWEST-FLOAT priced wear. Low input
        // float pushes the completed roll toward top wear → the high-value outputs
        // (the jackpot) actually land. The cheapest (Battle-Scarred) listing is the
        // worst choice for this, so we take the best-wear price instead.
        const tBuy = new Map<string, { price: number | null; image?: string | null; wear: Wear; float: number }>();
        for (const s of inputSkinsFor(collectionId, inputRarity)) {
          const nm = displayName(s, isStatTrak);
          let pick: { price: number; wear: Wear } | null = null;
          for (const w of WEARS) { // FN..BS = low→high float; first priced = lowest float
            const m = prices[`${s.id}|${w}|${tag}`]?.median;
            if (m != null) { pick = { price: m, wear: w }; break; }
          }
          const opt = pick
            ? { price: pick.price, image: s.image ?? null, wear: pick.wear, float: WEAR_MID[pick.wear] }
            : { price: null, image: s.image ?? null, wear: "Battle-Scarred" as Wear, float: WEAR_MID["Battle-Scarred"] };
          const cur = tBuy.get(nm);
          if (cur === undefined) tBuy.set(nm, opt);
          else if (pick != null && (cur.price == null || pick.price < cur.price)) tBuy.set(nm, opt);
        }
        const toBuy = [...tBuy.entries()]
          .map(([name, v]) => ({ name, image: v.image, price: v.price, wear: v.wear, float: v.float }))
          .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        // the items you already own toward this contract — so the inspector can
        // show you WHAT you have, not just how many.
        const ownedToward = items.map((it) => {
          const w = floatToWear(it.float);
          const entry = prices[`${it.skin.id}|${w}|${tag}`];
          return {
            assetid: it.assetid,
            name: marketName(it.skin, w, isStatTrak),
            image: it.skin.image ?? null,
            float: it.float,
            wear: w,
            price: entry?.median ?? null,
            priceSources: entry?.sources ?? null,
          };
        });
        // buy-in band to finish: cheapest vs priciest filler × how many you need.
        const need = CONTRACT_SIZE - items.length;
        const fillerSkins = inputSkinsFor(collectionId, inputRarity);
        const filler = priceBand(fillerSkins, isStatTrak);
        const perItemFloor = filler.min;
        const perItemCeiling = filler.max;
        // the jackpot roll (most valuable output) and the wear-driven payout band it
        // spans: cheap high-float fillers skew the roll toward worse wear, pricey
        // low-float fillers toward best wear — so a higher buy-in can unlock a much
        // bigger top hit.
        let jackpot: Skin | null = null;
        let jackpotMax = -1;
        for (const s of outputSkins(collectionId, outputRarity)) {
          const b = bestNet(s.id, isStatTrak, prices, net);
          if (b != null && b > jackpotMax) { jackpotMax = b; jackpot = s; }
        }
        const jband = jackpot ? priceBand([jackpot], isStatTrak) : { min: null, max: null };

        // multi-point buy-in→payout curve: one point per wear tier. Pairs the
        // cheapest filler at that wear (×need, gross) with the top output priced at
        // that wear (net), so the whole tradeoff is visible, not just the two ends.
        const curve: ResearchBuyInPoint[] = [];
        if (jackpot) {
          for (const w of WEARS) {
            let fmin: number | null = null;
            let fname = "";
            for (const s of fillerSkins) {
              const m = prices[`${s.id}|${w}|${tag}`]?.median;
              if (m != null && (fmin == null || m < fmin)) {
                fmin = m;
                fname = marketName(s, w, isStatTrak);
              }
            }
            const pay = prices[`${jackpot.id}|${w}|${tag}`]?.median;
            if (fmin != null && pay != null) {
              curve.push({
                wear: w,
                buyIn: fmin * need,
                payout: pay * net,
                fillerName: fname,
                outputName: marketName(jackpot, w, isStatTrak),
              });
            }
          }
          curve.sort((a, b) => a.buyIn - b.buyIn);
        }

        const buyIn = {
          perItemFloor,
          perItemCeiling,
          floor: perItemFloor == null ? null : perItemFloor * need,
          ceiling: perItemCeiling == null ? null : perItemCeiling * need,
          floorItem: filler.minName, // cheapest filler skin@wear
          ceilingItem: filler.maxName, // priciest filler skin@wear
          payoutFloor: jband.min == null ? null : jband.min * net,
          payoutCeiling: jband.max == null ? null : jband.max * net,
          topName: jackpot ? displayName(jackpot, isStatTrak) : null, // the top-payout output skin
          curve,
        };
        nearMisses.push({
          id: `near|${collectionId}|${inputRarity}|${tag}`,
          collection: { id: collectionId, name },
          inputRarity, outputRarity, stattrak: isStatTrak,
          have: items.length, need, buyIn,
          items: ownedToward, outputs, toBuy,
        });
      }
    }

    // (c) mixed-collection contract: 10 across the whole partition. Only meaningful
    // when ≥2 collections are represented (else it's just a single contract).
    const pool = part.filter((it) => eligCols(it, outputRarity).length > 0);
    if (pool.length >= CONTRACT_SIZE) {
      addBestStrategy(bestByKey, `mixed|${inputRarity}|${tag}`, (strategy) => {
        const chosen = selectInputs(pool, strategy, prices);
        const distinct = new Set(chosen.flatMap((it) => eligCols(it, outputRarity)));
        if (distinct.size < 2) throw new Error("not mixed"); // effectively single — skip
        return scoreContract({
          chosen, skinById, prices, fee, isStatTrak, strategy, kind: "mixed",
          collectionId: `mixed|${inputRarity}|${tag}`,
          collectionName: `Mixed · ${distinct.size} collections`,
          inputRarity, outputRarity,
        });
      });
    }
  }

  const ranked = [...bestByKey.values()].sort(cmp);
  const top = ranked.slice(0, limit);
  // Keep the best "the One" contracts past the normal cut — they rank low on
  // P(profit) by design, so RED PILL mode would otherwise have nothing to show.
  const seen = new Set(top.map((c) => c.id));
  const redPill = ranked
    .filter((c) => c.theOne && !seen.has(c.id))
    .sort((a, b) => b.theOne!.multiple - a.theOne!.multiple)
    .slice(0, THE_ONE_LIMIT);
  const contracts = [...top, ...redPill];
  nearMisses.sort(
    (a, b) => b.have - a.have || (b.outputs[0]?.netPrice ?? -1) - (a.outputs[0]?.netPrice ?? -1),
  );
  return { contracts, nearMisses: nearMisses.slice(0, NEARMISS_LIMIT) };
}

/** Run both strategies for a dedupe key, keep the better-ranked (failed builds skip). */
function addBestStrategy(
  into: Map<string, ResearchContract>,
  key: string,
  build: (s: Strategy) => ResearchContract,
): void {
  for (const strategy of ["cheapest", "lowest-float"] as Strategy[]) {
    let c: ResearchContract;
    try {
      c = build(strategy);
    } catch {
      continue;
    }
    const prev = into.get(key);
    if (!prev || beats(c, prev)) into.set(key, c);
  }
}

interface ScoreArgs {
  chosen: OwnedItem[];
  skinById: Map<string, Skin>;
  prices: PriceTable;
  isStatTrak: boolean;
  fee: number;
  collectionId: string;
  collectionName: string;
  inputRarity: Rarity;
  outputRarity: Rarity;
  strategy: Strategy;
  kind: ResearchContract["kind"];
}

function scoreContract(a: ScoreArgs): ResearchContract {
  const tradeupInputs: TradeupInput[] = a.chosen.map((it) => ({
    skinId: it.skin.id,
    float: it.float,
  }));
  const result = computeTradeup({
    inputs: tradeupInputs,
    skinById: a.skinById,
    prices: a.prices,
    isStatTrak: a.isStatTrak,
  });

  const net = 1 - a.fee;
  const inputCost = result.inputCost * net; // result.inputCost = Σ input medians (gross)

  const outcomes: ResearchOutcome[] = result.outcomes.map((o) => ({
    skin: o.skin,
    wear: o.outputWear,
    probability: o.probability,
    netPrice: o.estimatedPrice == null ? null : o.estimatedPrice * net,
    priceSources: o.priceSources ?? null,
  }));

  let pProfit = 0;
  let netEV = 0;
  let pricedProb = 0;
  let best: ResearchContract["best"] = null;
  let worst: ResearchContract["worst"] = null;

  for (const o of outcomes) {
    if (o.netPrice == null) continue;
    pricedProb += o.probability;
    netEV += o.probability * o.netPrice;
    if (o.netPrice > inputCost) pProfit += o.probability;

    const brief = { name: marketName(o.skin, o.wear, a.isStatTrak), wear: o.wear, netPrice: o.netPrice };
    if (!best || o.netPrice > best.netPrice) best = brief;
    if (!worst || o.netPrice < worst.netPrice) worst = brief;
  }

  // RED PILL: the rarest big-multiple hit — low odds, high payout. The default
  // P(profit) ranking hides these (they usually lose), so flag the biggest dream.
  let theOne: ResearchContract["theOne"] = null;
  if (inputCost > 0) {
    for (const o of outcomes) {
      if (o.netPrice == null || o.probability > THE_ONE_MAX_PROB) continue;
      const multiple = o.netPrice / inputCost;
      if (multiple < THE_ONE_MIN_MULTIPLE) continue;
      if (!theOne || multiple > theOne.multiple) {
        theOne = {
          name: marketName(o.skin, o.wear, a.isStatTrak),
          wear: o.wear,
          probability: o.probability,
          netPrice: o.netPrice,
          multiple,
        };
      }
    }
  }

  // exact items, rich enough for the UI to render + stage into the simulator
  const inputs: ResearchInput[] = a.chosen.map((it) => {
    const wear = floatToWear(it.float);
    const entry = a.prices[`${it.skin.id}|${wear}|${a.isStatTrak ? "st" : "norm"}`];
    return {
      assetid: it.assetid,
      skin: it.skin,
      name: marketName(it.skin, wear, a.isStatTrak),
      float: it.float,
      wear,
      stattrak: a.isStatTrak,
      price: entry?.median ?? null,
      priceSources: entry?.sources ?? null,
    };
  });
  const pricedInputs = inputs.filter((i) => i.price != null).length;

  return {
    id: `${a.collectionId}|${a.inputRarity}|${a.strategy}|${a.isStatTrak ? "st" : "norm"}`,
    kind: a.kind,
    inputRarity: a.inputRarity,
    outputRarity: a.outputRarity,
    collection: { id: a.collectionId, name: a.collectionName },
    stattrak: a.isStatTrak,
    strategy: a.strategy,
    inputCost,
    netEV,
    pProfit,
    best,
    worst,
    theOne,
    confidence: { pricedInputs, inputCount: inputs.length, pricedProb },
    inputs,
    outcomes,
  };
}

// Ranking order: confident (fully-priced) candidates first, then P(profit), then
// net profit EV. Both derived from the seam fields so no extra bookkeeping leaks
// into the response shape.
function confident(c: ResearchContract): boolean {
  return c.confidence.pricedInputs === c.confidence.inputCount && c.confidence.pricedProb >= 0.999;
}
function rankKey(c: ResearchContract): [number, number, number] {
  return [confident(c) ? 1 : 0, c.pProfit, c.netEV - c.inputCost];
}
function cmp(a: ResearchContract, b: ResearchContract): number {
  const ka = rankKey(a);
  const kb = rankKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
  return 0;
}
function beats(a: ResearchContract, b: ResearchContract): boolean {
  return cmp(a, b) < 0; // a sorts before b
}
