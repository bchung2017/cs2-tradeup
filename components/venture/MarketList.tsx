"use client";

// Market Ventures: every contract the last run found, as a list you can cut down
// and reorder. Filter and sort state lives in the URL, so a view can be shared.
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ExpiredFile, Venture, VenturesFile } from "@/lib/ventures";
import { ago, TIER_SHORT } from "@/lib/venture-copy";
import { useNow, useTracked } from "@/lib/venture-store";
import { useVenturePlans } from "@/lib/venture-fit";
import VentureRow from "./VentureRow";
import Ago from "./Ago";
import { ImagesProvider } from "./SkinStack";

const TIERS = ["Consumer Grade", "Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert"];
const NEW_MS = 24 * 3600e3;

type SortKey = keyof typeof SORTS;
const winnerSales = (v: Venture) => {
  const s = v.outcomes.filter((o) => o.win && o.sold24h != null).map((o) => o.sold24h!);
  return s.length ? Math.min(...s) : -1;
};
// Value sorts put contracts that can't be filled or weren't fully checked last:
// their numbers are the least trustworthy, and unsorted they'd top the list.
const TRUST: Record<string, number> = { holds: 0, paper: 1, dead: 2, model: 2, unverified: 3, short: 4 };
const trust = (fn: (a: Venture, b: Venture) => number) => (a: Venture, b: Venture) => TRUST[a.verdict] - TRUST[b.verdict] || fn(a, b);
const SORTS = {
  back: { label: "Most back per $1", fn: trust((a: Venture, b: Venture) => b.backPerDollar - a.backPerDollar) },
  pays: { label: "Highest profit chance", fn: trust((a: Venture, b: Venture) => b.pProfit - a.pProfit) },
  ahead: { label: "Ahead after 5 pulls", fn: trust((a: Venture, b: Venture) => (b.pAhead.at(-1)?.p ?? 0) - (a.pAhead.at(-1)?.p ?? 0)) },
  cheap: { label: "Entry: lowest first", fn: (a: Venture, b: Venture) => a.cost - b.cost },
  pricey: { label: "Entry: highest first", fn: (a: Venture, b: Venture) => b.cost - a.cost },
  jackpot: { label: "Biggest jackpot", fn: trust((a: Venture, b: Venture) => b.best.value - a.best.value) },
  odds: { label: "Best odds at the jackpot", fn: trust((a: Venture, b: Venture) => b.best.probability - a.best.probability) },
  newest: { label: "Newest found", fn: (a: Venture, b: Venture) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt) },
  oldest: { label: "Longest alive", fn: (a: Venture, b: Venture) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt) },
  checked: { label: "Most recently checked", fn: (a: Venture, b: Venture) => Date.parse(b.verifiedAt ?? "0") - Date.parse(a.verifiedAt ?? "0") },
  room: { label: "Most float room", fn: (a: Venture, b: Venture) => (b.float.max - b.float.sum) - (a.float.max - a.float.sum) },
  liquid: { label: "Winners sell fastest", fn: (a: Venture, b: Venture) => winnerSales(b) - winnerSales(a) },
} as const;

