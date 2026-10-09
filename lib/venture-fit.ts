"use client";

// Which of a contract's slots your own skins can fill. An owned copy fills a slot
// when it's the same skin or a stand-in (same collection, same rarity: the
// outcome pool and odds don't change), it isn't StatTrak or Souvenir, its float
// is known, and swapping it in keeps the contract inside its float budget.
// Contracts are priced with every input at its float cap, so the budget check
// per swap is  sum − norm(cap) + norm(owned) ≤ max.
import { useEffect, useMemo, useState } from "react";
import type { Skin } from "@/types/cs2";
import type { Venture, VentureInput } from "@/lib/ventures";
import { loadOwned, useOwned, type Owned } from "@/lib/venture-store";

export interface FitOwned { assetid: string; float: number; name: string; wear: string; price: number | null; skin: Skin }
export interface FitSlot { input: VentureInput; skin: Skin; owned: FitOwned | null }
export interface Plan {
  slots: FitSlot[];
  ownedCount: number;
  sum: number; // float budget used with the owned copies swapped in
  rest: number; // what the to-buy slots cost
}
interface Meta { skins: Record<string, Skin>; nameToId: Record<string, string> }

const norm = (f: number, s: Skin) => (s.max_float > s.min_float ? (f - s.min_float) / (s.max_float - s.min_float) : 0);

export function planFill(v: Venture, owned: Owned | null, meta: Meta): Plan | null {
  const slots: (FitSlot & { cap: number })[] = [];
  for (const input of v.inputs) {
    const skin = meta.skins[input.skinId];
    if (!skin) return null;
    for (let k = 0; k < input.count; k++) slots.push({ input, skin, owned: null, cap: norm(input.floatMax, skin) });
  }

  const copies: (FitOwned & { n: number })[] = [];
  for (const it of owned?.items ?? []) {
    if (it.statTrak) continue;
    const skin = meta.skins[meta.nameToId[it.name] ?? ""];
    if (!skin || skin.souvenir) continue;
    for (const c of it.copies ?? []) {
      if (c.float == null) continue;
      copies.push({ assetid: c.assetid, float: c.float, name: it.name, wear: it.wear, price: c.price, skin, n: norm(c.float, skin) });
    }
  }
  copies.sort((a, b) => a.n - b.n);

  let sum = v.float.sum;
  for (const c of copies) {
    const open = slots.filter(
      (s) => !s.owned && s.skin.rarity.name === c.skin.rarity.name && c.skin.collections.some((col) => col.name === s.input.collection),
    );
    if (!open.length) continue;
    // Exact skin first, then the slot whose cap frees the most budget.
    open.sort((a, b) => Number(b.skin.id === c.skin.id) - Number(a.skin.id === c.skin.id) || b.cap - a.cap);
    const s = open[0];
    const next = sum - s.cap + c.n;
    if (next > v.float.max + 1e-9) continue;
    const { n: _n, ...fit } = c;
    void _n;
    s.owned = fit;
    sum = next;
  }

  const out = slots.map(({ cap: _cap, ...s }) => { void _cap; return s; });
  return {
    slots: out,
    ownedCount: out.filter((s) => s.owned).length,
    sum,
    rest: out.reduce((a, s) => a + (s.owned ? 0 : s.input.priceEach ?? 0), 0),
  };
}

// Green light: you hold a usable copy and the contract still pays at live prices.
export const isReady = (v: Venture, plan: Plan | null | undefined) => v.verdict === "holds" && !!plan && plan.ownedCount > 0;

const metaCache = new Map<string, Meta>();

// Plans for a list of contracts against the loaded inventory, keyed by contract.
// Fetches catalog records for the input skins and the owned skins once per set.
export function useVenturePlans(ventures: Venture[]): { plans: Map<string, Plan>; owned: Owned | null } {
  const owned = useOwned();
  const [meta, setMeta] = useState<Meta | null>(null);

  // Inventories cached before copies were kept carry no floats: read them again.
  useEffect(() => {
    if (owned && owned.items.length && !owned.items.some((i) => i.copies)) void loadOwned(owned.steamid);
  }, [owned]);

  const ids = useMemo(() => [...new Set(ventures.flatMap((v) => v.inputs.map((i) => i.skinId)))].sort(), [ventures]);
  const names = useMemo(() => [...new Set((owned?.items ?? []).filter((i) => !i.statTrak).map((i) => i.name))].sort(), [owned]);

  useEffect(() => {
    if (!ids.length) return;
    const key = `${ids.join(",")}#${names.join(",")}`;
    const hit = metaCache.get(key);
    if (hit) return setMeta(hit);
    let live = true;
    fetch("/api/skins/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, names }) })
      .then((r) => (r.ok ? (r.json() as Promise<Meta>) : null))
      .then((m) => {
        if (!m || !live) return;
        metaCache.set(key, m);
        setMeta(m);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [ids, names]);

  const plans = useMemo(() => {
    const out = new Map<string, Plan>();
    if (!meta) return out;
    for (const v of ventures) {
      const p = planFill(v, owned, meta);
      if (p) out.set(v.key, p);
    }
    return out;
  }, [ventures, owned, meta]);

  return { plans, owned };
}
