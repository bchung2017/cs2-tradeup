"use client";

// One contract, collapsed to a line you can scan: what goes in, what it costs,
// how much comes back, the jackpot and its odds, the float budget, freshness and
// the verdict. Click to open the full recipe.
import { useState } from "react";
import type { Venture } from "@/lib/ventures";
import { rarityHex } from "@/lib/display";
import { abbr, backShort, money, oneIn, pct, TIER_SHORT, VERDICT } from "@/lib/venture-copy";
import VentureDetail from "./VentureDetail";
import Ago from "./Ago";

export default function VentureRow({
  v, tracked, onTrack, owned, isNew, open: openInit = false,
}: {
  v: Venture;
  tracked: boolean;
  onTrack: () => void;
  owned?: Set<string>;
  isNew?: boolean;
  open?: boolean;
}) {
  const [open, setOpen] = useState(openInit);
  const verdict = VERDICT[v.verdict];
  const room = v.float.max - v.float.sum;
  const mine = owned ? v.inputs.filter((i) => owned.has(`${i.skin}|${i.wear}`)).length : 0;
  return (
    <li className={`vx-row${open ? " is-open" : ""}`} id={v.key}>
      <div className="vx-line" onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((o) => !o)} aria-expanded={open}>
        <button
          className={`vx-star${tracked ? " is-on" : ""}`}
          onClick={(e) => { e.stopPropagation(); onTrack(); }}
          aria-label={tracked ? "Stop tracking" : "Track this contract"}
          title={tracked ? "Tracking" : "Track"}
        >{tracked ? "★" : "☆"}</button>

        <div className="vx-tiers">
          <span style={{ color: rarityHex(v.tier) }}>{TIER_SHORT[v.tier] ?? v.tier}</span>
          <span className="dim">→</span>
          <span style={{ color: rarityHex(v.outputTier) }}>{TIER_SHORT[v.outputTier] ?? v.outputTier}</span>
        </div>

        <div className="vx-what">
          <div className="vx-inputs">
            {v.inputs.map((i) => (
              <span key={`${i.skinId}|${i.wear}`}>{i.count}× {i.skin} <span className="dim">{abbr(i.wear)} ≤{i.floatMax.toFixed(2)}</span></span>
            ))}
          </div>
          <div className="vx-cols dim">
            {v.collections.map((c) => c.replace(/^The /, "").replace(/ Collection$/, "")).join(" + ")} · {v.outcomes.length} outcomes
            {isNew && <span className="vx-new">NEW</span>}
            {mine > 0 && <span className="vx-own">you own {mine === v.inputs.length ? "all" : `${mine} of ${v.inputs.length}`} skin{v.inputs.length > 1 ? "s" : ""}</span>}
          </div>
        </div>

        <div className="vx-num vx-num--cost"><b>{money(v.cost)}</b><span className="dim">entry</span></div>
        <div className="vx-num vx-num--back"><b className={v.backPerDollar >= 1 ? "pos" : v.backPerDollar >= 0.85 ? "" : "neg"}>{backShort(v.backPerDollar)}</b><span className="dim">back per $1</span></div>
        <div className="vx-num vx-num--pays"><b>{pct(v.pProfit)}</b><span className="dim">pull pays</span></div>
        <div className="vx-jackpot">
          <b>{money(v.best.value)}</b>
          <span className="dim" title={v.best.name}>{oneIn(v.best.probability)} · {v.best.name.replace(/^★ /, "")}</span>
        </div>
        <div className="vx-room" title={`float budget: ${v.float.sum.toFixed(3)} of ${v.float.max.toFixed(3)}`}>
          <div className="vx-room__bar"><div style={{ width: `${Math.min(100, (v.float.sum / v.float.max) * 100)}%`, background: room < 0.02 ? "var(--amber)" : "var(--green-dim)" }} /></div>
          <span className="dim">{room < 0.0005 ? "no float room" : `${room.toFixed(3)} room`}</span>
        </div>
        <div className="vx-fresh">
          <span className={`vx-chip tone-${verdict.tone}`} title={verdict.note}>{verdict.label}</span>
          <span className="dim">checked <Ago iso={v.verifiedAt} /></span>
        </div>
      </div>
      {open && <VentureDetail v={v} owned={owned} />}
    </li>
  );
}
