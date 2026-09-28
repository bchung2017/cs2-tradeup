// IGL-9000 — the gambling objective.
//
// `delta` (and `bestMove`) answer "does this contract make money". The honest
// answer across this market is no: inputs are priced ABOVE the EV of their
// output at every tier we measured (~69c returned per dollar at the x10 tier,
// ~93c at the Covert->knife tier). So ranking by delta in a market with no
// positive delta ranks by LEAST NEGATIVE, which selects the most boring
// available bet — a contract with one narrow outcome and no upside.
//
// That is the wrong question for a player who is going to gamble regardless.
// Gamblers do not maximise EV; they systematically pay a premium for positive
// SKEW — the documented longshot bias in pari-mutuel betting and lottery play.
// A bet is attractive to them when a large multiple is reachable, the downside
// is bounded, and the house's cut on the way there is small.
//
// This module scores contracts on that objective instead, and always reports
// the rake next to the thrill, because the rake is the price of the thrill and
// it is the number nobody publishes. Everything here is derived from the
// outcome distribution a ValuedContract already carries, so it needs no new
// price data.
//
// Two features make trade-ups genuinely different from opening a case, and both
// are first-class here:
//   * A FLOOR. The losing outcome is still a skin worth something, so you
//     recover part of the stake on a miss (`floorRatio`). Case opening floors at
//     near zero.
//   * A KNOWN, FIXED odds table. The probabilities are arithmetic from the
//     collection, not a hidden server-side weight.
//
// See context/igl9000-engine-spec.md; this is the sibling of igl9000-risk.ts.

import type { ValuedContract } from "@/lib/igl9000-engine";

export interface GambleProfile {
  // ── the price of the gamble ────────────────────────────────────────────────
  /** Return to player: expected value back per dollar staked. 0.93 = 93c. */
  rtp: number;
  /** House edge, 1 − rtp. The rake. Negative means a genuinely +EV contract. */
  rake: number;

  // ── the thrill ─────────────────────────────────────────────────────────────
  /** Best outcome's net proceeds ÷ cost. The number a player actually chases. */
  topMultiple: number;
  /** Name of that outcome, so the bet is legible ("...| Karambit"). */
  topName: string;
  /** q — probability of a payout ≥ jackpotMultiple × cost. */
  jackpotOdds: number;
  /** 1-in-N form of q, for reading. */
  oneIn: number | null;
  /** Share of the stake that comes back as JACKPOT money: q·J ÷ cost. This is
   *  the part of the RTP that is exciting rather than consolation. */
  dreamShare: number;
  /** Standardised third moment of the profit distribution. The academic answer
   *  to "attractive but not +EV": positive skew is what gamblers overpay for. */
  skew: number;

  // ── the downside ───────────────────────────────────────────────────────────
  /** Worst outcome's proceeds ÷ cost. What you keep when you lose. */
  floorRatio: number;
  /** Probability any single pull returns more than it cost. */
  hitRate: number;
  /** Cash burned per pull while NOT hitting the jackpot: cost − E[proceeds | miss]. */
  bleed: number;
  /** ln2/q — pulls at which hitting becomes more likely than not. */
  pullsToCoinflip: number | null;
  /** bleed × pullsToCoinflip — realistic spend to reach even odds of a hit. */
  chaseCost: number | null;

  // ── ranking ────────────────────────────────────────────────────────────────
  /** dreamShare ÷ rake — jackpot exposure bought per dollar of house edge.
   *  Infinity when rake ≤ 0 (then rank on delta, not here). */
  score: number;
  /** `score` recomputed with the top outcome's price shocked −30%. The top
   *  outcome is the single price a thin-market scrape is most likely to have
   *  wrong, and it is exactly the one this metric leans on — so the shocked
   *  figure is the one to rank by. (The guard that killed ten phantom edges.) */
  robustScore: number;
  /** False when the best outcome had no usable quote — the profile is then
   *  built on a truncated distribution and must not be ranked. */
  topPriced: boolean;
  /** False when a −30% haircut on the top outcome drops it below the jackpot
   *  bar, collapsing robustScore to 0. That is not a bug in the metric, it is
   *  the verdict: a "2.4× jackpot" that a routine price error erases was never a
   *  jackpot. Distinguishes "fragile dream" from "no dream". */
  dreamSurvivesShock: boolean;
}

export interface GambleOptions {
  /** Payout multiple that counts as "hitting". Default 2× the stake — below
   *  that a player does not experience a win, they experience a refund. */
  jackpotMultiple?: number;
  /** Haircut applied to the top outcome for `robustScore`. Default 0.30. */
  topShock?: number;
}

