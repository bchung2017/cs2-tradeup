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
    image?: string | null;
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

  function pick(i: number, skin: Skin, float: number) {
    setSlots((prev) => {
      const next = [...prev];
      // Catalog picks carry no StatTrak; inherit the contract's current state.
      // Float comes from the picker's wear/float form (a realistic in-game value
      // instead of 0.00). No market price is resolved for catalog picks.
      next[i] = { skin, float, stattrak: prev.find((s) => s.skin)?.stattrak ?? false, price: null };
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
            className={slot.skin ? "bracket card-hover" : "bracket"}
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
                        image: slot.skin!.image,
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
          onPrice={(name, image, priceSources) => setPriceModal({ name, image, priceSources })}
        />
      )}

      <SkinPicker
        open={pickerFor !== null}
        lockedRarity={lockedRarity}
        onClose={() => setPickerFor(null)}
        onPick={(skin, float) => pickerFor !== null && pick(pickerFor, skin, float)}
      />

      {priceModal && (
        <PriceModal
          name={priceModal.name}
          image={priceModal.image}
          priceSources={priceModal.priceSources}
          onClose={() => setPriceModal(null)}
        />
      )}
    </main>
    </>
  );
}

// ── Outcome-grid sorting ─────────────────────────────────────────────────────
// The card grid reorders independently of the donut/legend above (which stay
// canonical most-likely). Sorting returns a display order of the *original*
// indices, so every card keeps its donut-slice color, scroll ref, and selection
// mapping no matter how the grid is reordered.
type OutcomeSortKey =
  | "likelihood-desc"
  | "likelihood-asc"
  | "price-desc"
  | "price-asc"
  | "ingame-desc"
  | "ingame-asc";

const OUTCOME_SORTS: { key: OutcomeSortKey; label: string }[] = [
  { key: "likelihood-desc", label: "Likelihood: high → low" },
  { key: "likelihood-asc", label: "Likelihood: low → high" },
  { key: "price-desc", label: "Price: high → low" },
  { key: "price-asc", label: "Price: low → high" },
  { key: "ingame-desc", label: "In-game buy price: high → low" },
  { key: "ingame-asc", label: "In-game buy price: low → high" },
];

// CS buy-menu cost of each weapon — the literal price you pay to buy the gun at
// the start of a round, NOT any market/Steam value. A fixed per-weapon-type
// constant (independent of skin). Knives/gloves aren't purchasable, so they have
// no buy price and sort last.
const WEAPON_BUY_PRICE: Record<string, number> = {
  // pistols
  "Glock-18": 200, "USP-S": 200, P2000: 200, P250: 300, "Dual Berettas": 300,
  "Five-SeveN": 500, "Tec-9": 500, "CZ75-Auto": 500, "R8 Revolver": 600, "Desert Eagle": 700,
  // smgs
  "MAC-10": 1050, MP9: 1250, "UMP-45": 1200, "PP-Bizon": 1400, MP7: 1500, "MP5-SD": 1500, P90: 2350,
  // heavy (shotguns + machine guns)
  Nova: 1050, "Sawed-Off": 1100, "MAG-7": 1300, "XM1014": 2000, Negev: 1700, "M249": 5200,
  // rifles
  "Galil AR": 1800, FAMAS: 2050, "AK-47": 2700, "M4A1-S": 2900, M4A4: 3000, "SG 553": 3000, AUG: 3300,
  // snipers
  "SSG 08": 1700, AWP: 4750, "SCAR-20": 5000, G3SG1: 5000,
};

