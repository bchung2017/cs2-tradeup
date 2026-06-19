"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Rarity, Skin } from "@/types/cs2";
import type { InventoryItem } from "@/lib/steam";

export interface Slot {
  skin: Skin | null;
  float: number;
  stattrak: boolean;
  // Median market price of the staged item, carried from the inventory feed so
  // the trade-up side can show per-input price. Null/undefined when unknown
  // (e.g. catalog picks, or items with no priced wear).
  price?: number | null;
}

export const makeSlots = (n: number): Slot[] =>
  Array.from({ length: n }, () => ({ skin: null, float: 0, stattrak: false }));

// Standard contract = 10 inputs; the special Covert→knife contract = 5.
const STANDARD_COUNT = 10;
const KNIFE_COUNT = 5;
export const EMPTY_SLOTS: Slot[] = makeSlots(STANDARD_COUNT);

// True when a market name carries the StatTrak™ marker.
export function isStatTrakName(name: string | null | undefined): boolean {
  return /StatTrak/i.test(name ?? "");
}

// ★-marked items are the rare-special "Gold" tier — knives and gloves. In CS2
// these are trade-up OUTPUTS, never inputs: a 5× Covert contract *produces* one.
// Knives even carry a Covert rarity tag that would otherwise pass the tier gate,
// so eligibility rejects anything ★-marked up front.
function isStarItem(name: string | null | undefined): boolean {
  return !!name && name.includes("★");
}

// The ×5 "knife" contract is the special Covert→Gold trade-up: five Covert (red)
// weapon skins roll one knife/glove. It's the only contract that isn't ×10, and
// Covert is the only rarity that leads it.
export function isKnifeContract(skin: Skin | null | undefined): boolean {
  return skin?.rarity.name === "Covert";
}

// Weapon grades usable as trade-up inputs. Consumer→Classified lead the standard
// ×10 contract; Covert (red) weapon skins lead the special ×5 knife contract
// (Covert → Gold). Contraband sits above the range, and non-weapon items — medals,
// coins, agents, cases, stickers, graffiti, music kits, pins, gloves, and ★ knives
// — are either outside this set or ★-marked and caught before the tier check.
const TRADEABLE_INPUT_TIERS = new Set<string>([
  "Consumer Grade",
  "Industrial Grade",
  "Mil-Spec Grade",
  "Restricted",
  "Classified",
  "Covert",
]);

function isSouvenirName(name: string | null | undefined): boolean {
  return /^Souvenir\s/i.test(name ?? "");
}

// Float-independent gate: can this inventory item EVER be a trade-up input? This
// is distinct from the per-contract rarity/StatTrak lock (which only blocks an
// otherwise-eligible item from joining the contract currently staged). Used by
// both the grid (to disable a tile) and addFromInventory (to reject the add),
// so the UI never shows an item as usable that the handler then refuses.
export function inventoryInputEligibility(
  item: InventoryItem,
): { eligible: boolean; reason?: string } {
  // ★ knives & gloves are the Gold output tier, never inputs — reject them first,
  // before the tier gate, since knives carry a Covert rarity that would pass it.
  if (isStarItem(item.name)) {
    return { eligible: false, reason: "★ knives & gloves can't be trade-up inputs" };
  }
  if (isSouvenirName(item.name)) {
    return { eligible: false, reason: "Souvenir — not a trade-up input" };
  }
  if (!item.rarity || !TRADEABLE_INPUT_TIERS.has(item.rarity)) {
    return { eligible: false, reason: `${item.rarity ?? "This item"} — not a trade-up input` };
  }
  return { eligible: true };
}

// Contract size derives from the first staged item: a Covert (red) lead forces
// the ×5 knife contract; anything else (or an empty grid) stays ×10. Resizing
// preserves staged items in order.
function sizedForFirst(slots: Slot[]): Slot[] {
  const first = slots.find((s) => s.skin);
  const target = first?.skin && isKnifeContract(first.skin) ? KNIFE_COUNT : STANDARD_COUNT;
  if (slots.length === target) return slots;
  const filled = slots.filter((s) => s.skin).slice(0, target);
  const out = makeSlots(target);
  for (let i = 0; i < filled.length; i++) out[i] = filled[i];
  return out;
}