const EPS = 1e-9;

export function gambleProfile(v: ValuedContract, opts: GambleOptions = {}): GambleProfile {
  const jackpotMultiple = opts.jackpotMultiple ?? 2;
  const topShock = opts.topShock ?? 0.3;

  const empty: GambleProfile = {
    rtp: 0, rake: 1, topMultiple: 0, topName: "", jackpotOdds: 0, oneIn: null,
    dreamShare: 0, skew: 0, floorRatio: 0, hitRate: 0, bleed: v.cost,
    pullsToCoinflip: null, chaseCost: null, score: 0, robustScore: 0, topPriced: false,
    dreamSurvivesShock: false,
  };
  if (!(v.cost > 0)) return empty;

  const priced = v.outcomes.filter((o) => o.bidNet != null);
  const mass = priced.reduce((a, o) => a + o.probability, 0);
  if (!priced.length || mass <= 0) return empty;

  // The unpriced outcomes are dropped and the rest renormalised, exactly as in
  // igl9000-risk.ts. That makes every ratio below conditional on "the outcome
  // was one we could price" — honest, but it is why `approx` contracts get a
  // caveat rather than a rank.
  const rows = priced.map((o) => ({
    name: o.name,
    wear: o.wear,
    p: o.probability / mass,
    gross: o.bidNet as number,
  }));

  // An unpriced outcome has no value we can bound, so we cannot know whether it
  // sat above or below the rows we did price. For a metric that leans entirely
  // on the top of the distribution, a hole anywhere in the tail makes the whole
  // profile unrankable — so demand a fully priced contract rather than guess.
  // (`delta` can tolerate holes because they only lower-bound it; a MULTIPLE
  // cannot be bounded that way at all.)
  const bestPricedGross = Math.max(...rows.map((r) => r.gross));
  const topPriced = priced.length === v.outcomes.length;

  const build = (shockTop: boolean) => {
    const rs = rows.map((r) =>
      shockTop && r.gross === bestPricedGross ? { ...r, gross: r.gross * (1 - topShock) } : r,
    );
    const rtp = rs.reduce((a, r) => a + r.p * r.gross, 0) / v.cost;
    const rake = 1 - rtp;
    const bar = jackpotMultiple * v.cost;
    const jack = rs.filter((r) => r.gross >= bar);
    const q = jack.reduce((a, r) => a + r.p, 0);
    const jMean = q > 0 ? jack.reduce((a, r) => a + r.p * r.gross, 0) / q : 0;
    const dreamShare = (q * jMean) / v.cost;
    const score = rake > EPS ? dreamShare / rake : Infinity;
    return { rtp, rake, q, jMean, dreamShare, score, rs };
  };

  const base = build(false);
  const shocked = build(true);

  // Shape of the profit distribution (unshocked).
  const profits = base.rs.map((r) => ({ p: r.p, x: r.gross - v.cost }));
  const mu = profits.reduce((a, o) => a + o.p * o.x, 0);
  const m2 = profits.reduce((a, o) => a + o.p * (o.x - mu) ** 2, 0);
  const m3 = profits.reduce((a, o) => a + o.p * (o.x - mu) ** 3, 0);
  const sd = Math.sqrt(m2);
  const skew = sd > EPS ? m3 / sd ** 3 : 0;

  const top = base.rs.reduce((a, r) => (r.gross > a.gross ? r : a));
  const floor = Math.min(...base.rs.map((r) => r.gross));
  const hitRate = base.rs.filter((r) => r.gross > v.cost).reduce((a, r) => a + r.p, 0);

  // Bleed is the cost of a pull that did NOT hit — cost minus what the
  // consolation outcome returns. It is what actually drains a bankroll during a
  // chase, and it is much smaller than `cost` precisely because of the floor.
  const missMass = 1 - base.q;
  const missReturn =
    missMass > EPS
      ? base.rs.filter((r) => r.gross < jackpotMultiple * v.cost).reduce((a, r) => a + r.p * r.gross, 0) / missMass
      : 0;
  const bleed = v.cost - missReturn;

  const pullsToCoinflip = base.q > 0 ? Math.log(2) / base.q : null;
  const chaseCost = pullsToCoinflip != null ? pullsToCoinflip * bleed : null;

  return {
    rtp: base.rtp,
    rake: base.rake,
    topMultiple: top.gross / v.cost,
    topName: `${top.name} (${top.wear})`,
    jackpotOdds: base.q,
    oneIn: base.q > 0 ? 1 / base.q : null,
    dreamShare: base.dreamShare,
    skew,
    floorRatio: floor / v.cost,
    hitRate,
    bleed,
    pullsToCoinflip,
    chaseCost,
    score: base.score,
    robustScore: shocked.score,
    topPriced,
    dreamSurvivesShock: shocked.q > 0,
  };
}

