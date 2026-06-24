"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CircuitBoard from "@/components/CircuitBoard";
import SkinPicker from "@/components/SkinPicker";
import PriceModal, { marketName, wearFromFloat } from "@/components/PriceModal";
import { oddsString, rarityColor, rarityHex, signedUsd, usd } from "@/lib/display";
import { makeSlots, useTradeup } from "@/lib/tradeup-context";
import type { Rarity, Skin, TradeupOutcome, TradeupResult } from "@/types/cs2";

export default function TradeUpConsole() {
  const { slots, setSlots, count } = useTradeup();
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [result, setResult] = useState<TradeupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // market_hash_name of the price whose marketplace breakdown is open, or null.
  // Open price modal: the item's market_hash_name plus its per-marketplace
  // breakdown (so the modal shows the same numbers the inventory side does).
  const [priceModal, setPriceModal] = useState<{
    name: string;
    priceSources?: Record<string, number> | null;
  } | null>(null);

  // StatTrak is no longer a manual toggle — the contract inherits it from the
  // first staged item (inventory enforces all inputs share that state).
  const firstSlot = slots.find((s) => s.skin);
  const isStatTrak = firstSlot?.stattrak ?? false;

  // Slots can change from the inventory side too; drop any stale computed result.
  useEffect(() => {
    setResult(null);
  }, [slots]);

  const filled = slots.filter((s) => s.skin).length;
  const lockedRarity: Rarity | null = useMemo(() => {
    const first = slots.find((s) => s.skin);
    return first?.skin?.rarity.name ?? null;
  }, [slots]);

  function pick(i: number, skin: Skin) {
    setSlots((prev) => {
      const next = [...prev];
      // Catalog picks carry no StatTrak; inherit the contract's current state.
      // No market price is resolved for catalog picks, so price stays null.
      next[i] = { skin, float: skin.min_float, stattrak: prev.find((s) => s.skin)?.stattrak ?? false, price: null };
      return next;
    });
    setPickerFor(null);
    setResult(null);
  }

  function clearSlot(i: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = { skin: null, float: 0, stattrak: false };
      return next;
    });
    setResult(null);
  }

  async function execute() {
    setError(null);
    setRunning(true);
    setResult(null);
    try {
      const inputs = slots.map((s) => {
        const skin = s.skin!;
        // For inventory items (synthetic `inv-` id) send the reconstructed
        // "Weapon | Paint" market name so the server can match a catalog skin.
        // Catalog picks already resolve by id, so they need no name.
        const marketName = skin.id.startsWith("inv-") ? `${skin.weapon.name} | ${skin.name}` : undefined;
        return { skinId: skin.id, float: s.float, marketName };
      });
      const res = await fetch("/api/tradeup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, isStatTrak }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Trade-up failed");
      } else {
        setResult(data as TradeupResult);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <CircuitBoard intensity={filled / count} surge={running} />
      <main
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: "40px 24px 20px",
          position: "relative",
          zIndex: 1,
        }}
      >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--surface-line)",
          padding: "22px 22px 24px",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 8px 40px rgba(0,0,0,0.7)",
        }}
      >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <span className="hud hud-ember">TRADE-UP CONSOLE</span>
          <h1
            className="glow"
            style={{
              fontFamily: "var(--mono)",
              fontWeight: 700,
              fontSize: 34,
              margin: "6px 0 0",
              letterSpacing: "-0.01em",
              color: "var(--green)",
            }}
          >
            <span style={{ color: "var(--green-dim)" }}>$ </span>
            tradeup
          </h1>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {/* contract size auto-derives from the first staged item: a knife → ×5,
              anything else (or empty) → ×10. No manual toggle. */}
          <div className="hud" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>CONTRACT</span>
            <span style={{ color: "var(--ember)" }}>
              {count === 5 ? "KNIFE ×5" : "STANDARD ×10"}
            </span>
          </div>
          {isStatTrak && (
            <span className="hud" style={{ color: "var(--ember)" }}>
              ★ STATTRAK CONTRACT
            </span>
          )}
        </div>
      </header>

      <div className="hud" style={{ marginTop: 18, display: "flex", gap: 24 }}>
        <span>
          INPUTS <span className="hud-ember">{filled}/{count}</span>
        </span>
        <span>
          RARITY{" "}
          <span style={{ color: lockedRarity ? rarityColor(lockedRarity) : "var(--cream-dim)" }}>
            {lockedRarity ?? "—"}
          </span>
        </span>
      </div>

      {/* slot grid */}
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 8,
        }}
      >
        {slots.map((slot, i) => (
          <div
            key={i}
            className="bracket"
            style={{
              border: slot.skin
                ? `3px solid ${rarityHex(slot.skin.rarity.name)}`
                : "1px dashed var(--surface-line)",
              background: slot.skin ? "var(--surface-2)" : "var(--void)",
              padding: "8px",
              minHeight: 150,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span className="hud">{String(i + 1).padStart(2, "0")}</span>
            </div>

            {slot.skin ? (
              <>
                {/* Click the staged item to clear the slot — inventory items
                    return to the right-side grid. */}
                <div
                  onClick={() => clearSlot(i)}
                  role="button"
                  title="Click to return to inventory"
                  style={{ cursor: "pointer" }}
                >
                  {slot.skin.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={slot.skin.image}
                      alt={slot.skin.name}
                      style={{ width: "100%", height: 56, objectFit: "contain" }}
                    />
                  ) : (
                    <div style={{ height: 56 }} />
                  )}
                  <div>
                    <div style={{ fontSize: 10, color: "var(--cream-dim)" }}>
                      {slot.stattrak && <span style={{ color: "var(--ember)" }}>ST </span>}
                      {slot.skin.weapon.name}
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.2 }}>{slot.skin.name}</div>
                  </div>
                </div>
                {/* Float is fixed by the staged item — read-only here. The full
                    value is shown (no rounding/truncation) so nothing is hidden. */}
                <div
                  title="float (wear) — set by the item, not editable"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 6,
                    marginTop: 3,
                  }}
                >
                  <span className="hud" style={{ color: "var(--cream-dim)", fontSize: 8 }}>
                    FLOAT
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "var(--amber)",
                      wordBreak: "break-all",
                      textAlign: "right",
                    }}
                  >
                    {String(slot.float)}
                  </span>
                </div>
                {/* Per-input market price, carried from the inventory feed
                    (null for catalog picks / unpriced wears). Click the value
                    for the per-marketplace breakdown of this exact wear. */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginTop: 1,
                  }}
                >
                  <span className="hud" style={{ color: "var(--cream-dim)", fontSize: 8 }}>
                    PRICE
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPriceModal({
                        name: marketName({
                          weapon: slot.skin!.weapon.name,
                          skin: slot.skin!.name,
                          wear: wearFromFloat(slot.float),
                          stattrak: slot.stattrak,
                        }),
                        priceSources: slot.priceSources,
                      })
                    }
                    title="Compare prices across marketplaces"
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: slot.price != null ? "var(--green)" : "var(--cream-dim)",
                      borderBottom: "1px dotted currentColor",
                      lineHeight: 1.1,
                    }}
                  >
                    {slot.price != null ? usd(slot.price) : "—"}
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => setPickerFor(i)}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "1px dashed var(--line)",
                  color: "var(--cream-dim)",
                  fontSize: 11,
                  letterSpacing: "0.1em",
                }}
              >
                + PICK
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={execute}
          disabled={filled !== count || running}
          style={{
            background: filled === count ? "var(--ember)" : "var(--line)",
            color: filled === count ? "var(--void)" : "var(--cream-dim)",
            border: "none",
            padding: "12px 28px",
            fontSize: 12,
            letterSpacing: "0.18em",
            fontWeight: 700,
          }}
        >
          {running ? "COMPUTING…" : "EXECUTE CONTRACT"}
        </button>
        <button
          onClick={() => {
            // Reset to an empty standard grid; it re-derives to ×5 if a knife leads.
            setSlots(makeSlots(10));
            setResult(null);
            setError(null);
          }}
          className="hud"
          style={{
            background: "transparent",
            border: "1px solid var(--line)",
            color: "var(--cream-dim)",
            padding: "12px 16px",
          }}
        >
          RESET
        </button>
      </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 20,
            border: "1px solid var(--loss)",
            color: "var(--loss)",
            padding: "12px 14px",
            fontSize: 12,
          }}
        >
          ERROR · {error}
        </div>
      )}

      {result && (
        <Outcomes
          result={result}
          stattrak={isStatTrak}
          onPrice={(name, priceSources) => setPriceModal({ name, priceSources })}
        />
      )}

      <SkinPicker
        open={pickerFor !== null}
        lockedRarity={lockedRarity}
        onClose={() => setPickerFor(null)}
        onPick={(skin) => pickerFor !== null && pick(pickerFor, skin)}
      />

      {priceModal && (
        <PriceModal
          name={priceModal.name}
          priceSources={priceModal.priceSources}
          onClose={() => setPriceModal(null)}
        />
      )}
    </main>
    </>
  );
}

