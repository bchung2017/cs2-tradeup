"use client";

import { useEffect, useRef, useState } from "react";
import { WEAR_RANGES } from "@/types/cs2";
import type { Rarity, Skin, Wear } from "@/types/cs2";
import { rarityColor } from "@/lib/display";

interface Props {
  open: boolean;
  lockedRarity: Rarity | null; // null = first pick, any rarity allowed
  // The chosen float (from the wear/float form) is applied to whatever skin is
  // clicked, clamped to that skin's valid range.
  onPick: (skin: Skin, float: number) => void;
  onClose: () => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Mid-point of a wear band, rounded to hundredths — a realistic stand-in for an
// in-game float, vs. the 0.00 default that almost never occurs and skews prices.
function wearAvg(w: Wear): number {
  const r = WEAR_RANGES.find((x) => x.wear === w)!;
  return Math.round(((r.min + r.max) / 2) * 100) / 100;
}

const DEFAULT_WEAR: Wear = "Field-Tested";

export default function SkinPicker({ open, lockedRarity, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const [skins, setSkins] = useState<Skin[]>([]);
  const [loading, setLoading] = useState(false);
  // Wear/float form — the float here is applied to whichever skin is clicked.
  const [wear, setWear] = useState<Wear>(DEFAULT_WEAR);
  const [floatStr, setFloatStr] = useState<string>(() => wearAvg(DEFAULT_WEAR).toFixed(2));
  const inputRef = useRef<HTMLInputElement>(null);

  // Selecting a wear band sets the float to that band's average (editable after).
  function selectWear(w: Wear) {
    setWear(w);
    setFloatStr(wearAvg(w).toFixed(2));
  }

  // Resolve the form's float for a given skin: parse, fall back to the wear
  // average when blank/invalid, then clamp to the skin's valid float range.
  function floatFor(s: Skin): number {
    const parsed = parseFloat(floatStr);
    const base = Number.isFinite(parsed) ? parsed : wearAvg(wear);
    return clamp(base, s.min_float, s.max_float);
  }

  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (lockedRarity) params.set("rarity", lockedRarity);
    params.set("limit", "60");
    fetch(`/api/skins?${params}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setSkins(d.skins ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [q, lockedRarity, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5,5,5,0.82)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "8vh",
        zIndex: 100,
      }}
    >
      <div
        className="bracket"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          maxHeight: "78vh",
          background: "var(--void-2)",
          border: "1px solid var(--line)",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="hud hud-ember">SELECT INPUT</span>
          <span className="hud">
            {lockedRarity ? `LOCKED · ${lockedRarity}` : "RARITY UNLOCKED"}
          </span>
        </div>

        {/* wear/float form — applied to whichever skin is clicked below, so
            picks land on a realistic in-game float instead of 0.00 */}
        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="hud">WEAR</span>
            <select
              value={wear}
              onChange={(e) => selectWear(e.target.value as Wear)}
              style={{
                background: "var(--void)",
                border: "1px solid var(--line)",
                color: "var(--cream)",
                padding: "9px 10px",
                fontSize: 13,
                outline: "none",
              }}
            >
              {WEAR_RANGES.map((r) => (
                <option key={r.wear} value={r.wear}>
                  {r.wear} ({r.min.toFixed(2)}–{r.max.toFixed(2)})
                </option>
              ))}
            </select>
          </label>
          <label style={{ width: 110, display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="hud">FLOAT</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={floatStr}
              onChange={(e) => setFloatStr(e.target.value)}
              onBlur={() => {
                const n = parseFloat(floatStr);
                setFloatStr((Number.isFinite(n) ? clamp(n, 0, 1) : wearAvg(wear)).toFixed(2));
              }}
              style={{
                background: "var(--void)",
                border: "1px solid var(--line)",
                color: "var(--amber)",
                fontFamily: "var(--mono)",
                padding: "9px 10px",
                fontSize: 13,
                outline: "none",
                width: "100%",
              }}
            />
          </label>
        </div>

        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search skin name…"
          style={{
            marginTop: 14,
            background: "var(--void)",
            border: "1px solid var(--line)",
            color: "var(--cream)",
            padding: "10px 12px",
            fontSize: 13,
            outline: "none",
          }}
        />

        <div style={{ marginTop: 12, overflowY: "auto", flex: 1 }}>
          {loading && <div className="hud" style={{ padding: "8px 0" }}>QUERYING…</div>}
          {!loading && skins.length === 0 && (
            <div className="hud" style={{ padding: "8px 0" }}>NO MATCHES</div>
          )}
          {skins.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s, floatFor(s))}
              style={{
                display: "flex",
                width: "100%",
                justifyContent: "space-between",
                alignItems: "center",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--line)",
                color: "var(--cream)",
                padding: "10px 4px",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span>
                <span style={{ color: "var(--cream-dim)", fontSize: 11 }}>{s.weapon.name}</span>
                <br />
                <span style={{ fontSize: 13 }}>{s.name}</span>
              </span>
              <span style={{ textAlign: "right" }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    color: rarityColor(s.rarity.name),
                  }}
                >
                  {s.rarity.name}
                </span>
                <br />
                <span className="hud">
                  {s.min_float.toFixed(2)}–{s.max_float.toFixed(2)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
