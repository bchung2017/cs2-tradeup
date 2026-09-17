// IGL-9000 — the engine core (valuation + input-assignment + single-hop planner).
//
// One deterministic engine, parameterized by a PriceProvider (the only live
// input). Implements the bottom of the pipeline from
// context/igl9000-engine-spec.md:
//   §3.2 enumerate candidate contracts  (structural, no prices) — now includes
//        input ASSIGNMENT: which owned items to commit + which floats to buy, so
//        the output float is steered toward the best-value wear bracket.
//   §3.3 odds / output floats           (reuses computeTradeup)
//   §3.4 value a contract -> signed delta   (the only `quote` caller)
//   §3.5 best_move (single hop)         (greedy argmax over positive-delta, affordable)
//
// Assignment model (§3.2, "assign_skins"): input SELECTION is a real lever,
// because the output float — hence the output wear, hence the payout — is the
// average of the inputs' normalized floats. Two rules:
//   • Don't burn value: an owned item is worth consuming only if its bid_net is
//     ≤ the cheapest completion ask; otherwise you'd sell it and buy a filler.
//   • Steer the float: prefer inputs (owned picks + bought floats) that push the
//     average into the highest-value output wear bracket.
// Selection is a BOUNDED candidate search (cost-floor / steer-low / steer-high);
// valuation via computeTradeup + quote is EXACT, and bestMove ranks candidates
// by that exact delta — so the ranking is correct even though the generator is
// heuristic. A provably-optimal min-cost-hits-a-float-bracket solver is a future
// refinement. Still v1 elsewhere: single-collection contracts, standard ×10.

import { computeTradeup, floatToWear } from "@/lib/tradeup";
import { WEAR_RANGES, type Rarity, type Skin, type Wear } from "@/types/cs2";
import type { PriceProvider } from "@/lib/igl9000-quote";

const EPS = 1e-9;

/** Normalize a float into [0,1] on the skin's own min/max range (mirrors the
 *  private helper in tradeup.ts — output float is the mean of these). */
function normalizeFloat(f: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (f - min) / (max - min)));
}


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
    const q = quote(o.skin.id, o.outputWear, isStatTrak, o.outputFloat);
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
    const q = quote(s.skinId, floatToWear(s.float), isStatTrak, s.float);
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

// A way to complete a contract: buy a specific catalog skin in a specific wear
// bracket, at that bracket's cheapest ask, choosing any float within it. One
// entry per priced wear bracket present in the tier+collection → the steering
// menu (buy low-wear to pull the average down, high-wear to push it up).
interface BuyOption {
  skinId: string;
  wear: Wear;
  min: number; // bracket float range — the float is ours to choose within it
  max: number;
  ask: number;
}

// Cheapest buy per wear bracket for a tier+collection. Sorted low→high wear.
function buyMenu(
  tier: Rarity,
  collectionId: string,
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
): BuyOption[] {
  const menu: BuyOption[] = [];
  for (const wr of WEAR_RANGES) {
    let best: BuyOption | null = null;
    for (const skin of skinById.values()) {
      if (skin.rarity.name !== tier || skin.souvenir) continue;
      if (!skin.collections.some((c) => c.id === collectionId)) continue;
      // Menu prices the bracket at its midpoint — a representative float for
      // *selection*. The exact float's cost is recomputed in valueContract,
      // which stays the source of truth.
      const q = quote(skin.id, wr.wear, isStatTrak, (wr.min + wr.max) / 2);
      if (!q) continue;
      if (!best || q.ask < best.ask || (q.ask === best.ask && skin.id < best.skinId)) {
        best = { skinId: skin.id, wear: wr.wear, min: wr.min, max: wr.max, ask: q.ask };
      }
    }
    if (best) menu.push(best);
  }
  return menu;
}

// Pick a buy for a steering direction. "cheap" = lowest ask (bracket mid float);
// "low"/"high" = the cheapest option in the lowest/highest priced wear bracket,
// bought at that bracket's edge to move the average as far as it goes.
function pickBuy(
  menu: BuyOption[],
  mode: "cheap" | "low" | "high",
): { skinId: string; float: number; ask: number } | null {
  if (!menu.length) return null;
  if (mode === "cheap") {
    const b = menu.reduce((a, x) => (x.ask < a.ask ? x : a));
    return { skinId: b.skinId, float: (b.min + b.max) / 2, ask: b.ask };
  }
  if (mode === "low") {
    const b = menu[0]; // lowest wear bracket present
    return { skinId: b.skinId, float: b.min, ask: b.ask };
  }
  const b = menu[menu.length - 1]; // highest wear bracket present
  return { skinId: b.skinId, float: Math.max(b.min, b.max - EPS), ask: b.ask };
}

