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
// refinement. Contracts may be single-collection or MIXED (pooled across a
// tier), and either the standard x10 or the x5 Covert->knife contract.
//
// Outcomes are collapsed by (market name, wear) before weighting — see
// valueContract. Without it the catalog's seven Doppler phase rows each count as
// a separate outcome and inflate a knife contract's EV by ~2x.

import { computeTradeup, floatToWear } from "@/lib/tradeup";
import { RARITY_ORDER, WEAR_RANGES, type Rarity, type Skin, type Wear } from "@/types/cs2";
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
  size: number; // 10 (standard) or 5 (Covert -> knife/glove contract)
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
  usesOwned: number; // slots drawn from the holder's inventory (0 = pure speculation)
}

// Tiers that can be an INPUT. nextRarity returns null only for the TOP TWO tiers
// (Extraordinary, Contraband), so Covert is tradeable and leads the x5 contract.
const TRADEABLE_TIERS = new Set<Rarity>([
  "Consumer Grade",
  "Industrial Grade",
  "Mil-Spec Grade",
  "Restricted",
  "Classified",
  // Covert leads the ×5 knife contract, whose output tier is Extraordinary
  // (knives and gloves). nextRarity() has always supported it; leaving it out of
  // this set made every red in an inventory invisible to the planner.
  "Covert",
]);
const EXCLUDED_COLLECTIONS = new Set(["Limited Edition Item"]);
const STANDARD_SIZE = 10;
const KNIFE_SIZE = 5;

/** Contract size for a tier: the Covert→knife contract takes 5 inputs, every
 *  other tier takes 10. computeTradeup already accepts both and uses the actual
 *  input count as the probability denominator. */
function contractSize(tier: Rarity): number {
  return tier === "Covert" ? KNIFE_SIZE : STANDARD_SIZE;
}

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

  // Collapse catalog rows that are the same tradeable item. The catalog lists
  // each Doppler as seven skins (Phase 1-4, Ruby, Sapphire, Black Pearl) while
  // the market prices them under ONE name, so counting each row as its own
  // outcome hands Doppler ~7x the weight of a single-row finish. Group by
  // (name, wear), take the per-ROW probability of each group (they are equal by
  // construction), then renormalise — which restores one share per distinct
  // item. Exact for single-collection contracts; for mixed contracts whose
  // collections duplicate at different rates it is a close approximation.
  const groups = new Map<string, { rows: number; p: number; o: (typeof structural.outcomes)[number] }>();
  for (const o of structural.outcomes) {
    const key = `${o.skin.name}|${o.outputWear}`;
    const g = groups.get(key);
    if (g) { g.rows++; g.p += o.probability; } else { groups.set(key, { rows: 1, p: o.probability, o }); }
  }
  const perItem = [...groups.values()].map((g) => ({ o: g.o, w: g.p / g.rows }));
  const wsum = perItem.reduce((a, x) => a + x.w, 0) || 1;

  let ev = 0;
  let pricedProb = 0;
  const outcomes: ValuedOutcome[] = perItem.map(({ o, w }) => {
    const probability = w / wsum;
    const q = quote(o.skin.id, o.outputWear, isStatTrak, o.outputFloat);
    const bidNet = q ? q.bid_net : null;
    if (bidNet != null) {
      ev += probability * bidNet;
      pricedProb += probability;
    }
    return {
      skinId: o.skin.id,
      name: o.skin.name,
      probability,
      wear: o.outputWear,
      float: o.outputFloat,
      bidNet,
    };
  }).sort((a, b) => b.probability - a.probability);

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
    usesOwned: contract.slots.filter((s) => s.owned).length,
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

// Does this skin have anywhere to trade up TO — i.e. does one of its tradeable
// collections contain a next-tier, non-souvenir skin? Mirrors the eligibility
// gate in computeTradeup (lib/tradeup.ts:82). Single-collection contracts could
// rely on computeTradeup throwing, but a MIXED contract is only as good as its
// worst input: one ineligible item rejects the whole thing. So candidates are
// pre-filtered rather than built and discarded.
function hasNextTierOutput(skin: Skin, allSkins: Skin[]): boolean {
  const out = nextTier(skin.rarity.name);
  if (!out) return false;
  return skin.collections
    .filter((c) => !EXCLUDED_COLLECTIONS.has(c.name))
    .some((c) => allSkins.some((s) => s.rarity.name === out && !s.souvenir && s.collections.some((y) => y.id === c.id)));
}