function Outcomes({
  result,
  stattrak,
  onPrice,
}: {
  result: TradeupResult;
  stattrak: boolean;
  onPrice: (name: string, priceSources?: Record<string, number> | null) => void;
}) {
  const profitable = result.profitEV >= 0;

  // The currently spotlighted outcome. Clicking a donut slice or legend title
  // selects it: the matching card below scrolls into view and lights up. One
  // ref per card lets us scroll directly to it.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => setSelectedIdx(null), [result]); // drop stale selection on recompute

  const selectOutcome = (idx: number) => {
    setSelectedIdx(idx);
    cardRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section
      style={{
        marginTop: 36,
        background: "rgba(2, 8, 2, 0.92)",
        border: "1px solid var(--line)",
        padding: "20px 18px",
        backdropFilter: "blur(1px)",
      }}
    >
      <div style={{ display: "flex", gap: 28, alignItems: "baseline", flexWrap: "wrap" }}>
        <Stat label="INPUT COST" value={usd(result.inputCost)} />
        <Stat label="EXPECTED VALUE" value={usd(result.expectedValue)} />
        <Stat
          label="EV − COST"
          value={signedUsd(result.profitEV)}
          color={profitable ? "var(--profit)" : "var(--loss)"}
        />
        <Stat
          label="OUTPUT RARITY"
          value={result.outputRarity}
          color={rarityColor(result.outputRarity)}
        />
      </div>

      {result.warnings.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {result.warnings.map((w, i) => (
            <div key={i} className="hud hud-amber" style={{ padding: "2px 0" }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      <ResultViz result={result} selectedIdx={selectedIdx} onSelect={selectOutcome} />

      <div
        className="hud"
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>POSSIBLE OUTCOMES</span>
        <span className="hud-ember">{result.outcomes.length} ITEMS</span>
      </div>

      {/* Outcome grid — one card per possible item, ordered most→least likely.
          The swatch on each card matches that item's donut slice above. */}
      <div
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: 5,
        }}
      >
        {result.outcomes.map((o, idx) => (
          <OutcomeCard
            key={`${o.skin.id}-${o.outputWear}`}
            o={o}
            idx={idx}
            inputCost={result.inputCost}
            color={PIE_COLORS[idx % PIE_COLORS.length]}
            stattrak={stattrak}
            onPrice={onPrice}
            selected={selectedIdx === idx}
            cardRef={(el) => { cardRefs.current[idx] = el; }}
          />
        ))}
      </div>
    </section>
  );
}

// One outcome rendered as a picture card. Carries every field the old table row
// held: weapon + name, MOST-LIKELY flag, wear/float, hit %, odds, price, the
// profit/loss if you land it, and ROI. The color swatch ties back to the donut.
// Map an outcome's ROI to a red→yellow→green spectrum, yellow at break-even.
// −100% (wipeout) → red, 0% → yellow, +100% or better → green; clamped past ±100%.
function roiColor(roi: number | null): string {
  if (roi == null) return "var(--cream-dim)";
  const t = Math.max(-1, Math.min(1, roi / 100));
  const hue = 60 + t * 60; // 0 red · 60 yellow · 120 green
  return `hsl(${Math.round(hue)}, 85%, 58%)`;
}

function OutcomeCard({
  o,
  idx,
  inputCost,
  color,
  stattrak,
  onPrice,
  selected,
  cardRef,
}: {
  o: TradeupOutcome;
  idx: number;
  inputCost: number;
  color: string;
  stattrak: boolean;
  onPrice: (name: string, priceSources?: Record<string, number> | null) => void;
  selected: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const land = o.estimatedPrice != null ? o.estimatedPrice - inputCost : null;
  const roi =
    o.estimatedPrice != null && inputCost > 0
      ? ((o.estimatedPrice - inputCost) / inputCost) * 100
      : null;
  const rarity = rarityHex(o.skin.rarity.name);
  const spectrum = roiColor(roi);
  const insetBar = roi == null ? "" : `inset 4px 0 0 0 ${spectrum}`;

  return (
    <div
      ref={cardRef}
      className="bracket"
      style={{
        position: "relative",
        border: selected ? `1px solid ${color}` : "1px solid var(--line)",
        borderTop: `2px solid ${rarity}`,
        background: selected ? "var(--surface)" : "var(--surface-2)",
        padding: "5px 6px 6px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        scrollMarginTop: 80,
        transition: "box-shadow 0.2s, background 0.2s, border-color 0.2s",
        // ROI-driven inset accent (red→yellow→green); when picked from the
        // distribution legend/donut, add an outer ring + glow in its slice color.
        boxShadow: selected
          ? [insetBar, `0 0 0 2px ${color}`, `0 0 18px ${color}99`].filter(Boolean).join(", ")
          : insetBar || undefined,
      }}
    >
      {idx === 0 && (
        <span
          className="hud hud-ember"
          style={{ position: "absolute", top: 6, right: 7, fontSize: 7 }}
        >
          ★ TOP
        </span>
      )}

      {/* item picture, lit by its rarity hue */}
      <div
        style={{
          height: 42,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `radial-gradient(ellipse at center, ${rarity}22, transparent 70%)`,
        }}
      >
        {o.skin.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={o.skin.image}
            alt={o.skin.name}
            style={{ maxWidth: "100%", height: 42, objectFit: "contain" }}
          />
        ) : (
          <span className="hud" style={{ color: "var(--cream-dim)" }}>NO IMG</span>
        )}
      </div>

      {/* weapon + name, with a pie-chart glyph in this outcome's donut-slice color */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            style={{ flexShrink: 0, display: "block" }}
            aria-hidden
          >
            <title>this outcome&apos;s pie-chart slice color</title>
            <circle cx="6" cy="6" r="5.5" fill={color} />
            <path d="M6 6 L6 0.5 A5.5 5.5 0 0 1 10.8 7.5 Z" fill="rgba(0,0,0,0.5)" />
          </svg>
          <span style={{ fontSize: 8, color: "var(--cream-dim)", letterSpacing: "0.04em" }}>
            {o.skin.weapon.name}
          </span>
        </div>
        <div style={{ fontSize: 10, lineHeight: 1.2, marginTop: 1 }}>{o.skin.name}</div>
      </div>

      {/* wear / float */}
      <div className="hud" style={{ display: "flex", justifyContent: "space-between", fontSize: 8 }}>
        <span>{o.outputWear}</span>
        <span style={{ color: "var(--amber)" }}>{o.outputFloat.toFixed(4)}</span>
      </div>

      {/* hit chance (big) + odds */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 15, color: "var(--green)" }}>
          {(o.probability * 100).toFixed(1)}%
        </span>
        <span className="hud" style={{ color: "var(--cream-dim)" }}>{oddsString(o.probability)}</span>
      </div>

      {/* price / land / roi */}
      <div
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: 6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          fontSize: 10,
        }}
      >
        <CardRow
          label="PRICE"
          value={usd(o.estimatedPrice)}
          onClick={() =>
            onPrice(
              marketName({
                weapon: o.skin.weapon.name,
                skin: o.skin.name,
                wear: o.outputWear,
                stattrak,
              }),
              o.priceSources,
            )
          }
        />
        <CardRow
          label="NET"
          value={land == null ? "—" : signedUsd(land)}
          color={land == null ? "var(--cream-dim)" : spectrum}
        />
        <CardRow
          label="ROI"
          value={roi == null ? "—" : `${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`}
          color={spectrum}
        />
      </div>
    </div>
  );
}

function CardRow({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span className="hud" style={{ color: "var(--cream-dim)" }}>{label}</span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          title="Compare prices across marketplaces"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            font: "inherit",
            color: color ?? "var(--cream)",
            borderBottom: "1px dotted currentColor",
            lineHeight: 1.1,
          }}
        >
          {value}
        </button>
      ) : (
        <span style={{ color: color ?? "var(--cream)" }}>{value}</span>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="hud">{label}</div>
      <div style={{ fontSize: 20, marginTop: 2, color: color ?? "var(--cream)" }}>{value}</div>
    </div>
  );
}

