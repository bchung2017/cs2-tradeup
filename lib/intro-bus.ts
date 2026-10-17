// Hands the homepage's intro knives to the Lounge backdrop (which lives in
// the root layout, outside the page), whichever of the two mounts first.
import type { IntroKnife } from "@/components/circuit/loungeCave";

let current: IntroKnife[] | null = null;
const waiting = new Set<(k: IntroKnife[]) => void>();

export function offerIntro(knives: IntroKnife[]) {
  current = knives;
  for (const w of waiting) w(knives);
  waiting.clear();
}
export function withdrawIntro() {
  current = null;
}
export function nextIntro(): Promise<IntroKnife[]> {
  return current ? Promise.resolve(current) : new Promise((r) => waiting.add(r));
}
