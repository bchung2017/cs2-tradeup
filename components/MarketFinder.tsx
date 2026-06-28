"use client";

// Market tab of the Research Lab — the "spam trade-up" finder. Not inventory-bound:
// it scans every collection, derives the cheapest filler + steering recipe that
// lands the chosen target wear (configurable), scores it net of fee, and shows the
// repeated-play economics. Two modes: GRIND (slow & steady, max P(profit)) and
// JACKPOT (max tail). Backend: /api/spam → lib/spam-search.
import { useCallback, useEffect, useMemo, useState } from "react";
import { usd, signedUsd, rarityHex } from "@/lib/display";
import type { SpamContract } from "@/lib/spam-search";
import type { Wear } from "@/types/cs2";

const WEARS: Wear[] = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
const WEAR_ABBR: Record<Wear, string> = {
  "Factory New": "FN", "Minimal Wear": "MW", "Field-Tested": "FT", "Well-Worn": "WW", "Battle-Scarred": "BS",
};
type Mode = "grind" | "jackpot";
const pct = (p: number) => `${(p * 100).toFixed(0)}%`;

export default function MarketFinder() {
  const [targetWear, setTargetWear] = useState<Wear>("Field-Tested");
  const [fee, setFee] = useState(0.15);
  const [mode, setMode] = useState<Mode>("grind");
  const [data, setData] = useState<SpamContract[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const scan = useCallback(async (wear: Wear, feeRate: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/spam?wear=${encodeURIComponent(wear)}&fee=${feeRate}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? `error ${r.status}`);
      setData(body.contracts as SpamContract[]);
    } catch (e) {
      setError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { scan(targetWear, fee); /* eslint-disable-next-line */ }, [targetWear]);

  const shown = useMemo(() => {
    const list = data ?? [];
    if (mode === "grind") {
      // slow & steady: only +EV, ranked by how often you profit
      return [...list].filter((c) => c.netEV >= 0).sort((a, b) => b.pProfit - a.pProfit || b.netEV - a.netEV);
    }
    // jackpot: rank by expected jackpot contribution (size × hit-rate)
    return [...list]
      .filter((c) => c.jackpot)
      .sort((a, b) => (b.jackpot!.netPrice * b.jackpot!.probability) - (a.jackpot!.netPrice * a.jackpot!.probability));
  }, [data, mode]);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 24px 80px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="hud hud-ember">SPAM TRADE-UP FINDER · MARKET-WIDE</span>
          <h1 className="glow" style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 22, margin: "4px 0 0", color: "var(--green)" }}>
            <span style={{ color: "var(--green-dim)" }}>$ </span>spam<span style={{ color: "var(--green-faint)", fontWeight: 400 }}> --market</span>
          </h1>
        </div>
      </div>

      {/* controls */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="hud">MODE</span>
          <Chip active={mode === "grind"} onClick={() => setMode("grind")} label="GRIND · slow & steady" />
          <Chip active={mode === "jackpot"} onClick={() => setMode("jackpot")} label="JACKPOT · swing big" color="var(--loss)" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="hud">TARGET WEAR</span>
          {WEARS.map((w) => (
            <Chip key={w} active={targetWear === w} onClick={() => setTargetWear(w)} label={WEAR_ABBR[w]} />
          ))}
          <label className="hud" style={{ marginLeft: 8, display: "flex", alignItems: "center", gap: 6, color: "var(--fg-dim)" }}>
            FEE
            <input type="number" min={0} max={0.5} step={0.01} value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
              onBlur={() => scan(targetWear, fee)}
              onKeyDown={(e) => { if (e.key === "Enter") scan(targetWear, fee); }}
              style={{ width: 60, background: "var(--void)", border: "1px solid var(--surface-line)", color: "var(--amber)", padding: "3px 6px", fontFamily: "var(--mono)", fontSize: 11 }} />
          </label>
          <span className="hud" style={{ marginLeft: "auto", color: "var(--fg-faint)" }}>
            {loading ? "scanning…" : `${shown.length} contracts`}
          </span>
        </div>
      </div>

      {error && <div className="hud" style={{ marginTop: 16, color: "var(--amber)" }}>scan failed — {error}</div>}
      {!loading && data && shown.length === 0 && (
        <div className="hud" style={{ marginTop: 24, color: "var(--fg-faint)" }}>
          nothing here at {WEAR_ABBR[targetWear]} · {mode === "grind" ? "no +EV grinds — try JACKPOT mode" : "no jackpots — try a different target wear"}
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.slice(0, 50).map((c, i) => (
          <SpamRow key={c.id} rank={i + 1} c={c} mode={mode} expanded={expanded === c.id} onToggle={() => setExpanded((e) => (e === c.id ? null : c.id))} />
        ))}
      </div>
    </main>
  );
}

