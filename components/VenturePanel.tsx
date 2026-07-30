"use client";

// Venture — the route view ("Route View" in the design doc). A left→right
// skill-tree of trade-up contracts (nodes) joined by dependency links, from your
// stash to a destination skin. Driven entirely by the IGL-9000 route model
// (lib/igl9000.ts); IGL-9000 also narrates it in-voice at the top and per-hop.
//
// Design target: pre-attentive (~400ms) legibility — every key fact rides a fast
// visual channel (color/size/fill/position), not text. See the channel map in
// context/modelUIdesignlanguage.md. Styles live under the `v-` prefix in
// globals.css; mobile goes vertical and reduced-motion freezes the pulses there.

import { useState } from "react";
import { signedUsd, usd } from "@/lib/display";
import {
  demoRoute,
  iglBrief,
  iglDestination,
  iglHop,
  oddsLine,
  IS_PREVIEW_ROUTE,
  type Hop,
  type RouteRarity,
} from "@/lib/igl9000";

const RARITY_CLASS: Record<RouteRarity, string> = {
  Restricted: "v-rar-purple",
  Classified: "v-rar-pink",
  Covert: "v-rar-red",
};

const GO_LABEL: Record<Hop["state"], string> = {
  armed: "RUN TRADE-UP",
  "needs-buy": "BUY → ARM",
  locked: "WAITING",
};

export default function VenturePanel() {
  const route = demoRoute();
  const { stash, hops, destination, stats } = route;
  const total = hops.length;

  // The one "selected" hop drives the breadcrumb read-out and IGL-9000's active
  // line. Defaults to the armed hop — the one you can actually fire now.
  const armedIdx = Math.max(0, hops.findIndex((h) => h.state === "armed"));
  const [selected, setSelected] = useState(armedIdx);
  const selHop = hops[selected];

  return (
    // Backdrop (circuit + koi) is rendered once in the root layout, shared across
    // every surface — this panel just sits on top of it.
    <main className="pane pane--venture">
        {/* ── header: title + IGL-9000 shotcaller + the 400ms financials ── */}
        <header className="v-header">
          <div className="v-title">
            <span className="hud hud-ember">venture · route view</span>
            <h1 className="glow">
              <span style={{ color: "var(--green-dim)" }}>$ </span>venture
              <span className="v-route-label"> --route {route.label}</span>
            </h1>
            {IS_PREVIEW_ROUTE && (
              <span className="hud v-preview" title="Route content is a deterministic preview until the live IGL-9000 planner is wired to float/price data.">
                preview route · planner not yet live
              </span>
            )}
          </div>

          <div className="v-stats">
            <div className="v-stat">
              <span className="hud">cash needed</span>
              <span className="v-stat__v v-buyin">{usd(stats.cashNeeded)}</span>
              <span className="v-stat__sub">{stats.buyCount} skins to buy</span>
            </div>
            <div className="v-stat">
              <span className="hud">likely end value</span>
              <span className="v-stat__v">{usd(stats.likelyEndValue)}</span>
              <span className="v-stat__sub">if odds run normal</span>
            </div>
            <div className="v-stat">
              <span className="hud">vs. just selling it all</span>
              <span className={`v-stat__v ${stats.netVsSelling >= 0 ? "v-net-pos" : "v-net-neg"}`}>
                {signedUsd(stats.netVsSelling)}
              </span>
              <span className="v-stat__sub">whole route, after fees</span>
            </div>
          </div>
        </header>

        {/* ── IGL-9000 shotcaller readout ── */}
        <section className="v-igl" aria-label="IGL-9000">
          <div className="v-igl__tag">
            <span className="v-igl__badge">IGL-9000</span>
            <span className="hud">shotcaller</span>
          </div>
          <p className="v-igl__brief">{iglBrief(route)}</p>
        </section>

        {/* ── breadcrumb: how far the route is lit ── */}
        <div className="v-crumbs">
          {hops.map((h, i) => (
            <span key={h.hop} className={`v-dot${i <= selected ? " done" : ""}`} />
          ))}
          <span className="hud v-crumbs__lbl">
            hop {selHop.hop} of {total} ·{" "}
            {selHop.state === "armed" ? "ready to fire" : selHop.state === "needs-buy" ? "buy to arm" : "waiting upstream"}
          </span>
        </div>

        {/* ── the route rail ── */}
        <div className="v-route">
          {/* START — your stash */}
          <div className="v-node v-start">
            <div className="v-rank">
              <span className="hud">start</span>
              <span className="hud">your stash</span>
            </div>
            <div className="v-stash-count">{stash.count} skins</div>
            <div className="v-stash-val">sell-now: {usd(stash.sellNow)}</div>
            <div className="v-slots">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="v-slot own" />
              ))}
            </div>
            <div className="hud">this route uses {stash.used} of them</div>
          </div>

          {hops.map((h, i) => (
            <VentureHop
              key={h.hop}
              hop={h}
              selected={i === selected}
              onSelect={() => setSelected(i)}
              // the link feeding THIS hop is cold once the hop is locked
              incomingCold={h.state === "locked"}
            />
          ))}

          {/* link into the destination — cold if the last hop hasn't landed */}
          <div className={`v-link${hops[hops.length - 1].state !== "armed" ? " cold" : ""}`}>
            <div className="v-pulse" />
          </div>

          {/* DESTINATION */}
          <div className={`v-node v-dest ${RARITY_CLASS[destination.rarity]}`}>
            <span className="v-bk" />
            <div className="v-rank">
              <span className="hud">destination</span>
              <span className="v-tier">{destination.rarity.toUpperCase()}</span>
            </div>
            <div className="v-skin-name">
              {destination.skinName}
              <span className="hud">
                {destination.wear.toLowerCase()} · float ~{destination.floatApprox.toFixed(2)}
              </span>
            </div>
            <div className="v-payout">{usd(destination.payout)}</div>
            <div className="v-spread">
              <span>rough day <b>{usd(destination.spread.p10)}</b></span>
              <span>normal <b>{usd(destination.spread.p50)}</b></span>
              <span>lucky <b>{usd(destination.spread.p90)}</b></span>
            </div>
            <div className="v-odds-note">{oddsLine(destination)}</div>
          </div>
        </div>

        {/* IGL-9000's line about whatever hop is selected + the destination */}
        <section className="v-igl v-igl--sub">
          <p className="v-igl__line">
            <span className="v-igl__badge v-igl__badge--sm">IGL-9000</span>
            {iglHop(selHop)}
          </p>
          <p className="v-igl__line v-igl__line--dim">{iglDestination(destination)}</p>
        </section>
      </main>
  );
}

