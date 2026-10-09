"use client";

// One contract, collapsed to a line you can scan: what goes in, what it costs,
// how much comes back, the jackpot and its odds, the float budget, freshness and
// the verdict. Click to open the full recipe.
import { useState } from "react";
import { bestOutcome, type Venture } from "@/lib/ventures";
import { rarityHex } from "@/lib/display";
import { abbr, backShort, money, pct, TIER_SHORT, VERDICT } from "@/lib/venture-copy";
import VentureDetail from "./VentureDetail";
import Ago from "./Ago";
import { isReady, type Plan } from "@/lib/venture-fit";
import SkinStack, { GrandPrize, stackInputs } from "./SkinStack";

export default function VentureRow({
  v, tracked, onTrack, plan, isNew, open: openInit = false,
}: {
  v: Venture;
  tracked: boolean;
  onTrack: () => void;
  plan?: Plan | null;
  isNew?: boolean;
  open?: boolean;
}) {
  const [open, setOpen] = useState(openInit);
  const verdict = VERDICT[v.verdict];
  const room = v.float.max - v.float.sum;
  const ready = isReady(v, plan);
  const best = bestOutcome(v);
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
          <SkinStack items={stackInputs(v.inputs)} />
          <div className="vx-inputs">
            {v.inputs.map((i) => (
              <span key={`${i.skinId}|${i.wear}`}>{i.count}× {i.skin} <span className="dim">{abbr(i.wear)} ≤{i.floatMax.toFixed(2)}</span></span>
            ))}
          </div>
          <div className="vx-cols dim">
            {v.collections.map((c) => c.replace(/^The /, "").replace(/ Collection$/, "")).join(" + ")} · {v.outcomes.length} outcomes
            {isNew && <span className="vx-new">NEW</span>}
            {ready && <span className="vx-ready" title={`Ready: ${plan!.ownedCount} slot${plan!.ownedCount > 1 ? "s" : ""} from your inventory fit the float budget, and the contract holds at live prices`} aria-label="ready with skins you own">●</span>}
          </div>
        </div>

        <div className="vx-num vx-num--cost"><b>{money(v.cost)}</b><span className="dim">entry</span></div>
        <div className="vx-num vx-num--back"><b className={v.backPerDollar >= 1 ? "pos" : v.backPerDollar >= 0.85 ? "" : "neg"}>{backShort(v.backPerDollar)}</b><span className="dim">back per $1</span></div>
        <div className="vx-num vx-num--pays" title="Chance one contract's outcome sells for more than the entry cost (not the grand prize odds)"><b>{pct(v.pProfit)}</b><span className="dim">profit chance</span></div>
        <div className="vx-jackpot">
          <GrandPrize imageKey={best?.skinId ?? ""} name={v.best.name} value={money(v.best.value)} probability={v.best.probability} rarity={best?.rarity} />
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
      {open && <VentureDetail v={v} plan={plan} />}
    </li>
  );
}