function SpamRow({ rank, c, mode, expanded, onToggle }: { rank: number; c: SpamContract; mode: Mode; expanded: boolean; onToggle: () => void }) {
  const r = c.recipe;
  const top = rank === 1;
  const jpProfit = c.jackpot ? c.jackpot.netPrice - c.perRunCost : null;
  return (
    <div className={`card-hover${top ? " card-selected" : ""}`} style={{
      background: "var(--surface)", borderLeft: `3px solid ${rarityHex(c.inputRarity)}`,
      borderTop: "1px solid var(--surface-line)", borderRight: "1px solid var(--surface-line)", borderBottom: "1px solid var(--surface-line)",
      padding: "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer", flexWrap: "wrap" }} onClick={onToggle}>
        <span className="hud" style={{ color: "var(--fg-faint)", width: 24 }}>#{rank}</span>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.collection.name} <span style={{ color: "var(--fg-faint)" }}>· {c.inputRarity}→{c.outputRarity}{c.stattrak ? " · ST" : ""}</span>
          </div>
          <div className="hud" style={{ color: "var(--fg-faint)", marginTop: 2 }}>
            {r.fillerCount}× {WEAR_ABBR[r.fillerWear]} + {r.steerCount}× {WEAR_ABBR[r.steerWear]} ≤{r.steerFloatCeiling.toFixed(3)}
          </div>
        </div>
        <Stat label="COST/RUN" value={usd(c.perRunCost)} color="var(--fg)" />
        {mode === "grind" ? (
          <>
            <Stat label="P(PROFIT)" value={pct(c.pProfit)} color={c.pProfit >= 0.66 ? "var(--green-hot)" : c.pProfit >= 0.4 ? "var(--green)" : "var(--amber)"} big glow />
            <Stat label="NET EV/RUN" value={signedUsd(c.netEV)} color={c.netEV >= 0 ? "var(--profit)" : "var(--loss)"} />
          </>
        ) : (
          <>
            <Stat label="JACKPOT" value={usd(c.jackpot?.netPrice ?? null)} color="var(--green-hot)" big glow />
            <Stat label="ODDS" value={c.jackpot ? `${pct(c.jackpot.probability)}` : "—"} color="var(--amber)" />
            <Stat label="IF HIT" value={jpProfit != null ? signedUsd(jpProfit) : "—"} color={jpProfit != null && jpProfit >= 0 ? "var(--profit)" : "var(--loss)"} />
          </>
        )}
        <span className="hud" style={{ color: "var(--fg-faint)", width: 14 }}>{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* the recipe */}
          <div className="hud" style={{ color: "var(--fg-dim)", lineHeight: 1.8 }}>
            <div>BUY <strong style={{ color: "var(--fg)" }}>{r.fillerCount}×</strong> {r.fillerWear} <span style={{ color: "var(--amber)" }}>{r.fillerSkin.name}</span> ({usd(r.fillerSkin.price)} ea — float irrelevant, capped)</div>
            <div>BUY <strong style={{ color: "var(--fg)" }}>{r.steerCount}×</strong> {r.steerWear} <span style={{ color: "var(--amber)" }}>{r.steerSkin.name}</span> under float <strong style={{ color: "var(--green)" }}>{r.steerFloatCeiling.toFixed(3)}</strong> ({usd(r.steerSkin.price)} ea)</div>
          </div>
          {/* run economics */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Stat label="MEDIAN RUNS TO HIT" value={Number.isFinite(c.runsToHitMedian) ? c.runsToHitMedian.toFixed(1) : "∞"} color="var(--fg)" />
            <Stat label="STAKE (90% A HIT)" value={Number.isFinite(c.stake90) ? usd(c.stake90) : "∞"} color="var(--amber)" />
            <Stat label="NET EV/RUN" value={signedUsd(c.netEV)} color={c.netEV >= 0 ? "var(--profit)" : "var(--loss)"} />
          </div>
          {/* outcome distribution */}
          <div>
            <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 6 }}>EVERY ROLL · breakeven {usd(c.perRunCost)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))", gap: 8 }}>
              {c.outcomes.map((o, j) => {
                const win = o.netPrice != null && o.netPrice > c.perRunCost;
                return (
                  <div key={`${o.name}-${j}`} style={{ background: "var(--void)", border: `1px solid ${win ? "var(--profit)" : "var(--surface-line)"}`, borderLeftWidth: 3 }}>
                    <div style={{ height: 54, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {o.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.image} alt="" loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                      ) : <span className="hud" style={{ color: "var(--fg-faint)" }}>—</span>}
                    </div>
                    <div style={{ padding: "5px 7px" }}>
                      <div style={{ fontSize: 10, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.name}>{o.name}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: o.netPrice == null ? "var(--fg-faint)" : win ? "var(--profit)" : "var(--loss)" }}>{usd(o.netPrice)}</span>
                        <span className="hud" style={{ color: "var(--fg-faint)" }}>{pct(o.probability)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, big, glow }: { label: string; value: string; color: string; big?: boolean; glow?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: big ? 80 : 70 }}>
      <span className="hud" style={{ color: "var(--fg-faint)" }}>{label}</span>
      <span className={glow ? "glow" : undefined} style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: big ? 18 : 13, color }}>{value}</span>
    </div>
  );
}

function Chip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  const c = color ?? "var(--green)";
  return (
    <button onClick={onClick} className="hud" style={{
      background: active ? c : "transparent", color: active ? "var(--void)" : "var(--fg-dim)",
      border: `1px solid ${active ? c : "var(--surface-line)"}`, padding: "4px 9px", letterSpacing: "0.08em", cursor: "pointer",
    }}>{label}</button>
  );
}