function nextTier(r: Rarity): Rarity | null {
  const i = RARITY_ORDER.indexOf(r);
  if (i < 0 || i >= RARITY_ORDER.length - 2) return null;
  return RARITY_ORDER[i + 1];
}

// Cheapest buy per wear bracket. `collectionId` null means "any collection at
// this tier" — the mixed-contract case, where a completion buy may come from a
// different collection than the owned inputs (which is legal, and shifts the
// count vector; computeTradeup prices that correctly). Sorted low→high wear.
function buyMenu(
  tier: Rarity,
  collectionId: string | null,
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
  allSkins: Skin[],
): BuyOption[] {
  const menu: BuyOption[] = [];
  for (const wr of WEAR_RANGES) {
    let best: BuyOption | null = null;
    for (const skin of skinById.values()) {
      if (skin.rarity.name !== tier || skin.souvenir) continue;
      if (collectionId !== null && !skin.collections.some((c) => c.id === collectionId)) continue;
      // A bought input must itself be tradeable, or it poisons the contract.
      if (!hasNextTierOutput(skin, allSkins)) continue;
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

// Pick a buy for a steering direction. Steering chooses a WEAR BRACKET, never an
// extreme float inside one: you can place a market order for "AXIA
// (Battle-Scarred)" and fill it nine times, but nine copies at float ~0.999 are
// a scavenger hunt, and the quoted bracket price does not apply to them. So every
// bought slot is the SAME skin in the SAME condition, priced at the bracket
// midpoint — the float the quote actually describes.
//   cheap = lowest ask of any bracket;  low/high = cheapest in the lowest/highest
//   priced bracket, which is how you pull the output float down or up for real.
function pickBuy(
  menu: BuyOption[],
  mode: "cheap" | "low" | "high",
): { skinId: string; float: number; ask: number } | null {
  if (!menu.length) return null;
  const b =
    mode === "cheap"
      ? menu.reduce((a, x) => (x.ask < a.ask ? x : a))
      : mode === "low"
        ? menu[0] // lowest wear bracket present
        : menu[menu.length - 1]; // highest wear bracket present
  return { skinId: b.skinId, float: (b.min + b.max) / 2, ask: b.ask };
}

// Representative value of a collection's outputs: what one roll into C is worth
// on average, evaluated at the output float a mid-float contract produces. This
// is the number the cross-collection split ranks by.
function meanOutputValue(
  collectionId: string,
  outTier: Rarity,
  allSkins: Skin[],
  quote: PriceProvider,
  isStatTrak: boolean,
): { mean: number; k: number } {
  const outs = allSkins.filter(
    (s) => s.rarity.name === outTier && !s.souvenir && s.collections.some((c) => c.id === collectionId),
  );
  if (!outs.length) return { mean: 0, k: 0 };
  let total = 0;
  for (const o of outs) {
    const f = o.min_float + 0.5 * (o.max_float - o.min_float); // mid-float contract
    const q = quote(o.id, floatToWear(f), isStatTrak, f);
    total += q ? q.bid_net : 0;
  }
  return { mean: total / outs.length, k: outs.length };
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
  group: { tier: Rarity; collectionId: string | null; collectionName: string; owned: Holding[] },
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
  allSkins: Skin[],
): CandidateContract[] {
  const menu = buyMenu(group.tier, group.collectionId, skinById, quote, isStatTrak, allSkins);
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
    // An input with nowhere to trade up to rejects the whole contract — and in a
    // mixed contract that would waste every other slot. Drop it up front.
    if (!hasNextTierOutput(skin, allSkins)) return;
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
    const size = contractSize(group.tier);
    const chosen = picks.slice(0, size);
    const slots: ContractSlot[] = chosen.map((c) => ({
      skinId: c.h.skinId,
      float: c.h.float,
      owned: true,
    }));
    const need = size - slots.length;
    if (need > 0) {
      if (!buy) return null; // can't complete this contract
      for (let i = 0; i < need; i++) slots.push({ skinId: buy.skinId, float: buy.float, owned: false });
    }
    const mixed = group.collectionId === null;
    const distinct = mixed
      ? new Set(
          slots.flatMap((sl) => {
            const c = primaryCollection(skinById.get(sl.skinId)!);
            return c ? [c.name] : [];
          }),
        )
      : null;
    return {
      tier: group.tier,
      size,
      collectionId: group.collectionId ?? "*mixed*",
      collectionName: mixed ? `Mixed (${distinct!.size} collections)` : group.collectionName,
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

// Cross-collection split (§3.2). In a mixed contract each output of collection C
// carries probability n_C / (10 · k_C) — so the slots you give a collection ARE
// your exposure to it. One slot in a rich collection buys a tenth of its odds for
// a tenth of the inputs, which means you never need ten expensive inputs to get a
// shot at an expensive output: pad the rest with the cheapest filler you can buy
// or already own.
//
// The engine sweeps that trade-off directly: for each promising collection R,
// try every split k = 1..10 of "k slots of R, the rest filler", and let
// valueContract price it. The sweep is tiny (a few collections × 10 splits) and
// it is the only strategy that can express partial exposure — cost-floor and
// float-steering both treat every slot as interchangeable.
function buildExposureCandidates(
  tier: Rarity,
  owned: Holding[],
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
  allSkins: Skin[],
): CandidateContract[] {
  const outTier = nextTier(tier);
  if (!outTier) return [];
  const size = contractSize(tier);

  // Collections at this tier we can actually buy into, with what a roll is worth.
  const cols = new Map<string, { id: string; name: string }>();
  for (const s of skinById.values()) {
    if (s.rarity.name !== tier || s.souvenir) continue;
    if (!hasNextTierOutput(s, allSkins)) continue;
    const c = primaryCollection(s);
    if (c) cols.set(c.id, c);
  }

  const ranked = [...cols.values()]
    .map((c) => {
      const buy = pickBuy(buyMenu(tier, c.id, skinById, quote, isStatTrak, allSkins), "cheap");
      const { mean, k } = meanOutputValue(c.id, outTier, allSkins, quote, isStatTrak);
      return { c, buy, mean, k };
    })
    .filter((x) => x.buy && x.k > 0 && x.mean > 0) as {
    c: { id: string; name: string };
    buy: { skinId: string; float: number; ask: number };
    mean: number;
    k: number;
  }[];
  if (ranked.length < 2) return []; // nothing to split across

  // Richest by expected roll value; cheapest by what a slot costs to fill.
  const rich = [...ranked].sort((a, b) => b.mean - a.mean).slice(0, 3);
  const filler = [...ranked].sort((a, b) => a.buy.ask - b.buy.ask)[0];

  // Owned items usable as filler: cheaper than buying the filler, and eligible.
  const ownedFiller = owned
    .map((h) => {
      const skin = skinById.get(h.skinId);
      if (!skin || !hasNextTierOutput(skin, allSkins)) return null;
      const q = quote(h.skinId, floatToWear(h.float), isStatTrak, h.float);
      if (!q || q.bid_net > filler.buy.ask + EPS) return null;
      return { h, cost: q.bid_net };
    })
    .filter(Boolean)
    .sort((a, b) => a!.cost - b!.cost) as { h: Holding; cost: number }[];

  const out: CandidateContract[] = [];
  for (const r of rich) {
    for (let k = 1; k <= size; k++) {
      if (r.c.id === filler.c.id && k !== size) continue; // degenerate
      const slots: ContractSlot[] = [];
      for (let i = 0; i < k; i++) slots.push({ skinId: r.buy.skinId, float: r.buy.float, owned: false });
      // fill the remainder with owned items first (free exposure), then buys
      const need = size - k;
      for (let i = 0; i < need; i++) {
        const o = ownedFiller[i];
        if (o) slots.push({ skinId: o.h.skinId, float: o.h.float, owned: true });
        else slots.push({ skinId: filler.buy.skinId, float: filler.buy.float, owned: false });
      }
      const distinct = new Set(
        slots.flatMap((sl) => {
          const c = primaryCollection(skinById.get(sl.skinId)!);
          return c ? [c.name] : [];
        }),
      );
      out.push({
        tier,
        size,
        collectionId: "*split*",
        collectionName: `${k}/${size} ${r.c.name}${distinct.size > 1 ? ` + ${distinct.size - 1} more` : ""}`,
        slots,
        buys: slots.filter((sl) => !sl.owned).length,
      });
    }
  }
  return out;
}

// Cross-collection math (§3.2). Because each output of collection C carries
// probability n_C / (10 * k_C), the expected value of a mixed contract is the
// slot-weighted average of the collections' mean output values:
//
//   EV    = Σ_C (n_C / 10) · meanOut_C
//   cost  = Σ_C n_C · inputCost_C
//   delta = Σ_C n_C · [ meanOut_C / 10 − inputCost_C ]
//                      └──────── marginal value of ONE slot given to C ────────┘
//
// So for a fixed output-float regime delta is LINEAR in the slot counts: every
// collection has a constant marginal value per slot, and the optimum is simply
// to fill all ten slots with the highest-marginal sources available. No sweep,
// no search — sort by marginal and take ten.
//
// The linearity is exact only within a float regime, because the output wear (and
// so meanOut_C) depends on the average input float shared by all slots. That is
// why the ranking here is a PROPOSAL: valueContract re-prices the assembled
// contract exactly, at its real output float, and bestMove ranks on that.
//
// Owned items enter the same ranking at their opportunity cost (bid_net) and a
// quantity of one, so "burn this cheap thing I already have" and "buy exposure to
// that rich collection" compete on one scale instead of being separate rules.
interface SlotSource {
  collectionId: string;
  collectionName: string;
  skinId: string;
  float: number;
  owned: boolean;
  cost: number; // bid_net (owned) or ask (bought)
  marginal: number; // meanOut_C / 10 − cost
  available: number; // 1 for a specific owned item, Infinity for a buy
}

function buildSplitCandidates(
  tier: Rarity,
  owned: Holding[],
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  isStatTrak: boolean,
  allSkins: Skin[],
): CandidateContract[] {
  const outTier = nextTier(tier);
  if (!outTier) return [];
  const size = contractSize(tier);

  // mean output value per collection, cached
  const meanByCol = new Map<string, number>();
  const meanOf = (id: string) => {
    let m = meanByCol.get(id);
    if (m == null) {
      m = meanOutputValue(id, outTier, allSkins, quote, isStatTrak).mean;
      meanByCol.set(id, m);
    }
    return m;
  };

  const sources: SlotSource[] = [];

  // buyable source per collection (uniform condition, cheapest bracket)
  const cols = new Map<string, { id: string; name: string }>();
  for (const s of skinById.values()) {
    if (s.rarity.name !== tier || s.souvenir || !hasNextTierOutput(s, allSkins)) continue;
    const c = primaryCollection(s);
    if (c) cols.set(c.id, c);
  }
  for (const c of cols.values()) {
    const buy = pickBuy(buyMenu(tier, c.id, skinById, quote, isStatTrak, allSkins), "cheap");
    const mean = meanOf(c.id);
    if (!buy || mean <= 0) continue;
    sources.push({
      collectionId: c.id, collectionName: c.name, skinId: buy.skinId, float: buy.float,
      owned: false, cost: buy.ask, marginal: mean / size - buy.ask, available: Infinity,
    });
  }

  // each owned item is its own source, costed at what selling it would net
  for (const h of owned) {
    const skin = skinById.get(h.skinId);
    if (!skin || !hasNextTierOutput(skin, allSkins)) continue;
    const c = primaryCollection(skin);
    if (!c) continue;
    const q = quote(h.skinId, floatToWear(h.float), isStatTrak, h.float);
    if (!q) continue;
    const mean = meanOf(c.id);
    if (mean <= 0) continue;
    sources.push({
      collectionId: c.id, collectionName: c.name, skinId: h.skinId, float: h.float,
      owned: true, cost: q.bid_net, marginal: mean / size - q.bid_net, available: 1,
    });
  }
  if (!sources.length) return [];

  // Greedy fill by marginal value — the optimum of the linear program above.
  const fill = (pool: SlotSource[]): CandidateContract | null => {
    const ranked = [...pool].sort(
      (a, b) => b.marginal - a.marginal || a.cost - b.cost || (a.skinId < b.skinId ? -1 : 1),
    );
    const slots: ContractSlot[] = [];
    for (const src of ranked) {
      let n = src.available === Infinity ? size - slots.length : src.available;
      while (n-- > 0 && slots.length < size) {
        slots.push({ skinId: src.skinId, float: src.float, owned: src.owned });
      }
      if (slots.length >= size) break;
    }
    if (slots.length < size) return null;
    const names = new Set(
      slots.flatMap((sl) => {
        const c = primaryCollection(skinById.get(sl.skinId)!);
        return c ? [c.name] : [];
      }),
    );
    const lead = [...names][0] ?? "Mixed";
    return {
      tier, size, collectionId: "*split*",
      collectionName: names.size > 1 ? `${lead} + ${names.size - 1} more` : lead,
      slots, buys: slots.filter((sl) => !sl.owned).length,
    };
  };

  const out: CandidateContract[] = [];
  const best = fill(sources);
  if (best) out.push(best);
  // Same optimum restricted to contracts that actually consume something you own
  // — a pure-buy contract is speculation, not a move on your inventory.
  const ownedSources = sources.filter((s) => s.owned);
  if (ownedSources.length) {
    const forced = fill([...ownedSources.sort((a, b) => b.marginal - a.marginal).slice(0, 1), ...sources]);
    if (forced) out.push(forced);
  }
  return out;
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

  // Mixed-collection groups: one per TIER, pooling that tier's holdings across
  // every collection. CS2 allows it, and computeTradeup already prices the
  // resulting count vector correctly (n_C per collection, weight split across
  // overlaps) — so this needs no new math, only a wider candidate pool. It is
  // strictly additive: the single-collection candidates above remain, and
  // bestMove ranks all of them by the same exact delta.
  const byTier = new Map<Rarity, Holding[]>();
  for (const g of groups.values()) {
    const list = byTier.get(g.tier) ?? [];
    list.push(...g.owned);
    byTier.set(g.tier, list);
  }

  const allSkins = [...skinById.values()];
  const single = [...groups.values()].flatMap((g) =>
    buildCandidates(g, skinById, quote, isStatTrak, allSkins),
  );
  const mixed = [...byTier.entries()]
    // A tier that only ever had one collection produces the same contract twice.
    .filter(([tier]) => new Set([...groups.values()].filter((g) => g.tier === tier).map((g) => g.collectionId)).size > 1)
    .flatMap(([tier, owned]) =>
      buildCandidates(
        { tier, collectionId: null, collectionName: "Mixed", owned },
        skinById,
        quote,
        isStatTrak,
        allSkins,
      ),
    );
  const exposure = [...byTier.entries()].flatMap(([tier, owned]) =>
    buildExposureCandidates(tier, owned, skinById, quote, isStatTrak, allSkins),
  );
  const split = [...byTier.entries()].flatMap(([tier, owned]) =>
    buildSplitCandidates(tier, owned, skinById, quote, isStatTrak, allSkins),
  );
  return [...single, ...mixed, ...exposure, ...split];
}

// §3.5 — the greedy planner. Value every candidate, keep those that are
// profitable (delta > 0) and affordable (buyCost ≤ cash), return the best by
// delta. null = no positive move (the honest "just sell" answer).
// `minOwned` is how many of the ten slots must come from the holder's own
// inventory. It matters because a contract that buys all ten slots is not a
// trade-up of anything you own — it is a cash bet on a collection, and since
// pure-buy contracts face no opportunity cost they tend to post the highest raw
// delta and crowd out every real move. Default 1: answer the question actually
// being asked ("what should I do with MY skins?"). Pass 0 to include pure
// speculation, and read the plays it returns for what they are.
export function bestMove(
  holdings: Holding[],
  skinById: Map<string, Skin>,
  quote: PriceProvider,
  cash: number,
  isStatTrak: boolean,
  minOwned = 1,
): ValuedContract | null {
  const candidates = enumerateContracts(holdings, skinById, quote, isStatTrak);
  let best: ValuedContract | null = null;
  for (const c of candidates) {
    const v = valueContract(c, skinById, quote, isStatTrak);
    if (!v) continue;
    if (v.usesOwned < minOwned) continue;
    if (v.buyCost > cash) continue;
    if (v.delta <= 0) continue;
    if (!best || v.delta > best.delta) best = v;
  }
  return best;
}