interface TradeupCtx {
  slots: Slot[];
  setSlots: React.Dispatch<React.SetStateAction<Slot[]>>;
  count: number; // auto-derived grid size: 5 when a knife leads, else 10
  // Drops an inventory item into the next empty slot. Respects the rarity + StatTrak lock.
  addFromInventory: (item: InventoryItem) => { ok: boolean; reason?: string };
  // The currently loaded profile's steamid64, mirrored from the inventory side so
  // the trade-up header can show that profile's avatar. Null until one resolves.
  steamid: string | null;
  setSteamid: (id: string | null) => void;
}

const Ctx = createContext<TradeupCtx | null>(null);

export function useTradeup() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTradeup must be used within <TradeupProvider>");
  return c;
}

// Build a Skin from a raw inventory item. Parses "Weapon | Paint (Wear)",
// stripping ★ / StatTrak™ / Souvenir / wear. Float range is a synthetic 0..1
// since the basic Steam endpoint carries no float and the seed catalog has no
// match — real ranges/collections arrive once `npm run fetch-data` is run.
function skinFromInventory(item: InventoryItem): Skin {
  const market = (item.name ?? "")
    .trim()
    .replace(/^★\s*/, "")
    .replace(/^StatTrak™\s*/i, "")
    .replace(/^Souvenir\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "");
  const [head, ...rest] = market.split(" | ");
  const weapon = (rest.length ? head : "Item").trim() || "Item";
  const paint = (rest.length ? rest.join(" | ") : head).trim() || (item.name ?? "Unknown");
  return {
    id: `inv-${item.assetid}`,
    name: paint,
    weapon: { id: `inv-${item.classid}`, name: weapon },
    rarity: { id: "inv", name: (item.rarity ?? "Mil-Spec Grade") as Rarity },
    min_float: 0,
    max_float: 1,
    collections: [],
    image: item.icon_url ?? undefined,
  };
}

export function TradeupProvider({ children }: { children: React.ReactNode }) {
  const [slots, setSlotsRaw] = useState<Slot[]>(() => makeSlots(STANDARD_COUNT));
  const [steamid, setSteamid] = useState<string | null>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // Every slot update is auto-sized: ×5 when a knife leads, else ×10. This
  // replaces the old manual standard/knife toggle — the grid converts itself.
  const setSlots = useCallback<React.Dispatch<React.SetStateAction<Slot[]>>>((action) => {
    setSlotsRaw((prev) => {
      const next = typeof action === "function" ? (action as (p: Slot[]) => Slot[])(prev) : action;
      return sizedForFirst(next);
    });
  }, []);

  // Contract size is purely derived from the (already auto-sized) grid.
  const count = slots.length;

  const addFromInventory = useCallback((item: InventoryItem) => {
    const prev = slotsRef.current;
    const elig = inventoryInputEligibility(item);
    if (!elig.eligible) return { ok: false, reason: elig.reason };
    const skin = skinFromInventory(item);
    const stattrak = isStatTrakName(item.name);
    const first = prev.find((s) => s.skin);
    if (first?.skin) {
      if (skin.rarity.name !== first.skin.rarity.name) {
        return { ok: false, reason: `rarity locked to ${first.skin.rarity.name}` };
      }
      if (stattrak !== first.stattrak) {
        return { ok: false, reason: `locked to ${first.stattrak ? "StatTrak™" : "non-StatTrak"}` };
      }
    }
    const idx = prev.findIndex((s) => !s.skin);
    if (idx === -1) return { ok: false, reason: "all slots full" };
    const next = [...prev];
    // Use the real per-item float once a deep sync has populated it; otherwise
    // fall back to the skin's min (synthetic until floats are resolved).
    next[idx] = { skin, float: item.float ?? skin.min_float, stattrak, price: item.price ?? null };
    setSlots(next); // auto-sizes to ×5 when this knife is the leading item
    return { ok: true };
  }, [setSlots]);

  const value = useMemo(
    () => ({ slots, setSlots, count, addFromInventory, steamid, setSteamid }),
    [slots, count, setSlots, addFromInventory, steamid],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
