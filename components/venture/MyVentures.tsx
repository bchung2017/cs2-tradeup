"use client";

// My Ventures: what your inventory can start. Three parts:
//   1. your reds → knives: each Covert you own, against just selling it, with
//      the best ways to fill the other slots (the longlist)
//   2. market contracts that use skins you own, and what the rest costs
//   3. what you track, and how its return moved since you starred it
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LonglistFile, LonglistRow, VenturesFile } from "@/lib/ventures";
import { useTradeup } from "@/lib/tradeup-context";
import { abbr, ago, backShort, money, oneIn, pct } from "@/lib/venture-copy";
import { loadOwned, markSeen, matchLonglist, useNow, useTracked } from "@/lib/venture-store";
import { useVenturePlans } from "@/lib/venture-fit";
import VentureRow from "./VentureRow";
import Ago from "./Ago";
import SkinStack, { ImagesProvider, type StackItem } from "./SkinStack";

// a longlist contract as pictures: your red, then the filler (one picture if they're the same skin)
function redStack(r: LonglistRow): StackItem[] {
  if (r.filler === r.owned) return [{ key: r.owned, name: r.owned, count: r.ownedCount + r.fillerCount, rarity: "Covert" }];
  return [
    { key: r.owned, name: r.owned, count: r.ownedCount, rarity: "Covert", note: `yours, ${r.ownedWear}` },
    { key: r.filler, name: r.filler, count: r.fillerCount, rarity: "Covert", note: `buy, ${r.fillerWear}` },
  ];
}

const DEFAULT_STEAMID = "76561198059693930";

