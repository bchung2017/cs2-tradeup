// Words and numbers for the Venture surface, in the register the design doc sets
// (context/modelUIdesignlanguage.md): no "EV", no "variance", no "profit" as a
// noun; everything is said against "just selling".
import type { Venture, Verdict } from "@/lib/ventures";

export const WEAR_ABBR: Record<string, string> = {
  "Factory New": "FN",
  "Minimal Wear": "MW",
  "Field-Tested": "FT",
  "Well-Worn": "WW",
  "Battle-Scarred": "BS",
};
export const abbr = (wear: string) => WEAR_ABBR[wear] ?? wear;

export const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// 0.93 → "93¢ back per $1"
export const backPerDollar = (x: number) => `${Math.round(x * 100)}¢ back per $1`;
export const backShort = (x: number) => `${Math.round(x * 100)}¢`;

export const pct = (p: number) => (p >= 0.995 ? "100%" : p > 0 && p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

// 0.0333 → "1 in 30"
export const oneIn = (p: number) => (p <= 0 ? "never" : p >= 1 ? "every time" : `1 in ${Math.round(1 / p)}`);

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const VERDICT: Record<Verdict, { label: string; tone: "good" | "warn" | "bad" | "dim"; note: string }> = {
  holds: { label: "PAYS BACK", tone: "good", note: "pays back more than it costs at live sale prices" },
  paper: { label: "ON PAPER", tone: "warn", note: "only pays back through outcomes nobody bought in the last 24h" },
  dead: { label: "COSTS MORE", tone: "bad", note: "costs more than it pays back at live prices" },
  unverified: { label: "UNCHECKED", tone: "warn", note: "a live price didn't load on the last check" },
  short: { label: "CAN'T FILL", tone: "bad", note: "Steam doesn't list enough inputs under the float cap" },
  model: { label: "FEED ONLY", tone: "dim", note: "priced from market feeds, not checked against live listings" },
};

export const TIER_SHORT: Record<string, string> = {
  "Consumer Grade": "Consumer",
  "Industrial Grade": "Industrial",
  "Mil-Spec Grade": "Mil-Spec",
  Restricted: "Restricted",
  Classified: "Classified",
  Covert: "Covert",
  Extraordinary: "Knife / Gloves",
};

export function ventureTitle(v: Venture): string {
  return v.inputs.map((i) => `${i.count}× ${i.skin}`).join(" + ");
}

// The one line IGL-9000 says about a contract.
export function ventureLine(v: Venture): string {
  const hit = `${oneIn(v.best.probability)} pulls is ${v.best.name} (${abbr(v.best.wear)}), ${money(v.best.value)}`;
  const vs = v.backPerDollar >= 1 ? "more than just selling the inputs back" : `${backShort(1 - v.backPerDollar)} per $1 less than never buying in`;
  return `${hit}. Over many pulls it's ${vs}.`;
}

export const STANDING_LINE =
  "Sorted by how much comes back, not by what pays: at live sale prices almost nothing here returns more than it costs. Every row is a bet with a known price.";
