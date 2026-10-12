// A longlist row ("your red + the cheapest filler → a knife") as a full
// Venture, so My Ventures can show it like any market contract: every knife
// (each Doppler phase its own outcome) with its odds, float, wear and value.
// The pools and values come from the longlist file; the row carries its
// inputs. Rough like the longlist itself: floats at grade middles, the filler
// at the third-party lowest ask, your red at what selling it nets.
import { WEAR_RANGES } from "@/types/cs2";
import { isGem, phaseShares, withPhase } from "@/lib/doppler";
import { pAhead, type LonglistFile, type LonglistRow, type Venture, type VentureOutcome } from "@/lib/ventures";

const WEAR: Record<string, string> = { FN: "Factory New", MW: "Minimal Wear", FT: "Field-Tested", WW: "Well-Worn", BS: "Battle-Scarred" };
const N = 5;
const wearAt = (f: number) => WEAR_RANGES.find((w) => f < w.max)?.wear ?? "Battle-Scarred";
const gradeMin = (wear: string) => WEAR_RANGES.find((w) => w.wear === wear)?.min ?? 0;

export function longlistVenture(r: LonglistRow, file: LonglistFile): Venture | null {
  const A = r.ownedPool && file.pools?.[r.ownedPool];
  const B = r.fillerPool && file.pools?.[r.fillerPool];
  if (!A || !B || !r.ownedId || !r.fillerId || !file.values) return null;
  const T = r.adjustedFloat;
  const cost = r.cost;

  // each pool's knives share (its slots / 5) of the odds
  const share = new Map<string, number>([[r.ownedPool!, r.ownedCount / N]]);
  share.set(r.fillerPool!, (share.get(r.fillerPool!) ?? 0) + r.fillerCount / N);

  const outcomes: VentureOutcome[] = [];
  let tMax = 1;
  let first: string | null = null;
  for (const [poolKey, sh] of share) {
    const pool = file.pools![poolKey];
    const byName = new Map<string, typeof pool.knives>();
    for (const k of pool.knives) byName.set(k.name, [...(byName.get(k.name) ?? []), k]);
    for (const [name, entries] of byName) {
      const k0 = entries[0];
      const float = k0.min + T * (k0.max - k0.min);
      const wear = wearAt(float);
      // the first wear boundary any knife crosses as the average float rises
      for (const w of WEAR_RANGES.slice(0, -1)) {
        const t = (w.max - k0.min) / (k0.max - k0.min);
        if (t > T + 1e-6 && t < tMax) { tMax = t; first = name; }
      }
      const phased = entries.every((e) => e.phase) && entries.length > 1;
      const ps = phased ? phaseShares(entries.map((e) => e.phase!)) : null;
      for (const e of entries) {
        const value = file.values[`${e.skinId}|${wear}`] ?? null;
        outcomes.push({
          name, skinId: e.skinId, collection: pool.name, rarity: "Extraordinary",
          probability: (sh / byName.size) * (ps ? ps.get(e.phase!)! : 1 / entries.length),
          float, wear, skinMin: e.min, skinMax: e.max,
          value, checked: true, sold24h: null, win: (value ?? 0) > cost,
          ...(e.phase ? { phase: e.phase } : {}),
        });
      }
    }
  }
  outcomes.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const top = outcomes[0];
  if (!top) return null;
  const gemEv = outcomes.reduce((a, o) => a + (o.phase && isGem(o.phase) ? o.probability * (o.value ?? 0) : 0), 0);
  const ownedWear = WEAR[r.ownedWear] ?? r.ownedWear;
  const fillerWear = WEAR[r.fillerWear] ?? r.fillerWear;
  const inputs: Venture["inputs"] = [
    {
      skin: r.owned, skinId: r.ownedId, collection: A.name, rarity: "Covert", wear: ownedWear, count: r.ownedCount,
      floatMin: gradeMin(ownedWear), floatMax: r.ownedFloat ?? gradeMin(ownedWear), priceEach: r.ownedValue, basis: "cash-ask", listed: null,
    },
    {
      skin: r.filler, skinId: r.fillerId, collection: B.name, rarity: "Covert", wear: fillerWear, count: r.fillerCount,
      floatMin: gradeMin(fillerWear), floatMax: r.fillerFloat ?? gradeMin(fillerWear), priceEach: r.fillerAsk, basis: "cash-ask", listed: null,
    },
  ];
  return {
    key: r.key,
    source: "knife",
    tier: "Covert",
    outputTier: "Extraordinary",
    size: N,
    collections: [...new Set([A.name, B.name])],
    venue: "cash",
    inputs,
    outcomes,
    float: { adjusted: T, sum: T * N, max: tMax * N, firstChange: first },
    cost,
    value: r.value,
    valuePatient: r.valuePatient,
    backPerDollar: r.backPerDollar,
    pProfit: r.pProfit,
    pAhead: pAhead(outcomes.map((o) => ({ p: o.probability, v: o.value ?? 0 })), cost),
    best: { name: withPhase(top.name, top.phase), wear: top.wear, value: top.value ?? 0, probability: top.probability },
    rareShare: gemEv > 0 && r.value > 0 ? gemEv / r.value : null,
    verdict: "model",
    warnings: [
      `your ${r.owned} counts at what selling it nets (${r.ownedValue.toFixed(2)} each): that's what using it costs you`,
      "rough: floats at the middle of each wear grade, the filler at the third-party lowest ask (float-blind), knives at the top buy order",
      ...(gemEv > 0 ? [`gem Doppler phases are ${((gemEv / r.value) * 100).toFixed(0)}% of the value at estimated phase odds; Valve publishes none`] : []),
    ],
    verifiedAt: null,
    firstSeenAt: r.firstSeenAt,
    sources: ["feed: CSGOTrader buff163 + csfloat (asks, buy orders, Doppler phases)"],
  };
}