// Numeric compare with a fixed direction; null prices sink last either way
// (same rule the inventory grid uses for unpriced items).
function cmpNum(a: number | null | undefined, b: number | null | undefined, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

// Display order of indices into `outcomes`. Probability breaks price ties so
// equal-priced items keep a stable, meaningful order.
function sortedOutcomeOrder(outcomes: TradeupOutcome[], key: OutcomeSortKey): number[] {
  const order = outcomes.map((_, i) => i);
  const prob = (i: number) => outcomes[i].probability;
  const price = (i: number) => outcomes[i].estimatedPrice ?? null;
  // In-game buy price = the CS buy-menu cost of the weapon (AWP 4750, AK-47 2700,
  // …) — the literal in-round purchase price, NOT a market/Steam value. Looked up
  // by weapon type; unknown weapons (knives/gloves) sink last.
  const ingame = (i: number) => WEAPON_BUY_PRICE[outcomes[i].skin.weapon.name] ?? null;
  order.sort((a, b) => {
    switch (key) {
      case "likelihood-asc":
        return prob(a) - prob(b);
      case "price-desc":
        return cmpNum(price(a), price(b), -1) || prob(b) - prob(a);
      case "price-asc":
        return cmpNum(price(a), price(b), 1) || prob(b) - prob(a);
      case "ingame-desc":
        return cmpNum(ingame(a), ingame(b), -1) || prob(b) - prob(a);
      case "ingame-asc":
        return cmpNum(ingame(a), ingame(b), 1) || prob(b) - prob(a);
      default: // likelihood-desc — the canonical most-likely-first order
        return prob(b) - prob(a);
    }
  });
  return order;
}

function Outcomes({
  result,
  stattrak,
  onPrice,
}: {
  result: TradeupResult;
  stattrak: boolean;
  onPrice: (name: string, image: string | null | undefined, priceSources?: Record<string, number> | null) => void;
}) {
  // The currently spotlighted outcome. Clicking a donut slice or legend title
  // selects it: the matching card below scrolls into view and lights up. One
  // ref per card lets us scroll directly to it.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => setSelectedIdx(null), [result]); // drop stale selection on recompute

  // Grid display order (original indices). Donut/legend are unaffected.
  const [sortKey, setSortKey] = useState<OutcomeSortKey>("likelihood-desc");
  const order = useMemo(
    () => sortedOutcomeOrder(result.outcomes, sortKey),
    [result.outcomes, sortKey],
  );

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
      <SummaryStats result={result} />

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
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>POSSIBLE OUTCOMES</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>SORT</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as OutcomeSortKey)}
            title="Order the outcome grid"
            style={{
              background: "var(--void)",
              color: "var(--amber)",
              border: "1px solid var(--surface-line)",
              padding: "4px 8px",
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              outline: "none",
              cursor: "pointer",
            }}
          >
            {OUTCOME_SORTS.map((s) => (
              <option key={s.key} value={s.key} style={{ background: "var(--void)", color: "var(--amber)" }}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="hud-ember">{result.outcomes.length} ITEMS</span>
        </div>
      </div>

      {/* Outcome grid — one card per possible item, ordered most→least likely.
          The swatch on each card matches that item's donut slice above. */}
      <div
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        {order.map((idx) => {
          const o = result.outcomes[idx];
          // idx is the ORIGINAL index — keeps color/ref/selection aligned with
          // the donut while the grid renders in the chosen sort order.
          return (
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
          );
        })}
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
  onPrice: (name: string, image: string | null | undefined, priceSources?: Record<string, number> | null) => void;
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

  // Clicking anywhere on the card opens the per-marketplace price modal — same
  // target as the inner PRICE row, so the whole card is a hit area.
  const openPrice = () =>
    onPrice(
      marketName({ weapon: o.skin.weapon.name, skin: o.skin.name, wear: o.outputWear, stattrak }),
      o.skin.image,
      o.priceSources,
    );

  return (
    <div
      ref={cardRef}
      className={`bracket card-hover${selected ? " card-selected" : ""}`}
      onClick={openPrice}
      style={{
        position: "relative",
        cursor: "pointer",
        // Border is always the rarity hue — thick and bold, and never changes on
        // selection. Selection is shown by the background tint instead, so the
        // rarity (border) and pie-slice (background) colors never overlap. Static
        // value, so the `border` shorthand is safe (no toggling longhand).
        border: `3px solid ${rarity}`,
        // Subtle translucent wash in this outcome's pie-slice color — this is the
        // slice association now that the pie glyph is gone; deepens when selected.
        background: selected
          ? `linear-gradient(${color}3d, ${color}3d), var(--surface-2)`
          : `linear-gradient(${color}14, ${color}14), var(--surface-2)`,
        padding: "9px 11px 11px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        scrollMarginTop: 80,
        transition: "background 0.2s, box-shadow 0.15s, transform 0.1s",
      }}
    >
      {idx === 0 && (
        <span
          className="hud hud-ember"
          style={{ position: "absolute", top: 8, right: 9, fontSize: 9 }}
        >
          ★ TOP
        </span>
      )}

      {/* item picture, lit by its rarity hue */}
      <div
        style={{
          height: 64,
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
            style={{ maxWidth: "100%", height: 64, objectFit: "contain" }}
          />
        ) : (
          <span className="hud" style={{ color: "var(--cream-dim)" }}>NO IMG</span>
        )}
      </div>

      {/* weapon + name */}
      <div>
        <span style={{ fontSize: 10, color: "var(--cream-dim)", letterSpacing: "0.04em" }}>
          {o.skin.weapon.name}
        </span>
        <div style={{ fontSize: 13, lineHeight: 1.25, marginTop: 2 }}>{o.skin.name}</div>
      </div>

      {/* wear / float */}
      <div className="hud" style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
        <span>{o.outputWear}</span>
        <span style={{ color: "var(--amber)" }}>{o.outputFloat.toFixed(4)}</span>
      </div>

      {/* hit chance (big) + odds — neutral, not green; profit is read off the
          color-coded PRICE/NET/ROI block below instead. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 22, color: "var(--cream)" }}>
          {(o.probability * 100).toFixed(1)}%
        </span>
        <span className="hud" style={{ color: "var(--cream-dim)" }}>{oddsString(o.probability)}</span>
      </div>

      {/* price / net / roi — the prominent profit readout. All three values are
          color-coded by ROI (red loss → yellow break-even → green profit), now
          that the inset accent bar is gone. */}
      <div
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: 9,
          display: "flex",
          flexDirection: "column",
          gap: 5,
          fontSize: 13,
        }}
      >
        <CardRow
          label="PRICE"
          value={usd(o.estimatedPrice)}
          color={o.estimatedPrice == null ? "var(--cream-dim)" : spectrum}
          strong
          onClick={(e) => {
            e?.stopPropagation(); // outer card also opens the modal — don't double-fire
            openPrice();
          }}
        />
        <CardRow
          label="NET"
          value={land == null ? "—" : signedUsd(land)}
          color={land == null ? "var(--cream-dim)" : spectrum}
          strong
        />
        <CardRow
          label="ROI"
          value={roi == null ? "—" : `${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`}
          color={roi == null ? "var(--cream-dim)" : spectrum}
          strong
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
  strong,
}: {
  label: string;
  value: string;
  color?: string;
  onClick?: (e?: React.MouseEvent) => void;
  strong?: boolean;
}) {
  // `strong` makes the value the prominent readout: larger and bold.
  const valueEmphasis = strong ? { fontSize: 15, fontWeight: 700 } : undefined;
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
            ...valueEmphasis,
          }}
        >
          {value}
        </button>
      ) : (
        <span style={{ color: color ?? "var(--cream)", ...valueEmphasis }}>{value}</span>
      )}
    </div>
  );
}

