"use client";

// My Ventures: every contract your inventory can start, as one list exactly
// like Market Ventures. Two kinds of row, mixed and sorted together:
//   - knife contracts your reds start (the longlist, expanded to full contracts)
//   - market contracts with a slot your skins fit inside its float budget
import { useEffect, useMemo, useState } from "react";
import type { LonglistFile, Venture, VenturesFile } from "@/lib/ventures";
import { useTradeup } from "@/lib/tradeup-context";
import { ago } from "@/lib/venture-copy";
import { loadOwned, markSeen, matchLonglist, useNow } from "@/lib/venture-store";
import { useVenturePlans } from "@/lib/venture-fit";
import { longlistVenture } from "@/lib/longlist-venture";
import MarketList from "./MarketList";

const DEFAULT_STEAMID = "76561198059693930";
const NO_EXPIRED = { rows: [] };

export default function MyVentures({ market, images }: { market: VenturesFile; images: Record<string, string> }) {
  const { steamid: railSteamid } = useTradeup();
  const { plans, owned } = useVenturePlans(market.ventures);
  const [longlist, setLonglist] = useState<LonglistFile | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    fetch("/data/ventures-longlist.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LonglistFile | null) => setLonglist(d ?? { generatedAt: "", rows: [] }))
      .catch(() => setLonglist({ generatedAt: "", rows: [] }));
  }, []);

  // pick up the profile the INVENTORY tab loaded, once
  useEffect(() => {
    if (railSteamid && railSteamid !== owned?.steamid) void load(railSteamid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railSteamid]);

  async function load(id: string) {
    const steamid = (id.match(/\d{17}/)?.[0] ?? id).trim();
    if (!steamid) return;
    setStatus("loading inventory…");
    const o = await loadOwned(steamid);
    setStatus(o ? null : "No cached inventory for that profile. Load it in INVENTORY first.");
  }

  const matches = useMemo(() => matchLonglist(owned, longlist?.rows ?? []), [owned, longlist]);

  // visiting this tab clears the nav badge
  useEffect(() => {
    if (matches.size) markSeen([...matches.values()].flat().map((r) => r.key));
  }, [matches]);

  const list: VenturesFile = useMemo(() => {
    const byKey = new Map<string, Venture>();
    for (const v of market.ventures) if (plans.get(v.key)?.ownedCount) byKey.set(v.key, v);
    if (longlist) {
      for (const r of [...matches.values()].flat()) {
        const v = byKey.has(r.key) ? null : longlistVenture(r, longlist);
        if (v) byKey.set(v.key, v);
      }
    }
    return { generatedAt: longlist?.generatedAt || market.generatedAt, ventures: [...byKey.values()] };
  }, [market, plans, matches, longlist]);

  return (
    <div className="vx-mine">
      <form className="vx-load" onSubmit={(e) => { e.preventDefault(); void load(input || owned?.steamid || DEFAULT_STEAMID); }}>
        <span>{owned ? `Inventory ${owned.steamid} · ${owned.items.reduce((a, i) => a + i.count, 0)} items · read ${ago(owned.at, now ?? Date.parse(owned.at))}` : "No inventory loaded."}</span>
        <input placeholder="steamid64 or profile URL" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="hud">{owned ? "Reload" : "Load"}</button>
        {status && <span className="tone-warn">{status}</span>}
      </form>
      {!owned ? (
        <p className="vx-empty">Load an inventory to see every contract it can start.</p>
      ) : !longlist ? (
        <p className="vx-empty">Loading contracts…</p>
      ) : (
        <MarketList data={list} expired={NO_EXPIRED} images={images} mine />
      )}
    </div>
  );
}
