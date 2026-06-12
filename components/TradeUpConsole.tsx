"use client";

import { useEffect, useMemo, useState } from "react";
import CircuitBoard from "@/components/CircuitBoard";
import SkinPicker from "@/components/SkinPicker";
import { oddsString, rarityColor, rarityHex, signedUsd, usd } from "@/lib/display";
import { makeSlots, useTradeup } from "@/lib/tradeup-context";
import type { Rarity, Skin, TradeupResult } from "@/types/cs2";

export default function TradeUpConsole() {
  const { slots, setSlots, count, setCount } = useTradeup();
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [result, setResult] = useState<TradeupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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
      next[i] = { skin, float: skin.min_float, stattrak: prev.find((s) => s.skin)?.stattrak ?? false };
      return next;
    });
    setPickerFor(null);
    setResult(null);
  }

  function setFloat(i: number, v: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], float: v };
      return next;
    });
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
      const inputs = slots.map((s) => ({ skinId: s.skin!.id, float: s.float }));
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
          {/* contract size — standard (10) or knife (5). Locked once staging starts. */}
          <div className="hud" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>MODE</span>
            {([["STANDARD ×10", 10], ["KNIFE ×5", 5]] as const).map(([label, n]) => (
              <button
                key={n}
                onClick={() => {
                  setCount(n);
                  setResult(null);
                }}
                disabled={filled > 0}
                style={{
                  background: count === n ? "var(--ember)" : "transparent",
                  color: count === n ? "var(--void)" : "var(--cream-dim)",
                  border: "1px solid var(--line)",
                  padding: "5px 9px",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                }}
              >
                {label}
              </button>
            ))}
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
              {slot.skin && (
                <button
                  onClick={() => clearSlot(i)}
                  title="Remove"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--cream-dim)",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {slot.skin ? (
              <>
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
                <input
                  type="number"
                  min={slot.skin.min_float}
                  max={slot.skin.max_float}
                  step={0.001}
                  value={slot.float}
                  onChange={(e) => setFloat(i, Number(e.target.value))}
                  style={{
                    width: "100%",
                    background: "var(--void)",
                    border: "1px solid var(--line)",
                    color: "var(--amber)",
                    fontSize: 11,
                    padding: "3px 5px",
                    outline: "none",
                  }}
                />
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
            setSlots(makeSlots(count));
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

      {result && <Outcomes result={result} />}

      <SkinPicker
        open={pickerFor !== null}
        lockedRarity={lockedRarity}
        onClose={() => setPickerFor(null)}
        onPick={(skin) => pickerFor !== null && pick(pickerFor, skin)}
      />
    </main>
    </>
  );
}

function Outcomes({ result }: { result: TradeupResult }) {
  const profitable = result.profitEV >= 0;
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

      <ResultViz result={result} />

      <table style={{ width: "100%", marginTop: 22, borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line)" }}>
            {["OUTCOME", "WEAR / FLOAT", "HIT", "ODDS", "PRICE", "IF YOU LAND", "ROI"].map((h) => (
              <th
                key={h}
                className="hud"
                style={{ textAlign: h === "OUTCOME" ? "left" : "right", padding: "8px 6px" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.outcomes.map((o, idx) => {
            const land = o.estimatedPrice != null ? o.estimatedPrice - result.inputCost : null;
            const roi =
              o.estimatedPrice != null && result.inputCost > 0
                ? ((o.estimatedPrice - result.inputCost) / result.inputCost) * 100
                : null;
            return (
              <tr key={`${o.skin.id}-${o.outputWear}`} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "9px 6px" }}>
                  <span style={{ color: "var(--cream-dim)", fontSize: 10 }}>{o.skin.weapon.name}</span>
                  <br />
                  {o.skin.name}
                  {idx === 0 && (
                    <span className="hud hud-ember" style={{ marginLeft: 8 }}>
                      MOST LIKELY
                    </span>
                  )}
                </td>
                <td style={{ textAlign: "right", padding: "9px 6px" }}>
                  {o.outputWear}
                  <br />
                  <span className="hud">{o.outputFloat.toFixed(4)}</span>
                </td>
                <td style={{ textAlign: "right", padding: "9px 6px" }}>
                  {(o.probability * 100).toFixed(1)}%
                </td>
                <td style={{ textAlign: "right", padding: "9px 6px", color: "var(--cream-dim)" }}>
                  {oddsString(o.probability)}
                </td>
                <td style={{ textAlign: "right", padding: "9px 6px" }}>{usd(o.estimatedPrice)}</td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "9px 6px",
                    color: land == null ? "var(--cream-dim)" : land >= 0 ? "var(--profit)" : "var(--loss)",
                  }}
                >
                  {land == null ? "—" : signedUsd(land)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "9px 6px",
                    color: roi == null ? "var(--cream-dim)" : roi >= 0 ? "var(--profit)" : "var(--loss)",
                  }}
                >
                  {roi == null ? "—" : `${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
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
function ResultViz({ result }: { result: TradeupResult }) {
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
        gridTemplateColumns: "minmax(220px, 280px) 1fr",
        gap: 28,
        alignItems: "start",
        paddingTop: 18,
        borderTop: "1px solid var(--line)",
      }}
    >
      {/* outcome probability donut */}
      <div>
        <div className="hud" style={{ marginBottom: 8 }}>OUTCOME DISTRIBUTION</div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <svg viewBox="0 0 160 160" style={{ width: 130, height: 130, flexShrink: 0 }}>
            {slices.map((s) => (
              <path
                key={`${s.o.skin.id}-${s.o.outputWear}`}
                d={arcPath(80, 80, 76, s.start, s.end)}
                fill={s.color}
                stroke="var(--void)"
                strokeWidth={1}
              />
            ))}
            <circle cx={80} cy={80} r={40} fill="rgba(2, 8, 2, 0.92)" />
            <text x={80} y={76} textAnchor="middle" fontSize={11} fill="var(--cream-dim)">
              {outcomes.length}
            </text>
            <text x={80} y={90} textAnchor="middle" fontSize={8} fill="var(--cream-dim)">
              OUTCOMES
            </text>
          </svg>
          <div style={{ fontSize: 10, lineHeight: 1.5, minWidth: 0 }}>
            {slices.slice(0, 8).map((s) => (
              <div
                key={`${s.o.skin.id}-${s.o.outputWear}`}
                style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
              >
                <span style={{ width: 8, height: 8, background: s.color, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.o.skin.name}</span>
                <span className="hud" style={{ marginLeft: "auto" }}>{pcs(s.o.probability)}</span>
              </div>
            ))}
            {slices.length > 8 && (
              <div className="hud" style={{ marginTop: 2 }}>+{slices.length - 8} more</div>
            )}
          </div>
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
