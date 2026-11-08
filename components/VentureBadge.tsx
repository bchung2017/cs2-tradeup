"use client";

// Once an inventory is loaded (INVENTORY tab or My Ventures), check its
// Coverts against the knife longlist and light the VENTURE badge with the
// count of matches not yet seen on My Ventures. Draws nothing itself.
import { useEffect } from "react";
import type { LonglistFile } from "@/lib/ventures";
import { useTradeup } from "@/lib/tradeup-context";
import { loadOwned, matchLonglist, seenKeys, setBadge, useOwned } from "@/lib/venture-store";

export default function VentureBadge() {
  const { steamid } = useTradeup();
  const owned = useOwned();

  // refresh the owned list when the INVENTORY tab loads a profile
  useEffect(() => {
    if (steamid && steamid !== owned?.steamid) void loadOwned(steamid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steamid]);

  useEffect(() => {
    if (!owned) return;
    let live = true;
    fetch("/data/ventures-longlist.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LonglistFile | null) => {
        if (!live || !d) return;
        const matches = matchLonglist(owned, d.rows);
        const seen = seenKeys();
        const fresh = [...matches.values()].flat().filter((r) => !seen.has(r.key));
        setBadge(new Set(fresh.map((r) => `${r.owned}|${r.ownedWear}`)).size);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owned]);

  return null;
}
