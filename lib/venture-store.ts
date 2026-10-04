"use client";

// Per-browser Venture state, in localStorage until accounts exist (then it moves
// to lib/store.ts): tracked contracts, the owned items the inventory reported,
// and the count of new matches the nav badge shows. Changes are broadcast with a
// window event so every mounted component stays in step.
import { useCallback, useEffect, useState } from "react";

export interface Tracked { at: string; back: number; title: string }
export interface OwnedItem { name: string; wear: string; count: number; statTrak: boolean; rarity: string | null; price: number | null }
export interface Owned { steamid: string; at: string; items: OwnedItem[] }

const K_TRACKED = "ventures:tracked";
const K_OWNED = "ventures:owned";
const K_BADGE = "ventures:badge";
const EVENT = "ventures:changed";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota: the surface still works for this page view
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

function useStored<T>(key: string, fallback: T): T {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    const load = () => setV(read(key, fallback));
    load();
    const onChange = (e: Event) => {
      const k = e instanceof StorageEvent ? e.key : (e as CustomEvent).detail;
      if (k === key) load();
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
    // fallback is a literal at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return v;
}

export function useTracked() {
  const tracked = useStored<Record<string, Tracked>>(K_TRACKED, {});
  const toggle = useCallback((key: string, back: number, title: string) => {
    const cur = read<Record<string, Tracked>>(K_TRACKED, {});
    if (cur[key]) delete cur[key];
    else cur[key] = { at: new Date().toISOString(), back, title };
    write(K_TRACKED, cur);
  }, []);
  return { tracked, toggle };
}

export const useOwned = () => useStored<Owned | null>(K_OWNED, null);
export const setOwned = (o: Owned) => write(K_OWNED, o);

export const useBadge = () => useStored<number>(K_BADGE, 0);
export const setBadge = (n: number) => write(K_BADGE, n);

// "AK-47 | Head Shot (Battle-Scarred)" → skin + wear; StatTrak and Souvenir
// marked so matching can skip them (the longlist is non-StatTrak only).
export function parseMarketName(name: string): { skin: string; wear: string; statTrak: boolean; souvenir: boolean } | null {
  const m = /^(.*) \(([^)]+)\)$/.exec(name);
  if (!m) return null;
  const statTrak = /StatTrak/i.test(m[1]);
  const souvenir = /^Souvenir\s/i.test(m[1]);
  const skin = m[1].replace(/^StatTrak™?\s*/i, "").replace(/^Souvenir\s*/i, "").trim();
  return { skin, wear: m[2], statTrak, souvenir };
}

// Inventory API items → owned list, grouped by skin + wear.
export function ownedFromInventory(
  steamid: string,
  items: { name: string | null; rarity: string | null; price?: number | null }[],
): Owned {
  const byKey = new Map<string, OwnedItem>();
  for (const it of items) {
    if (!it.name || it.name.includes("★")) continue;
    const p = parseMarketName(it.name);
    if (!p || p.souvenir) continue;
    const k = `${p.statTrak ? "ST|" : ""}${p.skin}|${p.wear}`;
    const cur = byKey.get(k) ?? { name: p.skin, wear: p.wear, count: 0, statTrak: p.statTrak, rarity: it.rarity, price: it.price ?? null };
    cur.count++;
    byKey.set(k, cur);
  }
  return { steamid, at: new Date().toISOString(), items: [...byKey.values()] };
}

// Fetch the cached inventory snapshot for a steamid (the INVENTORY tab syncs it)
// and keep the owned list. null = no snapshot yet.
export async function loadOwned(steamid: string): Promise<Owned | null> {
  const r = await fetch(`/api/inventory/${steamid}`);
  if (!r.ok) return null;
  const body = (await r.json()) as { items?: { name: string | null; rarity: string | null; price?: number | null }[] };
  const owned = ownedFromInventory(steamid, body.items ?? []);
  setOwned(owned);
  return owned;
}

const WEAR_TO_ABBR: Record<string, string> = { "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS" };

// Owned non-StatTrak items → their longlist rows (knife contracts that start
// from them), keeping only rows that need no more copies than you hold.
export function matchLonglist<R extends { owned: string; ownedWear: string; ownedCount: number }>(owned: Owned | null, rows: R[]): Map<OwnedItem, R[]> {
  const out = new Map<OwnedItem, R[]>();
  if (!owned) return out;
  const index = new Map<string, R[]>();
  for (const r of rows) {
    const k = `${r.owned}|${r.ownedWear}`;
    const list = index.get(k) ?? [];
    list.push(r);
    index.set(k, list);
  }
  for (const it of owned.items) {
    if (it.statTrak) continue;
    const hits = (index.get(`${it.name}|${WEAR_TO_ABBR[it.wear] ?? it.wear}`) ?? []).filter((r) => r.ownedCount <= it.count);
    if (hits.length) out.set(it, hits);
  }
  return out;
}

const K_SEEN = "ventures:seen";
export const seenKeys = (): Set<string> => new Set(read<string[]>(K_SEEN, []));
export const markSeen = (keys: string[]) => {
  write(K_SEEN, [...new Set([...seenKeys(), ...keys])].slice(-5000));
  setBadge(0);
};
