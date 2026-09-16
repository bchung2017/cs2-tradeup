// IGL-9000 — the engine core (slice 1: valuation + single-hop planner).
//
// One deterministic engine, parameterized by a PriceProvider (the only live
// input). This slice implements the bottom of the pipeline from
// context/igl9000-engine-spec.md:
//   §3.2 enumerate candidate contracts  (structural, no prices)
//   §3.3 odds / output floats           (reuses computeTradeup)
//   §3.4 value a contract -> signed delta   (the only `quote` caller)
//   §3.5 best_move (single hop)         (greedy argmax over positive-delta, affordable)
//
// The chain rollout (JourneySim / Monte-Carlo) and the Route assembly are later
// slices; this layer is what they'll call.
//
// Simplifications flagged as v1 (single-collection contracts, no float steering,
// standard ×10 only) — each is a local extension, not a re-architecture.

import { computeTradeup, floatToWear } from "@/lib/tradeup";
import { WEAR_RANGES, type Rarity, type Skin } from "@/types/cs2";
import type { PriceProvider } from "@/lib/igl9000-quote";

// A normalized inventory item.
export interface Holding {
  skinId: string;
  float: number;
  stattrak: boolean;
  unlockAt?: number; // epoch ms; 0/undefined = tradeable now (trade locks: later slice)
}

// One of the 10 contract inputs. `owned` picks the valuation side: an owned slot
// costs its sell-now baseline (bid_net, opportunity cost); a bought slot costs
// the completion ask.
export interface ContractSlot {
  skinId: string;
  float: number;
  owned: boolean;
}

// A structural contract — produced without touching prices.
export interface CandidateContract {
  tier: Rarity;
  size: number; // 10 (standard). ×5 knife contract: later slice.
  collectionId: string;
  collectionName: string;
  slots: ContractSlot[];
  buys: number; // slots with owned === false
}

export interface ValuedOutcome {
  skinId: string;
  name: string;
  probability: number;
  wear: string;
  float: number;
  bidNet: number | null; // null = unpriced (lower-bounds the EV)
}

// A contract with money attached. `delta` is the ranking key (§3.4).
export interface ValuedContract {
  contract: CandidateContract;
  outcomes: ValuedOutcome[];
  outputRarity: Rarity;
  ev: number; // Σ p · bid_net over priced outcomes
  cost: number; // Σ slot cost (owned → bid_net, bought → ask)
  delta: number; // ev − cost
  buyCost: number; // Σ ask over bought slots — what you must spend now
  pricedProb: number; // fraction of outcome probability that was priced
  approx: boolean; // some outcome/slot unpriced → ev/cost are bounds
}

// Tiers that can be an INPUT (nextRarity returns null for the top two tiers, so
// Covert/Contraband/Extraordinary can't lead a contract).
const TRADEABLE_TIERS = new Set<Rarity>([
  "Consumer Grade",
  "Industrial Grade",
  "Mil-Spec Grade",
  "Restricted",
  "Classified",
]);
const EXCLUDED_COLLECTIONS = new Set(["Limited Edition Item"]);
const STANDARD_SIZE = 10;

// The skin's first real (tradeable, non-excluded) collection. v1 treats a skin
// as belonging to one collection; mixed-collection contracts are a later slice.
function primaryCollection(skin: Skin): { id: string; name: string } | null {
  const c = skin.collections.find((x) => !EXCLUDED_COLLECTIONS.has(x.name));
  return c ? { id: c.id, name: c.name } : null;
}

// §3.4 — value a structural contract. Odds/floats come from computeTradeup run
// price-free (prices: {}); money comes from `quote`, keeping ask (buys) and
// bid_net (sells/owned) separate. Returns null when computeTradeup rejects the
// contract (ineligible inputs, mixed rarity) — i.e. it isn't a real candidate.
export function valueContract(
  contract: CandidateContract,
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
): ValuedContract | null {
  let structural;
  try {
    structural = computeTradeup({
      inputs: contract.slots.map((s) => ({ skinId: s.skinId, float: s.float })),
      skinById,
      prices: {}, // price-free: we only want odds + output floats here
      isStatTrak,
    });
  } catch {
    return null; // ineligible / mixed rarity → not a candidate
  }

  let ev = 0;
  let pricedProb = 0;
  const outcomes: ValuedOutcome[] = structural.outcomes.map((o) => {
    const q = quote(o.skin.id, o.outputWear, isStatTrak);
    const bidNet = q ? q.bid_net : null;
    if (bidNet != null) {
      ev += o.probability * bidNet;
      pricedProb += o.probability;
    }
    return {
      skinId: o.skin.id,
      name: o.skin.name,
      probability: o.probability,
      wear: o.outputWear,
      float: o.outputFloat,
      bidNet,
    };
  });

  let cost = 0;
  let buyCost = 0;
  let pricedSlots = 0;
  for (const s of contract.slots) {
    const q = quote(s.skinId, floatToWear(s.float), isStatTrak);
    if (!q) continue;
    pricedSlots++;
    cost += s.owned ? q.bid_net : q.ask;
    if (!s.owned) buyCost += q.ask;
  }

  return {
    contract,
    outcomes,
    outputRarity: structural.outputRarity,
    ev,
    cost,
    delta: ev - cost,
    buyCost,
    pricedProb,
    approx: pricedProb < 0.999 || pricedSlots < contract.slots.length,
  };
}

