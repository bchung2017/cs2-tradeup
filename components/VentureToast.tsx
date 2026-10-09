"use client";

// The neuron activation. Once an inventory is loaded (INVENTORY tab or My
// Ventures), check its Coverts against the knife longlist; if one can start a
// knife contract, say so once a session and light the VENTURE badge with the
// count of matches not yet seen on My Ventures.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LonglistFile, LonglistRow } from "@/lib/ventures";
import { useTradeup } from "@/lib/tradeup-context";
import { money, oneIn } from "@/lib/venture-copy";
import { loadOwned, matchLonglist, seenKeys, setBadge, useOwned } from "@/lib/venture-store";

const SESSION_KEY = "ventures:toasted";

export default function VentureToast() {
  const { steamid } = useTradeup();
  const owned = useOwned();
  const pathname = usePathname();
  const [toast, setToast] = useState<{ item: string; row: LonglistRow } | null>(null);

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
        let toasted = false;
        try {
          toasted = sessionStorage.getItem(SESSION_KEY) === owned.steamid;
        } catch {}
        if (toasted || pathname.startsWith("/venture/mine") || !matches.size) return;
        // the line worth saying: the match with the most valuable possible pull
        let pick: { item: string; row: LonglistRow } | null = null;
        for (const [item, rows] of matches) {
          for (const row of rows) {
            if (!pick || (row.top[0]?.value ?? 0) > (pick.row.top[0]?.value ?? 0)) pick = { item: item.name, row };
          }
        }
        setToast(pick);
        try {
          sessionStorage.setItem(SESSION_KEY, owned.steamid);
        } catch {}
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owned, pathname]);

  if (!toast) return null;
  const top = toast.row.top[0];
  return (
    <div className="vx-toast" role="status">
      <button className="vx-toast__x" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
      <span className="hud hud-ember">IGL-9000</span>
      <p style={{ margin: "4px 0 6px" }}>
        Your <b>{toast.item}</b> can roll a <b>{top.name}</b>, {money(top.value)}. {oneIn(top.probability)} pulls.
      </p>
      <Link href="/venture/mine" onClick={() => setToast(null)}>What it takes →</Link>
    </div>
  );
}