// Distinct hues for pie slices (output skins share one rarity, so we can't color
// by rarity — use a fixed high-contrast palette instead).
const PIE_COLORS = [
  "#4b69ff", "#eb4b4b", "#2ecc71", "#e4ae39", "#d32ce6", "#1abc9c",
  "#8847ff", "#5e98d9", "#f39c12", "#16a085", "#e74c3c", "#9b59b6",
];

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [sx, sy] = polar(cx, cy, r, endDeg);
  const [ex, ey] = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${large} 0 ${ex} ${ey} Z`;
}

// Below-the-fold visualizers for a computed contract: an outcome-probability
// donut, the chance you come out ahead, and a cost-vs-EV comparison.
function ResultViz({
  result,
  selectedIdx,
  onSelect,
}: {
  result: TradeupResult;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
}) {
  const { outcomes, inputCost, expectedValue } = result;
  const totalProb = outcomes.reduce((a, o) => a + o.probability, 0) || 1;

  // Donut slices, largest first (outcomes are already sorted desc by prob).
  let acc = 0;
  const slices = outcomes.map((o, idx) => {
    const frac = o.probability / totalProb;
    const start = acc * 360;
    acc += frac;
    return { o, idx, start, end: acc * 360, color: PIE_COLORS[idx % PIE_COLORS.length] };
  });

  // Profit chance: probability mass that lands above / below / at-unknown cost.
  let pProfit = 0, pLoss = 0, pUnknown = 0;
  for (const o of outcomes) {
    if (o.estimatedPrice == null) pUnknown += o.probability;
    else if (o.estimatedPrice >= inputCost) pProfit += o.probability;
    else pLoss += o.probability;
  }
  const pcs = (p: number) => `${((p / totalProb) * 100).toFixed(1)}%`;
  const evMax = Math.max(inputCost, expectedValue, 0.01);

  return (
    <div
      style={{
        marginTop: 22,
        display: "grid",
        gridTemplateColumns: "minmax(260px, 340px) 1fr",
        gap: 28,
        alignItems: "start",
        paddingTop: 18,
        borderTop: "1px solid var(--line)",
      }}
    >
      {/* outcome probability donut + full legend beneath it */}
      <div>
        <div className="hud" style={{ marginBottom: 10 }}>OUTCOME DISTRIBUTION</div>
        {/* The donut now spans the whole column (it used to share the row with a
            cramped legend). Slices are clickable and dim when another is picked. */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <svg viewBox="0 0 160 160" style={{ width: 200, height: 200, flexShrink: 0 }}>
            {slices.map((s) => {
              const active = selectedIdx === s.idx;
              return (
                <path
                  key={`${s.o.skin.id}-${s.o.outputWear}`}
                  d={arcPath(80, 80, active ? 79 : 76, s.start, s.end)}
                  fill={s.color}
                  stroke="var(--void)"
                  strokeWidth={1}
                  opacity={selectedIdx == null || active ? 1 : 0.35}
                  onClick={() => onSelect(s.idx)}
                  style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                >
                  <title>{`${s.o.skin.weapon.name} | ${s.o.skin.name} · ${pcs(s.o.probability)}`}</title>
                </path>
              );
            })}
            <circle cx={80} cy={80} r={40} fill="rgba(2, 8, 2, 0.92)" />
            <text x={80} y={76} textAnchor="middle" fontSize={11} fill="var(--cream-dim)">
              {outcomes.length}
            </text>
            <text x={80} y={90} textAnchor="middle" fontSize={8} fill="var(--cream-dim)">
              OUTCOMES
            </text>
          </svg>
        </div>
        {/* Full legend — no scroll, no truncation, every title shown in full.
            Each row jumps to + highlights its outcome card below. The section
            grows with the outcome count instead of hiding rows behind a scroll. */}
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 2 }}>
          {slices.map((s) => {
            const active = selectedIdx === s.idx;
            return (
              <button
                type="button"
                key={`${s.o.skin.id}-${s.o.outputWear}`}
                onClick={() => onSelect(s.idx)}
                title="Jump to this outcome"
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  background: active ? "var(--surface-2)" : "transparent",
                  border: "none",
                  borderLeft: `3px solid ${active ? s.color : "transparent"}`,
                  padding: "4px 7px",
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: active ? "var(--cream)" : "var(--cream-dim)",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    background: s.color,
                    flexShrink: 0,
                    alignSelf: "center",
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: "var(--cream-dim)" }}>{s.o.skin.weapon.name} | </span>
                  {s.o.skin.name}{" "}
                  <span className="hud" style={{ fontSize: 8 }}>{s.o.outputWear}</span>
                </span>
                <span className="hud" style={{ flexShrink: 0 }}>{pcs(s.o.probability)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* profit chance + value comparison */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div className="hud" style={{ marginBottom: 8 }}>CHANCE YOU COME OUT AHEAD</div>
          <div style={{ display: "flex", height: 22, border: "1px solid var(--line)" }}>
            {[
              { p: pProfit, color: "var(--profit)", label: "PROFIT" },
              { p: pLoss, color: "var(--loss)", label: "LOSS" },
              { p: pUnknown, color: "var(--surface-line)", label: "N/A" },
            ]
              .filter((b) => b.p > 0)
              .map((b) => (
                <div
                  key={b.label}
                  title={`${b.label} ${pcs(b.p)}`}
                  style={{
                    width: `${(b.p / totalProb) * 100}%`,
                    background: b.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    color: "var(--void)",
                    overflow: "hidden",
                  }}
                >
                  {(b.p / totalProb) >= 0.12 ? pcs(b.p) : ""}
                </div>
              ))}
          </div>
          <div className="hud" style={{ marginTop: 6, display: "flex", gap: 16 }}>
            <span style={{ color: "var(--profit)" }}>▰ PROFIT {pcs(pProfit)}</span>
            <span style={{ color: "var(--loss)" }}>▰ LOSS {pcs(pLoss)}</span>
            {pUnknown > 0 && <span style={{ color: "var(--cream-dim)" }}>▰ NO PRICE {pcs(pUnknown)}</span>}
          </div>
        </div>

        <div>
          <div className="hud" style={{ marginBottom: 8 }}>INPUT COST vs EXPECTED VALUE</div>
          <ValueBar label="COST" value={inputCost} max={evMax} color="var(--loss)" />
          <ValueBar label="EV" value={expectedValue} max={evMax} color="var(--profit)" />
        </div>
      </div>
    </div>
  );
}

function ValueBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
      <span className="hud" style={{ width: 34 }}>{label}</span>
      <div style={{ flex: 1, height: 16, background: "var(--void)", border: "1px solid var(--line)" }}>
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", background: color }} />
      </div>
      <span style={{ fontSize: 11, width: 64, textAlign: "right" }}>{usd(value)}</span>
    </div>
  );
}
