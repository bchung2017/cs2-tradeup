// IGL-9000 — the route model behind the Venture surface.
//
// IGL = in-game leader (the shotcaller that reads the economy and calls the
// buy); 9000 = machine designation. Two halves, per context/modeltechnical-
// breakdown.md: a JourneyPlanner policy (greedy best-move over trade-up deltas)
// and a JourneySim Monte-Carlo rollout (p10/p50/p90 of terminal value). Both
// are speced but not yet wired to live pricing/float data — that depends on the
// force-sync + eligibility work in the main-branch CONTEXT piles.
//
// So this module ships two things that ARE real today:
//   1. The route data model (Route/Hop/Destination/…) the Venture UI renders.
//   2. IGL-9000's voice — copy generated FROM that data, in the register the
//      design doc settles on (Artemis Fowl mastermind for IGL's lines; flat,
//      undeniable Matrix math for the numbers).
// Route *content* currently comes from `demoRoute()` — a deterministic preview
// mirroring the design mock. Swap that one function for the planner output and
// the whole surface lights up unchanged.

import { signedUsd, usd } from "@/lib/display";

// The three input tiers a route actually escalates through (Restricted →
// Classified → Covert). Kept local: this is a display concern (which rarity
// band a node wears), not the full Rarity ladder in types/cs2.ts.
export type RouteRarity = "Restricted" | "Classified" | "Covert";

// Per-slot fill state — the 2×5 grid's whole vocabulary (design doc "channel
// map": filled = owned, amber = buy-needed, hollow = waiting on an upstream hop).
export type SlotFill = "own" | "buy" | "wait";

// A node's posture. Exactly one hop in a route is "armed" at a time (the one
// you can fire now); the rest are needs-buy or waiting downstream.
export type HopState = "armed" | "needs-buy" | "locked";

export interface Stash {
  count: number; // skins you hold
  sellNow: number; // sum of bid_net — the do-nothing baseline
  used: number; // how many this route actually touches
}

export interface Hop {
  hop: number; // 1-based position on the rail
  rarity: RouteRarity;
  contractSize: number; // 10, or 5 for the Covert→knife contract
  delta: number; // signed $, always shown — even when locked (honesty invariant)
  slots: SlotFill[]; // length === contractSize
  state: HopState;
  // Present when state === "needs-buy": the real completion cost + lock.
  need?: { count: number; buyCost: number; unlockDays: number };
  // Present when state === "locked": where the missing inputs come from.
  waitsOn?: string;
}

export interface Destination {
  rarity: RouteRarity;
  skinName: string;
  wear: string;
  floatApprox: number;
  payout: number; // headline p50 payout
  // Monte-Carlo terminal spread. Labelled for humans as rough/normal/lucky.
  spread: { p10: number; p50: number; p90: number };
  hitOdds: number; // 0..1 — chance the target skin itself drops
  hitName: string; // the skin the odds refer to ("the AWP")
}

export interface RouteStats {
  cashNeeded: number; // sum of completion buys across the route
  buyCount: number; // how many skins you must buy
  likelyEndValue: number; // p50 terminal value
  netVsSelling: number; // signed: whole route vs. selling everything now
}

export interface Route {
  label: string; // e.g. "alpha"
  stash: Stash;
  hops: Hop[];
  destination: Destination;
  stats: RouteStats;
}

// ── IGL-9000 voice ─────────────────────────────────────────────────────────
// The shotcaller talks. Register (design doc): boy-genius mastermind working
// for YOU — suave, precise, faintly smug, mercenary on your behalf. It never
// softens the math; it makes the honest number sound like a play worth making.
// Every line is built from route data, so it can't drift from the numbers.

const RARITY_PLURAL: Record<RouteRarity, string> = {
  Restricted: "purples",
  Classified: "pinks",
  Covert: "reds",
};