export default function MarketList({ data, expired, images }: { data: VenturesFile; expired: ExpiredFile; images: Record<string, string> }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { tracked, toggle } = useTracked();
  const { plans, owned } = useVenturePlans(data.ventures);

  const get = (k: string, d = "") => params.get(k) ?? d;
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  };

  const q = get("q").toLowerCase();
  const tier = get("tier");
  const verdict = get("verdict", "all");
  const minCost = Number(get("min") || 0);
  const maxCost = Number(get("max") || Infinity);
  const minPays = Number(get("pays") || 0) / 100;
  const venue = get("venue");
  const knifeOnly = get("knife") === "1";
  const doppler = get("doppler") === "1";
  const mine = get("mine") === "1";
  const freshH = Number(get("fresh") || 0);
  const sort = (get("sort", "back") in SORTS ? get("sort", "back") : "back") as SortKey;

  // until mounted, judge "new" and "checked within" against the run time, which
  // the server and the browser agree on
  const now = useNow() ?? Date.parse(data.generatedAt);
  const rows = useMemo(() => {
    return data.ventures
      .filter((v) => {
        if (q && ![...v.inputs.map((i) => i.skin), ...v.collections, ...v.outcomes.map((o) => o.name)].some((s) => s.toLowerCase().includes(q))) return false;
        if (tier && v.tier !== tier) return false;
        if (verdict === "holds" && v.verdict !== "holds") return false;
        if (verdict === "near" && v.backPerDollar < 0.85) return false;
        if (verdict === "fillable" && (v.verdict === "short" || v.verdict === "unverified")) return false;
        if (v.cost < minCost || v.cost > maxCost) return false;
        if (v.pProfit < minPays) return false;
        if (venue && v.venue !== venue) return false;
        if (knifeOnly && v.outputTier !== "Extraordinary") return false;
        if (doppler && !v.outcomes.some((o) => /Doppler/.test(o.name))) return false;
        if (mine && !plans.get(v.key)?.ownedCount) return false;
        if (freshH && (!v.verifiedAt || now - Date.parse(v.verifiedAt) > freshH * 3600e3)) return false;
        return true;
      })
      .sort(SORTS[sort].fn);
  }, [data, q, tier, verdict, minCost, maxCost, minPays, venue, knifeOnly, doppler, mine, freshH, sort, plans, now]);

  if (!data.ventures.length) {
    return <p className="vx-empty">No run yet. Run <code>npx tsx scripts/igl9000-ventures.ts</code> or wait for the weekly sync.</p>;
  }

  return (
    <ImagesProvider value={images}>
    <div className="vx-market">
      <form className="vx-filters" onSubmit={(e) => e.preventDefault()}>
        <input className="vx-search" placeholder="skin, collection or outcome…" defaultValue={get("q")} onChange={(e) => set("q", e.target.value)} aria-label="Search" />
        <label>Tier
          <select value={tier} onChange={(e) => set("tier", e.target.value)}>
            <option value="">all</option>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_SHORT[t]} → {t === "Covert" ? "knife" : "next"}</option>)}
          </select>
        </label>
        <label>Show
          <select value={verdict} onChange={(e) => set("verdict", e.target.value === "all" ? "" : e.target.value)}>
            <option value="all">everything</option>
            <option value="near">85¢+ back per $1</option>
            <option value="fillable">can be filled now</option>
            <option value="holds">pays back only</option>
          </select>
        </label>
        <label>Entry $
          <input type="number" min={0} placeholder="min" defaultValue={get("min")} onChange={(e) => set("min", e.target.value)} />
          <input type="number" min={0} placeholder="max" defaultValue={get("max")} onChange={(e) => set("max", e.target.value)} />
        </label>
        <label>Profit chance ≥
          <input type="number" min={0} max={100} placeholder="%" defaultValue={get("pays")} onChange={(e) => set("pays", e.target.value)} />
        </label>
        <label>Bought with
          <select value={venue} onChange={(e) => set("venue", e.target.value)}>
            <option value="">any</option>
            <option value="steam">Steam balance</option>
            <option value="cash">cash (third-party)</option>
          </select>
        </label>
        <label>Checked within
          <select value={get("fresh")} onChange={(e) => set("fresh", e.target.value)}>
            <option value="">any time</option>
            <option value="6">6 hours</option>
            <option value="24">24 hours</option>
            <option value="168">7 days</option>
          </select>
        </label>
        <label className="vx-check"><input type="checkbox" checked={knifeOnly} onChange={(e) => set("knife", e.target.checked ? "1" : "")} /> knives only</label>
        <label className="vx-check"><input type="checkbox" checked={doppler} onChange={(e) => set("doppler", e.target.checked ? "1" : "")} /> has a Doppler</label>
        <label className="vx-check" title={owned ? `inventory from ${ago(owned.at, now)}` : "load your inventory in INVENTORY or My Ventures first"}>
          <input type="checkbox" checked={mine} disabled={!owned} onChange={(e) => set("mine", e.target.checked ? "1" : "")} /> uses items I own
        </label>
        <label>Sort
          <select value={sort} onChange={(e) => set("sort", e.target.value === "back" ? "" : e.target.value)}>
            {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </label>
      </form>

      <p className="vx-count hud">
        {rows.length} of {data.ventures.length} contracts · run <Ago iso={data.generatedAt} />
        {expired.rows.length > 0 && ` · ${expired.rows.filter((r) => now - Date.parse(r.expiredAt) < NEW_MS * 7).length} gone this week`}
      </p>

      <ul className="vx-list">
        {rows.map((v) => (
          <VentureRow
            key={v.key}
            v={v}
            tracked={!!tracked[v.key]}
            onTrack={() => toggle(v.key, v.backPerDollar, v.inputs.map((i) => `${i.count}× ${i.skin}`).join(" + "))}
            plan={plans.get(v.key)}
            isNew={now - Date.parse(v.firstSeenAt) < NEW_MS}
          />
        ))}
      </ul>
      {rows.length === 0 && <p className="vx-empty">Nothing matches. Loosen a filter.</p>}
    </div>
    </ImagesProvider>
  );
}
