import type { Rarity } from "@/types/cs2";

export function oddsString(p: number): string {
  if (p <= 0) return "—";
  return `1 in ${(1 / p).toFixed(1)}`;
}

export function usd(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

export function signedUsd(n: number): string {
  const s = n >= 0 ? "+" : "−";
  return `${s}$${Math.abs(n).toFixed(2)}`;
}

// Canonical CS2 rarity colors — the single source of truth for borders in both
// the inventory grid and the trade-up contract slots.
export const RARITY_HEX: Record<string, string> = {
  "Consumer Grade": "#b0c3d9",
  "Industrial Grade": "#5e98d9",
  "Mil-Spec Grade": "#4b69ff",
  Restricted: "#8847ff",
  Classified: "#d32ce6",
  Covert: "#eb4b4b",
  Contraband: "#e4ae39",
  // weapon-adjacent tiers (stickers/agents/gloves/knives)
  "Base Grade": "#b0c3d9",
  "High Grade": "#4b69ff",
  Remarkable: "#8847ff",
  Exotic: "#d32ce6",
  Extraordinary: "#eb4b4b",
};

export function rarityHex(rarity: string | null | undefined): string {
  return (rarity && RARITY_HEX[rarity]) || "var(--surface-line)";
}

export function rarityColor(r: Rarity): string {
  switch (r) {
    case "Mil-Spec Grade":
      return "var(--rar-milspec)";
    case "Restricted":
      return "var(--rar-restricted)";
    case "Classified":
      return "var(--rar-classified)";
    case "Covert":
      return "var(--rar-covert)";
    default:
      return "var(--cream-dim)";
  }
}
