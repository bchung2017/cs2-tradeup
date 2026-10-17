// The homepage intro's three knives: this week's biggest knife jackpots in
// the Venture runs (lib/ventures.ts), one per knife model so the ledge shows
// three different shapes. Each with a same-origin picture (app/api/steam-img).
import { loadVentures } from "@/lib/ventures-data";
import { loadSkins } from "@/lib/data";
import type { IntroKnife } from "@/components/circuit/loungeCave";

const isKnife = (name: string) => name.startsWith("★") && !/Gloves|Hand Wraps/.test(name);

export function weeklyJackpotKnives(n = 3): { knives: IntroKnife[]; generatedAt: string } {
  const file = loadVentures();
  const best = new Map<string, IntroKnife & { key: string }>(); // per knife model
  for (const v of file.ventures) {
    for (const o of v.outcomes) {
      const value = o.value ?? 0;
      if (!isKnife(o.name) || !(value > 0)) continue;
      const model = o.name.split(" | ")[0];
      const cur = best.get(model);
      if (!cur || value > cur.value) best.set(model, { key: model, name: o.name, phase: o.phase ?? null, wear: o.wear, value, probability: o.probability, image: "" });
    }
  }
  const skins = loadSkins() as (ReturnType<typeof loadSkins>[number] & { phase?: string })[];
  const out: IntroKnife[] = [];
  for (const k of [...best.values()].sort((a, b) => b.value - a.value)) {
    const skin = skins.find((s) => s.name === k.name && (s.phase ?? null) === k.phase) ?? skins.find((s) => s.name === k.name);
    const hash = skin?.image?.split("/economy/image/")[1]?.split("/")[0];
    if (!hash) continue;
    out.push({ name: k.name, phase: k.phase, wear: k.wear, value: k.value, probability: k.probability, image: `/api/steam-img?h=${hash}` });
    if (out.length === n) break;
  }
  return { knives: out, generatedAt: file.generatedAt };
}