function VentureHop({
  hop,
  selected,
  onSelect,
  incomingCold,
}: {
  hop: Hop;
  selected: boolean;
  onSelect: () => void;
  incomingCold: boolean;
}) {
  return (
    <>
      <div className={`v-link${incomingCold ? " cold" : ""}`}>
        <div className="v-pulse" />
      </div>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={[
          "v-node",
          RARITY_CLASS[hop.rarity],
          hop.state === "locked" ? "locked" : "",
          selected ? "is-selected" : "",
        ].join(" ")}
      >
        <div className="v-rank">
          <span className="v-tier">
            {hop.rarity.toUpperCase()} {hop.contractSize === 5 ? "SHOT" : `×${hop.contractSize}`}
          </span>
          <span className="hud">hop {hop.hop}</span>
        </div>

        {/* the money number — biggest thing on the card; shown even when locked */}
        <div className={`v-delta ${hop.delta >= 0 ? "pos" : "neg"}${hop.state === "locked" ? " muted" : ""}`}>
          {signedUsd(hop.delta)}
          <span className="v-vs">vs. selling these {hop.contractSize}</span>
        </div>

        <div className="v-slots">
          {hop.slots.map((s, i) => (
            <div key={i} className={`v-slot ${s}`} />
          ))}
        </div>

        {/* status line — one hue, one meaning */}
        {hop.state === "armed" && <div className="v-ready">all {hop.contractSize} in stash · float on target</div>}
        {hop.state === "needs-buy" && hop.need && (
          <div className="v-need">
            need <b>{hop.need.count} more</b> · buy ~<b>{usd(hop.need.buyCost)}</b> · unlocks in {hop.need.unlockDays}d
          </div>
        )}
        {hop.state === "locked" && <div className="v-locked-msg">{hop.waitsOn}</div>}

        {/* GO affordance — reflects state; exactly one is armed across the route */}
        <span
          className={[
            "v-go",
            hop.state === "armed" ? "armed" : "",
            hop.state === "needs-buy" ? "buy-first" : "",
          ].join(" ")}
        >
          {hop.state === "needs-buy" && hop.need ? `BUY ${hop.need.count} → ARM` : GO_LABEL[hop.state]}
        </span>
      </button>
    </>
  );
}
