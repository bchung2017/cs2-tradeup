// IGL-9000 — repeat-trial risk model.
//
// `delta` answers "is one contract worth running". It does not answer the
// question a repeat player is actually asking: a contract whose edge lives in a
// 1.7% jackpot is not a coin flip, it is a drought punctuated by a payout, and
// whether you can run it depends on surviving the drought.
//
// Everything here is derived from the outcome distribution a ValuedContract
// already carries, so it needs no new price data. Deterministic: same contract +
// same seed → same numbers.

import type { ValuedContract } from "@/lib/igl9000-engine";

export interface TrialStats {
  evPerTrial: number; // = delta
  stdevPerTrial: number; // spread of one roll's profit
  pProfitSingle: number; // chance one roll beats its cost
  pProfitAfter: { n: number; p: number }[]; // chance of being up after n runs
  trialsForEvenOdds: number | null; // smallest n where being up is more likely than not
  trialsFor90: number | null; // smallest n where you are up 90% of the time
  bankrollFor5pctRuin: number | null; // stake needed to run 100 trials with <=5% ruin
  kellyFraction: number; // fraction of bankroll per trial (mu/sigma^2 approximation)
  jackpotShare: number; // fraction of EV coming from the top 5% of probability
}

/** Deterministic RNG so the whole model is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function trialStats(
  v: ValuedContract,
  opts: { runs?: number; seed?: number; horizon?: number } = {},
): TrialStats {
  const runs = opts.runs ?? 4000;
  const seed = opts.seed ?? 1;
  const horizon = opts.horizon ?? 100;

  // profit of each outcome, and the cumulative table used for sampling.
  const outs = v.outcomes
    .filter((o) => o.bidNet != null)
    .map((o) => ({ p: o.probability, profit: (o.bidNet as number) - v.cost }));
  const mass = outs.reduce((a, o) => a + o.p, 0);
  if (!outs.length || mass <= 0) {
    return {
      evPerTrial: v.delta, stdevPerTrial: 0, pProfitSingle: 0, pProfitAfter: [],
      trialsForEvenOdds: null, trialsFor90: null, bankrollFor5pctRuin: null,
      kellyFraction: 0, jackpotShare: 0,
    };
  }
  // renormalise over priced outcomes so the sampler is a proper distribution
  const norm = outs.map((o) => ({ ...o, p: o.p / mass }));
  const mu = norm.reduce((a, o) => a + o.p * o.profit, 0);
  const varr = norm.reduce((a, o) => a + o.p * (o.profit - mu) ** 2, 0);
  const sd = Math.sqrt(varr);
  const pWin = norm.filter((o) => o.profit > 0).reduce((a, o) => a + o.p, 0);

  // how much of the upside is concentrated in the rarest outcomes
  const byPayout = [...norm].sort((a, b) => b.profit - a.profit);
  let acc = 0;
  let topEv = 0;
  for (const o of byPayout) {
    if (acc >= 0.05) break;
    const take = Math.min(o.p, 0.05 - acc);
    topEv += take * Math.max(0, o.profit);
    acc += take;
  }
  const totalUpside = norm.reduce((a, o) => a + o.p * Math.max(0, o.profit), 0);
  const jackpotShare = totalUpside > 0 ? topEv / totalUpside : 0;

  const cum: number[] = [];
  let c = 0;
  for (const o of norm) { c += o.p; cum.push(c); }
  const draw = (rnd: () => number) => {
    const r = rnd();
    for (let i = 0; i < cum.length; i++) if (r <= cum[i]) return norm[i].profit;
    return norm[norm.length - 1].profit;
  };

  // P(up after n) for a ladder of n, from one pass of independent run-paths
  const ladder = [1, 2, 3, 5, 10, 20, 50, 100].filter((n) => n <= horizon);
  const wins = new Map<number, number>(ladder.map((n) => [n, 0]));
  const rnd = mulberry32(seed);
  for (let r = 0; r < runs; r++) {
    let total = 0;
    let i = 0;
    for (const n of ladder) {
      for (; i < n; i++) total += draw(rnd);
      if (total > 0) wins.set(n, wins.get(n)! + 1);
    }
  }
  const pProfitAfter = ladder.map((n) => ({ n, p: wins.get(n)! / runs }));
  const firstAt = (thr: number) => pProfitAfter.find((x) => x.p >= thr)?.n ?? null;

  // Bankroll: you must be able to fund the next contract. Ruin = falling below
  // one contract's cost before `horizon` trials are done.
  let bankroll: number | null = null;
  for (const mult of [1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200]) {
    const start = v.cost * mult;
    let ruined = 0;
    const r2 = mulberry32(seed + 7919);
    for (let r = 0; r < 1000; r++) {
      let bank = start;
      for (let i = 0; i < horizon; i++) {
        if (bank < v.cost) { ruined++; break; }
        bank += draw(r2);
      }
    }
    if (ruined / 1000 <= 0.05) { bankroll = start; break; }
  }

  return {
    evPerTrial: v.delta,
    stdevPerTrial: sd,
    pProfitSingle: pWin,
    pProfitAfter,
    trialsForEvenOdds: firstAt(0.5),
    trialsFor90: firstAt(0.9),
    bankrollFor5pctRuin: bankroll,
    kellyFraction: varr > 0 ? Math.max(0, mu / varr) : 0,
    jackpotShare,
  };
}