interface Consumable {
  h: Holding;
  cost: number; // bid_net — opportunity cost of consuming it
  norm: number; // normalized float — what it contributes to the output-float average
  idx: number; // original position, for stable tie-breaks
}

// Build the candidate contracts for one (tier, collection) group. Applies the
// two assignment rules: exclude owned items too valuable to burn (bid_net above
// the cheapest ask), then generate cost-floor / steer-low / steer-high variants.
// All are valued exactly downstream; bestMove keeps the best.
function buildCandidates(
  group: { tier: Rarity; collectionId: string; collectionName: string; owned: Holding[] },
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
): CandidateContract[] {
  const menu = buyMenu(group.tier, group.collectionId, skinById, quote, isStatTrak);
  const buyCheap = pickBuy(menu, "cheap");
  const buyLow = pickBuy(menu, "low");
  const buyHigh = pickBuy(menu, "high");
  const buyFloorAsk = buyCheap ? buyCheap.ask : Infinity;

  // Owned items worth consuming: priced, and bid_net ≤ the cheapest filler ask.
  // Anything pricier is kept (sell it, buy a filler instead of burning it).
  const consumable: Consumable[] = [];
  group.owned.forEach((h, idx) => {
    const skin = skinById.get(h.skinId);
    if (!skin) return;
    const q = quote(h.skinId, floatToWear(h.float), isStatTrak, h.float);
    if (!q) return;
    if (q.bid_net > buyFloorAsk + EPS) return; // too valuable to burn
    consumable.push({ h, cost: q.bid_net, norm: normalizeFloat(h.float, skin.min_float, skin.max_float), idx });
  });
  if (!consumable.length) return []; // nothing worth seeding a contract with

  const assemble = (
    picks: Consumable[],
    buy: { skinId: string; float: number } | null,
  ): CandidateContract | null => {
    const chosen = picks.slice(0, STANDARD_SIZE);
    const slots: ContractSlot[] = chosen.map((c) => ({
      skinId: c.h.skinId,
      float: c.h.float,
      owned: true,
    }));
    const need = STANDARD_SIZE - slots.length;
    if (need > 0) {
      if (!buy) return null; // can't complete this contract
      for (let i = 0; i < need; i++) slots.push({ skinId: buy.skinId, float: buy.float, owned: false });
    }
    return {
      tier: group.tier,
      size: STANDARD_SIZE,
      collectionId: group.collectionId,
      collectionName: group.collectionName,
      slots,
      buys: need > 0 ? need : 0,
    };
  };

  // Three selection orders. With >10 consumable, these pick different owned tens
  // (cost-floor vs. lowest-float vs. highest-float); with <10 they share the
  // same owned set and differ only by the buy variant (float tuning).
  const byCost = [...consumable].sort((a, b) => a.cost - b.cost || a.norm - b.norm || a.idx - b.idx);
  const byNormAsc = [...consumable].sort((a, b) => a.norm - b.norm || a.cost - b.cost || a.idx - b.idx);
  const byNormDesc = [...consumable].sort((a, b) => b.norm - a.norm || a.cost - b.cost || a.idx - b.idx);

  const candidates = [
    assemble(byCost, buyCheap), // cost-floor
    assemble(byNormAsc, buyLow ?? buyCheap), // steer output float down
    assemble(byNormDesc, buyHigh ?? buyCheap), // steer output float up
  ];
  return candidates.filter((c): c is CandidateContract => c !== null);
}

// §3.2 — enumerate candidate contracts from holdings. Groups owned items by
// (tier, collection), then emits several assignment-optimized candidates per
// group (see buildCandidates). A group whose collection has no next-tier output
// stays in — valueContract() rejects it via computeTradeup, the single
// eligibility authority.
export function enumerateContracts(
  holdings: Holding[],
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
): CandidateContract[] {
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

  return [...groups.values()].flatMap((g) => buildCandidates(g, skinById, quote, isStatTrak));
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