// One horizontal summary row: the four headline stats sit beside the
// chance-you-come-out-ahead bar and the cost-vs-payout comparison (these last
// two used to live in the distribution grid). Wraps on narrow widths.
function SummaryStats({ result }: { result: TradeupResult }) {
  const { outcomes, inputCost, expectedValue } = result;
  const profitable = result.profitEV >= 0;
  const totalProb = outcomes.reduce((a, o) => a + o.probability, 0) || 1;

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
    <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap", rowGap: 20 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Stat label="INPUT COST" value={usd(inputCost)} />
        <Stat label="AVERAGE PAYOUT" value={usd(expectedValue)} />
        <Stat
          label="AVERAGE PROFIT"
          value={signedUsd(result.profitEV)}
          color={profitable ? "var(--profit)" : "var(--loss)"}
        />
        <Stat label="OUTPUT RARITY" value={result.outputRarity} color={rarityColor(result.outputRarity)} />
      </div>

      <div style={{ flex: "1 1 240px", minWidth: 220 }}>
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
        <div className="hud" style={{ marginTop: 6, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span style={{ color: "var(--profit)" }}>▰ PROFIT {pcs(pProfit)}</span>
          <span style={{ color: "var(--loss)" }}>▰ LOSS {pcs(pLoss)}</span>
          {pUnknown > 0 && <span style={{ color: "var(--cream-dim)" }}>▰ NO PRICE {pcs(pUnknown)}</span>}
        </div>
      </div>

      <div style={{ flex: "1 1 220px", minWidth: 200 }}>
        <div className="hud" style={{ marginBottom: 8 }}>INPUT COST vs AVERAGE PAYOUT</div>
        <ValueBar label="COST" value={inputCost} max={evMax} color="var(--loss)" />
        <ValueBar label="PAYOUT" value={expectedValue} max={evMax} color="var(--profit)" />
      </div>
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
  const { outcomes, inputCost } = result;
  const totalProb = outcomes.reduce((a, o) => a + o.probability, 0) || 1;

  // Donut slices, largest first (outcomes are already sorted desc by prob).
  let acc = 0;
  const slices = outcomes.map((o, idx) => {
    const frac = o.probability / totalProb;
    const start = acc * 360;
    acc += frac;
    return { o, idx, start, end: acc * 360, color: PIE_COLORS[idx % PIE_COLORS.length] };
  });
  const pcs = (p: number) => `${((p / totalProb) * 100).toFixed(1)}%`;

  // Breakdown dropdown is collapsed by default — the donut carries the
  // at-a-glance read. Hovering a row lights its slice (hover beats the
  // click-selection).
  const [legendOpen, setLegendOpen] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const focusIdx = hoveredIdx ?? selectedIdx; // which slice is "lit" right now

  // Donut "detach + lerp": translate the donut so its center aligns with the
  // focused row's center, clamped within the open list. The CSS transition on
  // the transform eases the motion. The rows and the list measure their offset
  // against the positioned flex row below, so donutShift is in the same frame.
  const DONUT = 200;
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [donutShift, setDonutShift] = useState(0);
  useEffect(() => {
    if (!legendOpen || focusIdx == null) {
      setDonutShift(0);
      return;
    }
    const row = rowRefs.current[focusIdx];
    const list = listRef.current;
    if (!row || !list) return;
    const rowCenter = row.offsetTop + row.offsetHeight / 2;
    const listBottom = list.offsetTop + list.offsetHeight;
    const max = Math.max(0, listBottom - DONUT);
    setDonutShift(Math.max(0, Math.min(max, rowCenter - DONUT / 2)));
  }, [focusIdx, legendOpen, outcomes.length]);

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 18,
        borderTop: "1px solid var(--line)",
      }}
    >
      <div className="hud" style={{ marginBottom: 12 }}>OUTCOME DISTRIBUTION</div>
      {/* Donut adjacent to the breakdown dropdown. The flex row is positioned so
          the rows + list measure their offsets against it for the lerp. */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", position: "relative" }}>
        {/* donut — detaches and lerps down toward the focused row as you scan */}
        <div
          style={{
            flexShrink: 0,
            width: DONUT,
            transform: `translateY(${donutShift}px)`,
            transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        >
          <svg viewBox="0 0 160 160" style={{ width: DONUT, height: DONUT, display: "block" }}>
            {slices.map((s) => {
              const lit = focusIdx === s.idx;
              return (
                <path
                  key={`${s.o.skin.id}-${s.o.outputWear}`}
                  d={arcPath(80, 80, lit ? 79 : 76, s.start, s.end)}
                  fill={s.color}
                  stroke="var(--void)"
                  strokeWidth={1}
                  opacity={focusIdx == null || lit ? 1 : 0.35}
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

        {/* breakdown dropdown, adjacent to the donut */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            className="hud"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              background: "transparent",
              border: "1px solid var(--line)",
              padding: "6px 8px",
              cursor: "pointer",
              color: "var(--cream-dim)",
            }}
          >
            <span>{legendOpen ? "▾" : "▸"} BREAKDOWN</span>
            <span className="hud-ember">{slices.length} ITEMS</span>
          </button>
          {legendOpen && (
            <div
              ref={listRef}
              // Clear the hover only when the cursor / keyboard focus leaves the
              // whole list — never per row. Resetting on each row's mouseleave
              // dropped focusIdx to its home value in the gap between rows, so the
              // donut eased back toward translateY(0) and then to the next row,
              // which read as jitter when running a finger down the list.
              onMouseLeave={() => setHoveredIdx(null)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoveredIdx(null);
              }}
              style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}
            >
              {/* column header — labels the per-item NET/ROI columns; left pad
                  matches the rows' 3px border + 7px padding so columns line up */}
              <div
                className="hud"
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "0 7px 4px 10px",
                  color: "var(--cream-dim)",
                  fontSize: 8,
                }}
              >
                <span style={{ width: 9, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>ITEM</span>
                <span style={{ flexShrink: 0, minWidth: 44, textAlign: "right" }}>CHANCE</span>
                <span style={{ flexShrink: 0, minWidth: 56, textAlign: "right" }}>NET</span>
                <span style={{ flexShrink: 0, minWidth: 50, textAlign: "right" }}>ROI</span>
              </div>
              {slices.map((s) => {
                const lit = focusIdx === s.idx;
                // Per-item economics, same math + spectrum the cards use.
                const land = s.o.estimatedPrice != null ? s.o.estimatedPrice - inputCost : null;
                const roi =
                  s.o.estimatedPrice != null && inputCost > 0
                    ? ((s.o.estimatedPrice - inputCost) / inputCost) * 100
                    : null;
                const spectrum = roiColor(roi);
                return (
                  <button
                    type="button"
                    key={`${s.o.skin.id}-${s.o.outputWear}`}
                    ref={(el) => { rowRefs.current[s.idx] = el; }}
                    onClick={() => onSelect(s.idx)}
                    onMouseEnter={() => setHoveredIdx(s.idx)}
                    onFocus={() => setHoveredIdx(s.idx)}
                    title="Jump to this outcome"
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      width: "100%",
                      textAlign: "left",
                      background: lit ? "var(--surface-2)" : "transparent",
                      // Explicit per-side (not the `border` shorthand) so the
                      // lit-driven borderLeft doesn't conflict with a shorthand
                      // on rerender — same fix as OutcomeCard.
                      borderTop: "none",
                      borderRight: "none",
                      borderBottom: "none",
                      borderLeft: `3px solid ${lit ? s.color : "transparent"}`,
                      padding: "4px 7px",
                      cursor: "pointer",
                      fontSize: 11,
                      lineHeight: 1.35,
                      color: lit ? "var(--cream)" : "var(--cream-dim)",
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
                    <span className="hud" style={{ flexShrink: 0, minWidth: 44, textAlign: "right" }}>
                      {pcs(s.o.probability)}
                    </span>
                    <span
                      className="hud"
                      style={{
                        flexShrink: 0,
                        minWidth: 56,
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        color: land == null ? "var(--cream-dim)" : spectrum,
                      }}
                    >
                      {land == null ? "—" : signedUsd(land)}
                    </span>
                    <span
                      className="hud"
                      style={{
                        flexShrink: 0,
                        minWidth: 50,
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        color: roi == null ? "var(--cream-dim)" : spectrum,
                      }}
                    >
                      {roi == null ? "—" : `${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
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