// One-liner spoken at the top of the surface — the "I've found something" open.
export function iglBrief(route: Route): string {
  const { stats, destination, hops } = route;
  const buys = stats.buyCount;
  const target = destination.hitName;
  if (buys === 0) {
    return `Route's already in your stash. ${hops.length} hops to ${target}, nothing to buy — just fire when you're ready.`;
  }
  // Name the buy by the rarity it lands in (design doc example:
  // "Buy two pinks — $6.30 — and hop 2 opens.").
  const buyHop = hops.find((h) => h.state === "needs-buy");
  const noun = buyHop ? RARITY_PLURAL[buyHop.rarity] : "skins";
  const count = numberWord(buys);
  return `I've found something. Buy ${count} ${noun} — ${usd(stats.cashNeeded)} — and the route opens to ${target}. ${hops.length} hops, ends ${usd(stats.likelyEndValue)} on a normal run.`;
}

// The line under a single hop — mercenary, specific, never coddling.
export function iglHop(hop: Hop): string {
  switch (hop.state) {
    case "armed":
      return `All ten are yours and the floats sit right. Fire it — ${signedUsd(hop.delta)} over selling them.`;
    case "needs-buy": {
      const n = hop.need!;
      return `${cap(numberWord(n.count))} short. ${usd(n.buyCost)} covers it; they unlock in ${n.unlockDays}d, then this hop arms.`;
    }
    case "locked":
      return `Nothing to do yet — ${hop.waitsOn ?? "an upstream hop feeds this one"}. Still ${signedUsd(hop.delta)} when it lands.`;
  }
}

// The destination's spoken close — the payoff, honest about the spread.
export function iglDestination(dest: Destination): string {
  return `${dest.skinName}. One pull in ${(1 / dest.hitOdds).toFixed(0)} is ${dest.hitName} itself — the rest still sell. ${usd(dest.spread.p50)} normal, ${usd(dest.spread.p10)} on a rough day.`;
}

// Plain-frequency odds line (design doc: "1 in 5 pulls hits the AWP — the rest
// still sell"). Kept flat and factual — this is the Matrix voice, not IGL's.
export function oddsLine(dest: Destination): string {
  return `1 in ${(1 / dest.hitOdds).toFixed(0)} pulls hits ${dest.hitName} itself — the rest still sell`;
}

function numberWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Route source ─────────────────────────────────────────────────────────────
// PREVIEW route: deterministic, mirrors the design mock (route "alpha"). This is
// the single seam to the live model — replace demoRoute() with the JourneyPlanner
// + JourneySim output (see context/modeltechnicalbreakdown.md §5,§7) and every
// consumer above keeps working. Marked isPreview so the UI can label it honestly.

export const IS_PREVIEW_ROUTE = true;

export function demoRoute(): Route {
  const own10: SlotFill[] = Array(10).fill("own");
  const hop2Slots: SlotFill[] = [...Array(8).fill("own"), "buy", "buy"];
  const hop3Slots: SlotFill[] = [...Array(7).fill("own"), "wait", "wait", "wait"];

  const destination: Destination = {
    rarity: "Covert",
    skinName: "AWP | Fever Dream",
    wear: "Field-Tested",
    floatApprox: 0.24,
    payout: 38.5,
    spread: { p10: 19, p50: 42, p90: 61 },
    hitOdds: 0.2,
    hitName: "the AWP",
  };

  const hops: Hop[] = [
    {
      hop: 1,
      rarity: "Restricted",
      contractSize: 10,
      delta: 1.92,
      slots: own10,
      state: "armed",
    },
    {
      hop: 2,
      rarity: "Classified",
      contractSize: 10,
      delta: 3.4,
      slots: hop2Slots,
      state: "needs-buy",
      need: { count: 2, buyCost: 6.3, unlockDays: 3 },
    },
    {
      hop: 3,
      rarity: "Covert",
      contractSize: 10,
      delta: 2.83,
      slots: hop3Slots,
      state: "locked",
      waitsOn: "3 slots come from hop 2's payouts",
    },
  ];

  return {
    label: "alpha",
    stash: { count: 23, sellNow: 27.35, used: 18 },
    hops,
    destination,
    stats: { cashNeeded: 6.3, buyCount: 2, likelyEndValue: 41.8, netVsSelling: 8.15 },
  };
}
