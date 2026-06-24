import {
  RARITY_ORDER,
  WEAR_RANGES,
  type PriceTable,
  type Rarity,
  type Skin,
  type TradeupInput,
  type TradeupOutcome,
  type TradeupResult,
  type Wear,
} from "@/types/cs2";

export function nextRarity(r: Rarity): Rarity | null {
  const i = RARITY_ORDER.indexOf(r);
  if (i < 0 || i >= RARITY_ORDER.length - 2) return null; // no trade-up out of the top two tiers (Extraordinary/Contraband)
  return RARITY_ORDER[i + 1];
}

export function floatToWear(f: number): Wear {
  for (const r of WEAR_RANGES) {
    if (f >= r.min && f < r.max) return r.wear;
  }
  return "Battle-Scarred";
}

/** Normalize a float into [0,1] given the source skin's min/max range. */
function normalizeFloat(f: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (f - min) / (max - min)));
}

/** Map normalized [0,1] back onto an output skin's range. */
function denormalizeFloat(n: number, min: number, max: number): number {
  return min + n * (max - min);
}

export interface ComputeArgs {
  inputs: TradeupInput[];
  skinById: Map<string, Skin>;
  prices: PriceTable;
  isStatTrak: boolean;
}

// Catch-all pseudo-collection the catalog dumps standalone/promo skins into
// (e.g. AK-47 | Aphrodite, Desert Eagle | Heat Treated). It isn't a real
// tradeable collection — its members span mixed rarities and share no theme —
// so it must not seed trade-up inputs or outputs, or a Classified input would
// roll the lone Covert in the bucket. Excluded from the algorithm entirely.
const EXCLUDED_COLLECTIONS = new Set(["Limited Edition Item"]);

export function computeTradeup(args: ComputeArgs): TradeupResult {
  const { inputs, skinById, prices, isStatTrak } = args;
  const warnings: string[] = [];

  // Standard contracts take 10 inputs; the knife contract takes 5. The math is
  // identical — probabilities use the actual input count as the denominator.
  const N = inputs.length;
  if (N !== 10 && N !== 5) {
    throw new Error(`Trade-up requires 10 (standard) or 5 (knife) inputs, got ${N}`);
  }

  const inputSkins = inputs.map((i) => {
    const s = skinById.get(i.skinId);
    if (!s) throw new Error(`Unknown skin id: ${i.skinId}`);
    return { input: i, skin: s };
  });

  // Validate same rarity
  const rarities = new Set(inputSkins.map((x) => x.skin.rarity.name));
  if (rarities.size > 1) {
    throw new Error(`All inputs must be the same rarity. Found: ${[...rarities].join(", ")}`);
  }
  const inputRarity = inputSkins[0].skin.rarity.name;

  const outputRarity = nextRarity(inputRarity);
  if (!outputRarity) {
    throw new Error(`No trade-up possible out of rarity "${inputRarity}".`);
  }

  // Average normalized float across all inputs (each normalized to its own skin range).
  const avgNormalized =
    inputSkins.reduce(
      (acc, { input, skin }) => acc + normalizeFloat(input.float, skin.min_float, skin.max_float),
      0,
    ) / inputSkins.length;

  // Count inputs per collection. A skin can map to multiple collections; split its weight evenly.
  const nByCollection = new Map<string, number>();
  const collMeta = new Map<string, string>();
  for (const { skin } of inputSkins) {
    const cols = skin.collections.filter((c) => !EXCLUDED_COLLECTIONS.has(c.name));
    if (!cols.length) {
      warnings.push(
        skin.collections.length
          ? `Skin "${skin.name}" isn't part of a tradeable collection; it cannot contribute outputs.`
          : `Skin "${skin.name}" has no collection; it cannot contribute outputs.`,
      );
      continue;
    }
    const share = 1 / cols.length;
    for (const c of cols) {
      nByCollection.set(c.id, (nByCollection.get(c.id) ?? 0) + share);
      collMeta.set(c.id, c.name);
    }
  }

  // Build outcomes per collection: each output skin gets prob n_C / (N * k_C).
  const allSkins = [...skinById.values()];
  const outcomes: TradeupOutcome[] = [];

  for (const [collectionId, nC] of nByCollection) {
    const candidates = allSkins.filter(
      (s) =>
        s.rarity.name === outputRarity &&
        !s.souvenir &&
        s.collections.some((c) => c.id === collectionId),
    );
    if (!candidates.length) {
      const collName = collMeta.get(collectionId) ?? collectionId;
      warnings.push(
        `Collection "${collName}" has no ${outputRarity} outputs (max-tier collection); contributing inputs are burned.`,
      );
      continue;
    }
    const kC = candidates.length;
    const probPerSkin = nC / (N * kC);
    for (const out of candidates) {
      const outFloat = denormalizeFloat(avgNormalized, out.min_float, out.max_float);
      const wear = floatToWear(outFloat);
      const priceKey = `${out.id}|${wear}|${isStatTrak ? "st" : "norm"}`;
      const priceEntry = prices[priceKey];
      outcomes.push({
        skin: out,
        probability: probPerSkin,
        outputFloat: outFloat,
        outputWear: wear,
        estimatedPrice: priceEntry?.median ?? null,
        priceSources: priceEntry?.sources ?? null,
      });
    }
  }

  // Merge duplicate outcomes (same skin appearing via overlapping collections)
  const merged = new Map<string, TradeupOutcome>();
  for (const o of outcomes) {
    const key = `${o.skin.id}|${o.outputWear}`;
    const existing = merged.get(key);
    if (existing) {
      existing.probability += o.probability;
    } else {
      merged.set(key, { ...o });
    }
  }
  const mergedOutcomes = [...merged.values()].sort((a, b) => b.probability - a.probability);

  // Input cost: sum of estimated prices for input skin@wear@stattrak
  let inputCost = 0;
  let pricedInputs = 0;
  for (const { input, skin } of inputSkins) {
    const wear = floatToWear(input.float);
    const key = `${skin.id}|${wear}|${isStatTrak ? "st" : "norm"}`;
    const p = prices[key]?.median;
    if (p != null) {
      inputCost += p;
      pricedInputs++;
    }
  }
  if (pricedInputs < N) {
    warnings.push(`Only ${pricedInputs}/${N} inputs had price data; input cost is a lower bound.`);
  }

  // EV = sum(prob * price) over outcomes with price data
  let expectedValue = 0;
  let pricedProb = 0;
  for (const o of mergedOutcomes) {
    if (o.estimatedPrice != null) {
      expectedValue += o.probability * o.estimatedPrice;
      pricedProb += o.probability;
    }
  }
  if (pricedProb < 0.999) {
    warnings.push(
      `Only ${(pricedProb * 100).toFixed(1)}% of outcome probability has price data; the average payout is a lower bound.`,
    );
  }

  return {
    outcomes: mergedOutcomes,
    inputCost,
    expectedValue,
    profitEV: expectedValue - inputCost,
    inputRarity,
    outputRarity,
    isStatTrak,
    warnings,
  };
}