// Cheapest catalog skin of a given tier+collection to BUY, and the wear/float to
// buy it at (v1: cheapest priced wear; float = that wear's bracket midpoint).
// Returns null when nothing in that tier+collection is priced.
function cheapestBuy(
  tier: Rarity,
  collectionId: string,
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
): { skinId: string; float: number } | null {
  let best: { skinId: string; float: number; ask: number } | null = null;
  for (const skin of skinById.values()) {
    if (skin.rarity.name !== tier || skin.souvenir) continue;
    if (!skin.collections.some((c) => c.id === collectionId)) continue;
    for (const wr of WEAR_RANGES) {
      const q = quote(skin.id, wr.wear, isStatTrak);
      if (!q) continue;
      if (!best || q.ask < best.ask) {
        best = { skinId: skin.id, float: (wr.min + wr.max) / 2, ask: q.ask };
      }
    }
  }
  return best ? { skinId: best.skinId, float: best.float } : null;
}

// §3.2 — enumerate candidate contracts from holdings. v1: one contract per
// (tier, collection) group that has ≥1 owned item; owned fill first, any
// shortfall is completed with the cheapest same-tier/collection buy. A group
// whose collection has no next-tier output is left in — valueContract() will
// reject it via computeTradeup, which is the single eligibility authority.
export function enumerateContracts(
  holdings: Holding[],
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
): CandidateContract[] {
  // group owned holdings by `${tier}|${collectionId}`
  const groups = new Map<
    string,
    { tier: Rarity; collectionId: string; collectionName: string; owned: Holding[] }
  >();
  for (const h of holdings) {
    if (h.stattrak !== isStatTrak) continue; // contract is stattrak-uniform
    const skin = skinById.get(h.skinId);
    if (!skin || !TRADEABLE_TIERS.has(skin.rarity.name)) continue;
    const col = primaryCollection(skin);
    if (!col) continue;
    const key = `${skin.rarity.name}|${col.id}`;
    const g =
      groups.get(key) ??
      { tier: skin.rarity.name, collectionId: col.id, collectionName: col.name, owned: [] };
    g.owned.push(h);
    groups.set(key, g);
  }

  const contracts: CandidateContract[] = [];
  for (const g of groups.values()) {
    const slots: ContractSlot[] = g.owned
      .slice(0, STANDARD_SIZE)
      .map((h) => ({ skinId: h.skinId, float: h.float, owned: true }));

    if (slots.length < STANDARD_SIZE) {
      const buy = cheapestBuy(g.tier, g.collectionId, skinById, quote, isStatTrak);
      if (!buy) continue; // can't complete this contract at any price → drop it
      while (slots.length < STANDARD_SIZE) {
        slots.push({ skinId: buy.skinId, float: buy.float, owned: false });
      }
    }

    contracts.push({
      tier: g.tier,
      size: STANDARD_SIZE,
      collectionId: g.collectionId,
      collectionName: g.collectionName,
      slots,
      buys: slots.filter((s) => !s.owned).length,
    });
  }
  return contracts;
}

// §3.5 — the greedy planner. Value every candidate, keep those that are
// profitable (delta > 0) and affordable (buyCost ≤ cash), return the best by
// delta. null = no positive move (the honest "just sell" answer).
export function bestMove(
  holdings: Holding[],
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  cash: number,
  isStatTrak: boolean,
): ValuedContract | null {
  const candidates = enumerateContracts(holdings, skinById, quote, isStatTrak);
  let best: ValuedContract | null = null;
  for (const c of candidates) {
    const v = valueContract(c, skinById, quote, isStatTrak);
    if (!v) continue;
    if (v.buyCost > cash) continue;
    if (v.delta <= 0) continue;
    if (!best || v.delta > best.delta) best = v;
  }
  return best;
}
