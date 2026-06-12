"use client";

import { useEffect, useRef, useState } from "react";
import type { Rarity, Skin } from "@/types/cs2";
import { rarityColor } from "@/lib/display";

interface Props {
  open: boolean;
  lockedRarity: Rarity | null; // null = first pick, any rarity allowed
  onPick: (skin: Skin) => void;
  onClose: () => void;
}

export default function SkinPicker({ open, lockedRarity, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const [skins, setSkins] = useState<Skin[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
              onClick={() => onPick(s)}
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
