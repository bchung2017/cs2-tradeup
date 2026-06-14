"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Rarity, Skin } from "@/types/cs2";
import type { InventoryItem } from "@/lib/steam";

export interface Slot {
  skin: Skin | null;
  float: number;
  stattrak: boolean;
}

export const makeSlots = (n: number): Slot[] =>
  Array.from({ length: n }, () => ({ skin: null, float: 0, stattrak: false }));

// Standard contract = 10 inputs; knife contract = 5.
export const EMPTY_SLOTS: Slot[] = makeSlots(10);

// True when a market name carries the StatTrak™ marker.
export function isStatTrakName(name: string | null | undefined): boolean {
  return /StatTrak/i.test(name ?? "");
}

interface TradeupCtx {
  slots: Slot[];
  setSlots: React.Dispatch<React.SetStateAction<Slot[]>>;
  count: number; // 10 (standard) or 5 (knife) — switching clears the staging area
  setCount: (n: number) => void;
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
  const [count, setCountState] = useState(10);
  const [slots, setSlots] = useState<Slot[]>(() => makeSlots(10));
  const [steamid, setSteamid] = useState<string | null>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // Switching contract size resets staging — inputs must share one rarity & size.
  const setCount = useCallback((n: number) => {
    setCountState(n);
    setSlots(makeSlots(n));
  }, []);

  const addFromInventory = useCallback((item: InventoryItem) => {
    const prev = slotsRef.current;
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
    next[idx] = { skin, float: item.float ?? skin.min_float, stattrak };
    setSlots(next);
    return { ok: true };
  }, []);

  const value = useMemo(
    () => ({ slots, setSlots, count, setCount, addFromInventory, steamid, setSteamid }),
    [slots, count, setCount, addFromInventory, steamid],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
