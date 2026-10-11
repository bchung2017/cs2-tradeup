"use client";

// The results side of a Venture row: the same outcome donut the Simulator
// draws, beside the four most valuable outcomes. Hovering a slice (or one of
// the four) lifts it and opens a card with its picture, chance and profit; on
// a phone a tap does the same, and a second tap closes it.
import { useState } from "react";
import type { Venture, VentureOutcome } from "@/lib/ventures";
import { abbr, money } from "@/lib/venture-copy";
import { rarityHex, signedUsd } from "@/lib/display";
import { arcPath, PIE_COLORS, roiColor } from "@/lib/pie";
import { Thumb, useImages } from "./SkinStack";

const SIZE = 92;

interface Slice { o: VentureOutcome; start: number; end: number; color: string }

export default function OutcomePie({ v }: { v: Venture }) {
  const images = useImages();
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = hover ?? pinned;

  // largest chance first, colored in that order, as in the Simulator
  const byChance = [...v.outcomes].sort((a, b) => b.probability - a.probability);
  const total = byChance.reduce((a, o) => a + o.probability, 0) || 1;
  let acc = 0;
  const slices: Slice[] = byChance.map((o, i) => {
    const start = (acc / total) * 360;
    acc += o.probability;
    return { o, start, end: (acc / total) * 360, color: PIE_COLORS[i % PIE_COLORS.length] };
  });
  const byId = new Map(slices.map((s) => [s.o.skinId, s]));
  const top = [...v.outcomes].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 4);
  const lit = focus ? byId.get(focus) : undefined;

  // Hover is for a mouse only: a tap also fires pointer-enter, which would
  // keep the card up after a second tap meant to close it.
  const enter = (id: string) => (e: React.PointerEvent) => { if (e.pointerType === "mouse") setHover(id); };
  const leave = () => setHover(null);
  const tap = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation(); // the row opens on click; the chart shouldn't
    setPinned((p) => (p === id ? null : id));
  };

  return (
    <div className="vx-out" onPointerLeave={leave}>
      <svg className="vx-pie" viewBox="0 0 100 100" width={SIZE} height={SIZE} role="img" aria-label={`${v.outcomes.length} outcomes by chance`}>
        {slices.map((s) => {
          const on = focus === s.o.skinId;
          const r = on ? 49 : 46;
          const common = {
            fill: s.color,
            stroke: "var(--void)",
            strokeWidth: 0.8,
            opacity: !focus || on ? 1 : 0.3,
            onPointerEnter: enter(s.o.skinId),
            onClick: tap(s.o.skinId),
            style: { cursor: "pointer", transition: "opacity 0.15s" },
          };
          return s.end - s.start >= 359.99
            ? <circle key={s.o.skinId} cx={50} cy={50} r={r} {...common} />
            : <path key={s.o.skinId} d={arcPath(50, 50, r, s.start, s.end)} {...common} />;
        })}
        <circle cx={50} cy={50} r={24} fill="rgba(2, 8, 2, 0.92)" pointerEvents="none" />
        <text x={50} y={49} textAnchor="middle" fontSize={11} fill="var(--fg)" pointerEvents="none">{v.outcomes.length}</text>
        <text x={50} y={60} textAnchor="middle" fontSize={6.5} fill="var(--fg-dim)" pointerEvents="none">OUTCOMES</text>
      </svg>

      <div className="vx-top4">
        {top.map((o) => {
          const s = byId.get(o.skinId)!;
          return (
            <figure
              key={o.skinId}
              className={`vx-top4__cell${focus === o.skinId ? " is-on" : ""}`}
              style={{ borderBottomColor: rarityHex(o.rarity), ["--slice" as string]: s.color }}
              onPointerEnter={enter(o.skinId)}
              onClick={tap(o.skinId)}
            >
              <Thumb src={images[o.skinId]} alt={o.name} w={48} h={36} />
              <figcaption>{money(o.value)}</figcaption>
            </figure>
          );
        })}
      </div>

      {lit && <OutcomeCard s={lit} cost={v.cost} image={images[lit.o.skinId]} />}
    </div>
  );
}

function OutcomeCard({ s, cost, image }: { s: Slice; cost: number; image?: string }) {
  const { o } = s;
  const profit = o.value == null ? null : o.value - cost;
  const roi = profit == null || cost <= 0 ? null : (profit / cost) * 100;
  const tone = roiColor(roi);
  return (
    <div className="vx-outcard" role="tooltip" style={{ borderColor: s.color }}>
      <div className="vx-outcard__img" style={{ borderBottomColor: rarityHex(o.rarity) }}>
        <Thumb src={image} alt={o.name} w={96} h={72} />
      </div>
      <div className="vx-outcard__name">
        <span className="vx-outcard__dot" style={{ background: s.color }} />
        {o.name.replace(/^★ /, "")} <span className="dim">({abbr(o.wear)})</span>
      </div>
      <dl>
        <dt>chance</dt>
        <dd>{(o.probability * 100).toFixed(o.probability < 0.01 ? 2 : 1)}% <span className="dim">· 1 in {Math.max(1, Math.round(1 / o.probability))}</span></dd>
        <dt>sells for</dt>
        <dd>{money(o.value)}{!o.checked && <span className="dim" title="feed price, not checked live"> *</span>}</dd>
        <dt>profit</dt>
        <dd style={{ color: tone }}>{profit == null ? "—" : signedUsd(profit)} {roi != null && <span>({roi >= 0 ? "+" : ""}{roi.toFixed(0)}%)</span>}</dd>
      </dl>
    </div>
  );
}