export default function MyVentures({ market, images }: { market: VenturesFile; images: Record<string, string> }) {
  const { steamid: railSteamid } = useTradeup();
  const { plans, owned } = useVenturePlans(market.ventures);
  const { tracked, toggle } = useTracked();
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
    setStatus(o ? null : "No cached inventory for that profile yet. Load it once in INVENTORY, then come back.");
  }

  const matches = useMemo(() => matchLonglist(owned, longlist?.rows ?? []), [owned, longlist]);
  // a copy you own fits a slot (same skin or a stand-in) inside the float budget
  const usingMine = useMemo(() => market.ventures.filter((v) => plans.get(v.key)?.ownedCount), [market, plans]);

  // visiting this tab clears the nav badge
  useEffect(() => {
    if (matches.size) markSeen([...matches.values()].flat().map((r) => r.key));
  }, [matches]);

  const longByKey = useMemo(() => new Map((longlist?.rows ?? []).map((r) => [r.key, r])), [longlist]);
  const marketByKey = useMemo(() => new Map(market.ventures.map((v) => [v.key, v])), [market]);
  const trackedKeys = Object.keys(tracked);

  return (
    <ImagesProvider value={images}>
    <div className="vx-mine">
      <section className="vx-section">
        <form className="vx-load" onSubmit={(e) => { e.preventDefault(); void load(input || owned?.steamid || DEFAULT_STEAMID); }}>
          <span>{owned ? `Inventory ${owned.steamid} · ${owned.items.reduce((a, i) => a + i.count, 0)} items · read ${ago(owned.at, now ?? Date.parse(owned.at))}` : "No inventory loaded."}</span>
          <input placeholder="steamid64 or profile URL" value={input} onChange={(e) => setInput(e.target.value)} />
          <button type="submit" className="hud">{owned ? "Reload" : "Load"}</button>
          {status && <span className="tone-warn">{status}</span>}
        </form>
      </section>

      <section className="vx-section">
        <h3>Your reds → knives</h3>
        {!owned ? (
          <p className="vx-empty">Load an inventory to see which knife contracts your Coverts can start.</p>
        ) : matches.size === 0 ? (
          <p className="vx-empty">No Covert in this inventory can start a knife contract{longlist?.rows.length ? "" : " (no longlist yet: run the ventures sync)"}.</p>
        ) : (
          [...matches.entries()].map(([item, rows]) => <RedCard key={`${item.name}|${item.wear}`} item={item} rows={rows} tracked={tracked} toggle={toggle} />)
        )}
      </section>

      <section className="vx-section">
        <h3>Market contracts using your skins</h3>
        {usingMine.length === 0 ? (
          <p className="vx-empty">{owned ? "None of the current market contracts has a slot a skin you own can fill inside its float budget." : "Load an inventory first."}</p>
        ) : (
          <ul className="vx-list">
            {usingMine.map((v) => {
              const plan = plans.get(v.key)!;
              return (
                <div key={v.key}>
                  <p className="vx-note">Buy the rest for {money(plan.rest)} (of {money(v.cost)}).</p>
                  <VentureRow v={v} tracked={!!tracked[v.key]} onTrack={() => toggle(v.key, v.backPerDollar, v.inputs.map((i) => `${i.count}× ${i.skin}`).join(" + "))} plan={plan} />
                </div>
              );
            })}
          </ul>
        )}
      </section>

      <section className="vx-section">
        <h3>Tracking</h3>
        {trackedKeys.length === 0 ? (
          <p className="vx-empty">Star a contract here or in <Link href="/venture/market">Market Ventures</Link> to follow it.</p>
        ) : (
          <ul className="vx-list">
            {trackedKeys.map((k) => {
              const t = tracked[k];
              const v = marketByKey.get(k);
              const l = longByKey.get(k);
              const now = v?.backPerDollar ?? l?.backPerDollar;
              const move = now == null ? null : now - t.back;
              return (
                <li key={k} className="vx-row">
                  <div className="vx-line" style={{ gridTemplateColumns: "24px minmax(220px, 1fr) 120px 140px" }}>
                    <button className="vx-star is-on" onClick={() => toggle(k, t.back, t.title)} aria-label="Stop tracking">★</button>
                    <div className="vx-what"><div className="vx-inputs">{t.title}</div><div className="vx-cols dim">starred <Ago iso={t.at} /></div></div>
                    <div className="vx-num"><b>{now == null ? "gone" : backShort(now)}</b><span className="dim">{now == null ? "dropped out of the last run" : "back per $1 now"}</span></div>
                    <div className="vx-num">
                      <b className={move == null ? "" : move >= 0 ? "pos" : "neg"}>{move == null ? `${backShort(t.back)} then` : `${move >= 0 ? "+" : "−"}${Math.abs(Math.round(move * 100))}¢`}</b>
                      <span className="dim">since you starred it</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
    </ImagesProvider>
  );
}

function RedCard({
  item, rows, tracked, toggle,
}: {
  item: { name: string; wear: string; count: number };
  rows: LonglistRow[];
  tracked: Record<string, unknown>;
  toggle: (key: string, back: number, title: string) => void;
}) {
  const sell = rows[0].ownedValue;
  const best = [...rows].sort((a, b) => b.backPerDollar - a.backPerDollar).slice(0, 4);
  return (
    <div className="vx-red">
      <div className="vx-red__head">
        <span><b>{item.count}× {item.name}</b> <span className="dim">({abbr(item.wear)})</span></span>
        <span className="dim">just selling: {money(sell * item.count)} · or put {item.count > 1 ? "them" : "it"} in:</span>
      </div>
      <ul className="vx-red__opts">
        {best.map((r) => {
          const title = `${r.ownedCount}× ${r.owned} + ${r.fillerCount}× ${r.filler}`;
          return (
            <li key={r.key}>
              <button className={`vx-star${tracked[r.key] ? " is-on" : ""}`} onClick={() => toggle(r.key, r.backPerDollar, title)} aria-label="Track">{tracked[r.key] ? "★" : "☆"}</button>
              <span>
                <SkinStack items={redStack(r)} size={38} />
                + {r.fillerCount}× {r.filler} <span className="dim">({r.fillerWear}) @ {money(r.fillerAsk)} · {r.pools.join(" + ")} · {r.knifeItems} knives</span>
              </span>
              <span className="vx-num"><b>{money(r.cost)}</b></span>
              <span className="vx-num"><b className={r.backPerDollar >= 0.9 ? "" : "neg"}>{backShort(r.backPerDollar)}</b></span>
              <span className="vx-num"><b>{pct(r.pProfit)}</b></span>
              <span className="dim">{r.top[0] ? `${oneIn(r.top[0].probability)}: ${r.top[0].name} ${money(r.top[0].value)}` : ""}</span>
            </li>
          );
        })}
      </ul>
      <p className="vx-note">Rough by design: floats at grade middles, fillers at the lowest third-party ask, knives at the top buy order, Doppler phases split evenly. Check the floats before you buy.</p>
    </div>
  );
}
