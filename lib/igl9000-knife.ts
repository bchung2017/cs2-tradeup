/**
 * Shared pieces of the Covert ×5 → knife/glove contract: which collections have
 * a knife pool, and what each pool item is worth off Steam.
 *
 * Values come from the Buff163 and CSFloat feeds (lib/third-party-feeds.ts):
 *   fast    = top buy order × (1 − fee)
 *   patient = lowest ask × (1 − fee), or the fast value when the ask is > 3× the buy order
 * A Doppler or Gamma Doppler is the even average of its phases, an upper bound
 * for the rare ones (Ruby, Sapphire, Black Pearl, Emerald).
 */
import type { Skin, Wear } from "@/types/cs2";
import { phasesOf, quoteOf, type FeedTable } from "@/lib/third-party-feeds";

const EXCLUDED = "Limited Edition Item";
export const colsOf = (s: Skin) => s.collections.filter((c) => c.name !== EXCLUDED);

export interface Pool { id: string; name: string; inputs: Skin[]; knives: Skin[] }

// Every collection with Covert inputs and its Extraordinary outcomes. Doppler
// rows (one per phase in the catalog) collapse to one item per name.
export function buildPools(skins: Skin[]): Map<string, Pool> {
  const pools = new Map<string, Pool>();
  for (const s of skins) {
    if (s.souvenir) continue;
    for (const c of colsOf(s)) {
      const p = pools.get(c.id) ?? { id: c.id, name: c.name, inputs: [], knives: [] };
      if (s.rarity.name === "Covert" && colsOf(s).length === 1) p.inputs.push(s);
      if (s.rarity.name === "Extraordinary" && !p.knives.some((k) => k.name === s.name)) p.knives.push(s);
      pools.set(c.id, p);
    }
  }
  for (const [id, p] of pools) if (!p.inputs.length || !p.knives.length) pools.delete(id);
  return pools;
}

export interface Value { fast: number | null; patient: number | null; phases?: { phase: string; fast: number | null }[] }

export function knifeValuer(tables: FeedTable[], fee: number) {
  const cache = new Map<string, Value>();
  // what selling one item nets: at the top buy order (fast) or at the lowest ask (patient)
  function sale(name: string, phase?: string): { fast: number | null; patient: number | null } {
    const { ask, bid } = quoteOf(tables, name, phase);
    const fast = bid == null ? null : bid * (1 - fee);
    // a lone ask far above the buy orders is a hope, not a price
    const patient = ask == null ? fast : bid != null && ask > 3 * bid ? fast : ask * (1 - fee);
    return { fast: fast ?? patient, patient };
  }
  function valueOf(skin: Skin, wear: Wear): Value {
    const name = `${skin.name} (${wear})`;
    const hit = cache.get(name);
    if (hit) return hit;
    const phases = phasesOf(skin.name);
    let v: Value;
    if (!phases) v = sale(name);
    else {
      const per = phases.map((phase) => ({ phase, ...sale(name, phase) }));
      const ok = per.every((p) => p.fast != null);
      v = {
        fast: ok ? per.reduce((a, p) => a + p.fast!, 0) / per.length : null,
        patient: ok ? per.reduce((a, p) => a + (p.patient ?? p.fast!), 0) / per.length : null,
        phases: per.map(({ phase, fast }) => ({ phase, fast })),
      };
    }
    cache.set(name, v);
    return v;
  }
  return { sale, valueOf };
}
