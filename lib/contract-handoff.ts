// Cross-route handoff for "Load into Simulator". The Research Lab (/research) has
// no TradeupProvider — it's mounted per-page on the simulator (/). So instead of
// sharing React state, the research view stashes a contract's inputs in
// sessionStorage and navigates to /, where TradeupProvider hydrates from it once
// on mount and clears it. Survives the client-side navigation; nothing persists
// past it.
import type { Skin } from "@/types/cs2";
import type { ResearchContract } from "@/types/research";

const KEY = "cs2:pendingContract";

// Structurally identical to tradeup-context's Slot (kept independent here to
// avoid a circular import). Assignable to Slot[] when hydrating.
export interface HandoffSlot {
  skin: Skin;
  float: number;
  stattrak: boolean;
  price?: number | null;
  priceSources?: Record<string, number> | null;
}

// Called from the research view: serialize a contract's inputs as staged slots.
export function writeHandoff(contract: ResearchContract): void {
  if (typeof window === "undefined") return;
  const slots: HandoffSlot[] = contract.inputs.map((i) => ({
    skin: i.skin,
    float: i.float,
    stattrak: i.stattrak,
    price: i.price,
    priceSources: i.priceSources ?? null,
  }));
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(slots));
  } catch {
    // sessionStorage unavailable (private mode / quota) — staging silently no-ops
  }
}

// Called once by TradeupProvider on mount. Returns the staged slots and clears
// them so a later reload doesn't re-stage a stale contract.
export function takeHandoff(): HandoffSlot[] | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
    if (raw) window.sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HandoffSlot[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}
