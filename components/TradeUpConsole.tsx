"use client";

import { useEffect, useMemo, useState } from "react";
import CircuitBoard from "@/components/CircuitBoard";
import SkinPicker from "@/components/SkinPicker";
import { oddsString, rarityColor, rarityHex, signedUsd, usd } from "@/lib/display";
import { makeSlots, useTradeup } from "@/lib/tradeup-context";
import type { Rarity, Skin, TradeupOutcome, TradeupResult } from "@/types/cs2";

export default function TradeUpConsole() {
  const { slots, setSlots, count } = useTradeup();
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
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <ProfilePic />
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
                {/* Click the staged item to clear the slot — inventory items
                    return to the right-side grid (the × button does the same). */}
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
                <div
                  title="exact float"
                  style={{
                    fontSize: 9,
                    color: "var(--cream-dim)",
                    fontFamily: "var(--mono)",
                    wordBreak: "break-all",
                    lineHeight: 1.25,
                    marginTop: 3,
                  }}
                >
                  {String(slot.float)}
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

// Profile-picture loader pinned to the top-left header: pulls the loaded
// profile's Steam avatar (mirrored into shared context from the inventory side)
// and shows a phosphor pulse while it resolves, the avatar once loaded, and a
// dim placeholder when there's no profile or the lookup fails.
function ProfilePic() {
  const { steamid } = useTradeup();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!steamid) {
      setAvatar(null);
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("loading");
    setAvatar(null);
    fetch(`/api/avatar/${steamid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { avatar?: string }) => {
        if (cancelled) return;
        if (d.avatar) {
          setAvatar(d.avatar);
          setState("idle");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [steamid]);

  const SIZE = 54;
  return (
    <div
      title={steamid ? `steam profile ${steamid}` : "no profile loaded"}
      style={{
        width: SIZE,
        height: SIZE,
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
        border: `1px solid ${avatar ? "var(--green)" : "var(--green-faint)"}`,
        background: "var(--void)",
        boxShadow: avatar ? "0 0 8px rgba(51,255,51,0.35)" : "none",
      }}
    >
      <style>{`@keyframes pp-pulse{0%,100%{opacity:.25}50%{opacity:.7}}`}</style>
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt="profile"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : state === "loading" ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, rgba(51,255,51,0.05), rgba(51,255,51,0.28), rgba(51,255,51,0.05))",
            animation: "pp-pulse 1.1s ease-in-out infinite",
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: state === "error" ? "var(--loss)" : "var(--green-faint)",
            fontFamily: "var(--mono)",
            fontSize: 18,
          }}
        >
          {state === "error" ? "✕" : "☻"}
        </div>
      )}
    </div>
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
}: {
  o: TradeupOutcome;
  idx: number;
  inputCost: number;
  color: string;
}) {
  const land = o.estimatedPrice != null ? o.estimatedPrice - inputCost : null;
  const roi =
    o.estimatedPrice != null && inputCost > 0
      ? ((o.estimatedPrice - inputCost) / inputCost) * 100
      : null;
  const rarity = rarityHex(o.skin.rarity.name);
  const spectrum = roiColor(roi);

  return (
    <div
      className="bracket"
      style={{
        position: "relative",
        border: "1px solid var(--line)",
        borderTop: `2px solid ${rarity}`,
        background: "var(--surface-2)",
        padding: "5px 6px 6px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        // ROI-driven highlight: an inset accent bar shaded red→yellow→green.
        boxShadow: roi == null ? undefined : `inset 4px 0 0 0 ${spectrum}`,
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
        <CardRow label="PRICE" value={usd(o.estimatedPrice)} />
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

function CardRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span className="hud" style={{ color: "var(--cream-dim)" }}>{label}</span>
      <span style={{ color: color ?? "var(--cream)" }}>{value}</span>
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