export interface RankedGamble {
  contract: ValuedContract;
  profile: GambleProfile;
}

export interface RankOptions extends GambleOptions {
  /** Drop contracts whose jackpot is unreachable (q === 0). Default true. */
  requireJackpot?: boolean;
  /** Drop contracts whose best outcome is unpriced. Default true. */
  requireTopPriced?: boolean;
  /** Reject a gamble whose rake exceeds this. Default 0.60 — worse than a
   *  scratch card, and at that point the bet is not skew, it is a donation. */
  maxRake?: number;
  /** Quarantine a contract whose rake is BELOW this. Default 0.02.
   *
   *  This looks backwards and is the most important guard in the file. The
   *  market prices inputs above output EV at every tier measured, so a contract
   *  claiming to hand money back is not an edge — it is a bad price, and it is
   *  the most over-represented bad price because the ranking is what selected
   *  it. Ranking +EV first (score = Infinity) would put a price error at #1
   *  every single time. So low rake routes to `suspects` for validation instead
   *  of to the top of the recommendations. */
  minRake?: number;
  /** Minimum stake, to filter out sub-dollar noise contracts. Default 0. */
  minCost?: number;
}

export type RejectReason =
  | "below-min-cost"
  | "top-unpriced"
  | "no-jackpot"
  | "single-outcome"
  | "rake-too-high"
  | "impossible-floor"
  | "implausible-rake";

export interface RankResult {
  /** Rankable gambles, best first. */
  ranked: RankedGamble[];
  /** Contracts whose numbers are too good to be true — quarantined for price
   *  validation, deliberately NOT presented as opportunities. */
  suspects: { contract: ValuedContract; profile: GambleProfile; reason: RejectReason }[];
  /** Count of rejections by reason, so a sweep is auditable. */
  rejected: Record<string, number>;
}

/** Rank contracts as GAMBLES: by robustScore, i.e. jackpot exposure per dollar
 *  of house edge, after shocking the top outcome. Deliberately NOT by delta. */
export function rankGambles(contracts: ValuedContract[], opts: RankOptions = {}): RankResult {
  const requireJackpot = opts.requireJackpot ?? true;
  const requireTopPriced = opts.requireTopPriced ?? true;
  const maxRake = opts.maxRake ?? 0.6;
  const minRake = opts.minRake ?? 0.02;
  const minCost = opts.minCost ?? 0;

  const ranked: RankedGamble[] = [];
  const suspects: RankResult["suspects"] = [];
  const rejected: Record<string, number> = {};
  const bump = (r: RejectReason) => { rejected[r] = (rejected[r] ?? 0) + 1; };

  for (const contract of contracts) {
    if (contract.cost < minCost) { bump("below-min-cost"); continue; }
    const profile = gambleProfile(contract, opts);

    if (requireTopPriced && !profile.topPriced) { bump("top-unpriced"); continue; }
    // A contract with one outcome is not a gamble, it is a conversion. It also
    // reads as skew 0 / "1 in 1", which is the signature of a catalog or price
    // artifact rather than a bet.
    if (contract.outcomes.length < 2) { bump("single-outcome"); continue; }
    // The worst outcome cannot be worth more than the stake — that would mean
    // the contract pays out unconditionally. Cheapest possible price-error test.
    if (profile.floorRatio >= 1) { bump("impossible-floor"); suspects.push({ contract, profile, reason: "impossible-floor" }); continue; }
    if (requireJackpot && profile.jackpotOdds <= 0) { bump("no-jackpot"); continue; }
    if (profile.rake > maxRake) { bump("rake-too-high"); continue; }
    if (profile.rake < minRake) { bump("implausible-rake"); suspects.push({ contract, profile, reason: "implausible-rake" }); continue; }

    ranked.push({ contract, profile });
  }

  ranked.sort(
    (a, b) =>
      b.profile.robustScore - a.profile.robustScore ||
      b.profile.skew - a.profile.skew ||
      a.contract.cost - b.contract.cost,
  );
  suspects.sort((a, b) => a.profile.rake - b.profile.rake);
  return { ranked, suspects, rejected };
}
