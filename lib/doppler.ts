// Doppler and Gamma Doppler phases as outcomes. In the game a contract first
// picks the skin ("★ Karambit | Doppler"), and the phase comes with it, so a
// Doppler's share of a contract is split across its phases, never multiplied by
// them. The catalog has one entry per phase under the same name, which is what
// both the Simulator and the Venture data split on.
//
// Valve publishes no phase odds. These are community estimates: the four
// standard phases make up about 90% of Dopplers, the gems the rest, Black
// Pearl the rarest. Change them here and both screens follow.
export const PHASE_WEIGHTS: Record<string, number> = {
  "Phase 1": 0.225,
  "Phase 2": 0.225,
  "Phase 3": 0.225,
  "Phase 4": 0.225,
  Ruby: 0.04,
  Sapphire: 0.04,
  "Black Pearl": 0.02,
  Emerald: 0.1, // Gamma Doppler's only gem; its four phases share the rest
};

export const isGem = (phase: string) => !phase.startsWith("Phase");

// Each phase's share of its skin, normalized over the phases that skin
// actually has (Doppler: 4 + Ruby/Sapphire/Black Pearl; Gamma: 4 + Emerald).
export function phaseShares(phases: string[]): Map<string, number> {
  const w = phases.map((p) => PHASE_WEIGHTS[p] ?? PHASE_WEIGHTS["Phase 1"]);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return new Map(phases.map((p, i) => [p, w[i] / total]));
}

// Display order: the standard phases, then the gems rarest-last.
const ORDER = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Ruby", "Sapphire", "Emerald", "Black Pearl"];
export const byPhaseOrder = (a: string, b: string) => ORDER.indexOf(a) - ORDER.indexOf(b);

// One outcome → one per phase, each with its share of the probability. `rows`
// are the catalog entries for that name (one per phase); `value` prices a
// phase, defaulting to the outcome's own value (Steam lists a Doppler under one
// name, so a weapon Doppler's phases share a price).
export function splitPhases<T extends { skinId: string; probability: number; value: number | null; phase?: string }>(
  o: T,
  rows: { id: string; phase?: string }[],
  value?: (phase: string) => number | null | undefined,
): T[] {
  const phased = rows.filter((r): r is { id: string; phase: string } => !!r.phase);
  if (o.phase || phased.length < 2) return [o];
  const shares = phaseShares(phased.map((r) => r.phase));
  return phased
    .sort((a, b) => byPhaseOrder(a.phase, b.phase))
    .map((r) => ({ ...o, skinId: r.id, phase: r.phase, probability: o.probability * shares.get(r.phase)!, value: value?.(r.phase) ?? o.value }));
}

// "★ Skeleton Knife | Doppler" + "Ruby" → "★ Skeleton Knife | Doppler (Ruby)"
export const withPhase = (name: string, phase?: string | null) => (phase ? `${name} (${phase})` : name);
