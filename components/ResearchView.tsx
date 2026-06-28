"use client";

// Research Lab — the consumer side of the trade-up engine. On load it resolves a
// profile, asks /api/research for ranked opportunities in that inventory, and
// shows them best-first: a profit gauge + outcome distribution per contract.
// Three kinds, split by a legible VIEW toggle: single-collection contracts,
// mixed-collection contracts, and near-miss "closest candidates" (collections
// you're a few items short of). "Load into Simulator" hands a contract off to the
// Trade Up console (see lib/contract-handoff). Backend shape: types/research.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usd, signedUsd, rarityHex } from "@/lib/display";
import { writeHandoff } from "@/lib/contract-handoff";
import PriceModal from "@/components/PriceModal";
import type { ResearchContract, ResearchNearMiss, ResearchOutcome, ResearchResponse } from "@/types/research";

// Same default the inventory loader uses, so the first scan lands on a known
// profile with no typing.
const DEFAULT_PROFILE = "https://steamcommunity.com/profiles/76561198059693930";
const DEFAULT_FEE = 0.15;

type SortKey = "pProfit" | "netEV";
type ViewKey = "all" | "single" | "mixed" | "closest" | "redpill";

interface ApiResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
}
async function api<T>(path: string, opts?: RequestInit): Promise<ApiResult<T>> {
  const r = await fetch(path, opts);
  let body: T | null;
  try {
    body = (await r.json()) as T;
  } catch {
    body = null;
  }
  return { ok: r.ok, status: r.status, body };
}

const pct = (p: number) => `${(p * 100).toFixed(0)}%`;

// Confidence tier from price coverage — full data vs partial vs sparse.
function confTier(c: ResearchContract["confidence"]): "full" | "partial" | "sparse" {
  if (c.pricedInputs >= c.inputCount && c.pricedProb >= 0.999) return "full";
  if (c.pricedProb >= 0.6) return "partial";
  return "sparse";
}
const CONF_COLOR = { full: "var(--profit)", partial: "var(--amber)", sparse: "var(--fg-faint)" } as const;

// Headline P(profit) color — brighter green the more likely.
function pColor(p: number): string {
  if (p >= 0.66) return "var(--green-hot)";
  if (p >= 0.33) return "var(--green)";
  if (p > 0) return "var(--amber)";
  return "var(--loss)";
}

export default function ResearchView({
  onInspect,
  selectedId,
  onInspectNear,
  selectedNearId,
}: {
  // When provided (workspace mode), clicking a contract/candidate drives the left
  // inspector instead of expanding inline; selected*Id keeps that card ringed.
  onInspect?: (c: ResearchContract) => void;
  selectedId?: string;
  onInspectNear?: (n: ResearchNearMiss) => void;
  selectedNearId?: string;
} = {}) {
  const router = useRouter();
  const [input, setInput] = useState(DEFAULT_PROFILE);
  const [steamid, setSteamid] = useState<string | null>(null);
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pProfit");
  const [view, setView] = useState<ViewKey>("all");
  const [rarityFilter, setRarityFilter] = useState<string>("ALL");
  const [hideLowConf, setHideLowConf] = useState(false);
  const [fee, setFee] = useState(DEFAULT_FEE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [priceModal, setPriceModal] = useState<{ name: string; sources?: Record<string, number> | null } | null>(null);

  const reqIdRef = useRef(0);

  const scan = useCallback(async (rawInput: string, feeRate: number) => {
    const raw = rawInput.trim();
    if (!raw) {
      setError("enter a profile / vanity / steamid64");
      return;
    }
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    // Resolve the profile to a steamid64 (reuses the inventory resolver).
    const res = await api<{ steamid: string; error?: string }>("/api/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: raw }),
    });
    if (myReq !== reqIdRef.current) return; // superseded by a newer scan
    if (!res.ok || !res.body?.steamid) {
      setLoading(false);
      setError(`couldn't resolve profile // ${res.body?.error ?? res.status}`);
      return;
    }
    const id = res.body.steamid;
    setSteamid(id);
    const r = await api<ResearchResponse>(`/api/research/${id}?fee=${feeRate}`);
    if (myReq !== reqIdRef.current) return;
    setLoading(false);
    if (!r.ok || !r.body) {
      // Backend not ready / no snapshot / error — degrade to an empty result,
      // not a crash. The endpoint may not exist yet during build-out.
      setData(null);
      setError(r.status === 404 ? "no inventory snapshot — sync it in the simulator first" : `scan failed // ${r.status}`);
      return;
    }
    setData(r.body);
  }, []);

  // Immediate: scan the default profile on mount so opportunities appear with no
  // interaction.
  useEffect(() => {
    scan(DEFAULT_PROFILE, DEFAULT_FEE);
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contracts = data?.contracts ?? [];
  const nearMisses = data?.nearMisses ?? [];
  const singleCount = useMemo(() => contracts.filter((c) => c.kind === "single").length, [contracts]);
  const mixedCount = useMemo(() => contracts.filter((c) => c.kind === "mixed").length, [contracts]);
  const oneCount = useMemo(() => contracts.filter((c) => c.theOne).length, [contracts]);

  // Rarities present across both contracts and near-misses, for the filter chips.
  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const c of contracts) set.add(c.inputRarity);
    for (const n of nearMisses) set.add(n.inputRarity);
    return [...set];
  }, [contracts, nearMisses]);

  // contracts to show: filtered by VIEW (kind) + rarity + confidence, then sorted.
  const shown = useMemo(() => {
    if (view === "closest") return [];
    let out = contracts;
    if (view === "single") out = out.filter((c) => c.kind === "single");
    else if (view === "mixed") out = out.filter((c) => c.kind === "mixed");
    else if (view === "redpill") out = out.filter((c) => c.theOne);
    if (rarityFilter !== "ALL") out = out.filter((c) => c.inputRarity === rarityFilter);
    if (hideLowConf) out = out.filter((c) => confTier(c.confidence) === "full");
    // RED PILL ranks by the size of the dream (multiple), not P(profit).
    if (view === "redpill") {
      return [...out].sort(
        (a, b) => b.theOne!.multiple - a.theOne!.multiple || b.theOne!.probability - a.theOne!.probability,
      );
    }
    const key = sortKey;
    return [...out].sort((a, b) =>
      key === "pProfit" ? b.pProfit - a.pProfit || b.netEV - a.netEV : b.netEV - a.netEV || b.pProfit - a.pProfit,
    );
  }, [contracts, view, rarityFilter, hideLowConf, sortKey]);

  // near-misses to show: only in ALL / CLOSEST views, rarity-filtered.
  const shownNear = useMemo(() => {
    if (view !== "all" && view !== "closest") return [];
    return rarityFilter === "ALL" ? nearMisses : nearMisses.filter((n) => n.inputRarity === rarityFilter);
  }, [nearMisses, view, rarityFilter]);

  const best = useMemo(
    () => [...contracts].sort((a, b) => b.pProfit - a.pProfit || b.netEV - a.netEV)[0] ?? null,
    [contracts],
  );
  const hasAny = contracts.length > 0 || nearMisses.length > 0;
  const contractsControlsActive = view !== "closest" && contracts.length > 0;

  const loadIntoSimulator = useCallback(
    (c: ResearchContract) => {
      writeHandoff(c);
      router.push("/");
    },
    [router],
  );

  // available VIEW tabs — only show a tab when it has content, so no dead toggles.
  const viewTabs: { key: ViewKey; label: string }[] = [
    { key: "all", label: "ALL" },
    ...(singleCount ? [{ key: "single" as ViewKey, label: `SINGLE ${singleCount}` }] : []),
    ...(mixedCount ? [{ key: "mixed" as ViewKey, label: `MIXED ${mixedCount}` }] : []),
    ...(oneCount ? [{ key: "redpill" as ViewKey, label: `RED PILL ${oneCount}` }] : []),
    ...(nearMisses.length ? [{ key: "closest" as ViewKey, label: `CLOSEST ${nearMisses.length}` }] : []),
  ];

  return (
    <>
      <main style={{ padding: "16px 24px 80px", position: "relative", zIndex: 1 }}>
        {/* header */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <span className="hud hud-ember">OPPORTUNITY SCANNER</span>
            <h1 className="glow" style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 22, margin: "4px 0 0", color: "var(--green)" }}>
              <span style={{ color: "var(--green-dim)" }}>$ </span>research
              <span style={{ color: "var(--green-faint)", fontWeight: 400 }}> --inventory</span>
            </h1>
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") scan(input, fee); }}
            placeholder="profile url / vanity / steamid64"
            style={{ flex: "1 1 260px", background: "var(--void)", border: "1px solid var(--surface-line)", color: "var(--amber)", padding: "10px 12px", fontSize: 14, outline: "none" }}
          />
          <button
            onClick={() => scan(input, fee)}
            disabled={loading}
            style={{ background: loading ? "var(--line)" : "var(--ember)", color: loading ? "var(--cream-dim)" : "var(--void)", border: "none", padding: "10px 22px", fontSize: 12, letterSpacing: "0.18em", fontWeight: 700 }}
          >
            {loading ? "SCANNING…" : "SCAN"}
          </button>
        </div>

        {/* summary banner — the immediate answer */}
        <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--surface-line)" }}>
          {loading ? (
            <span className="hud" style={{ color: "var(--fg-dim)" }}>scanning inventory for contracts…</span>
          ) : error ? (
            <span className="hud" style={{ color: "var(--amber)" }}>{error}</span>
          ) : data ? (
            <span className="hud" style={{ color: "var(--fg-dim)", display: "flex", flexWrap: "wrap", gap: 18, alignItems: "baseline" }}>
              <span><strong style={{ color: "var(--green)", fontSize: 14 }}>{contracts.length}</strong> contracts</span>
              {nearMisses.length > 0 && <span><strong style={{ color: "var(--amber)", fontSize: 14 }}>{nearMisses.length}</strong> close</span>}
              {best && <span>best: <strong style={{ color: pColor(best.pProfit) }}>{pct(best.pProfit)}</strong> likely · <strong style={{ color: best.netEV >= 0 ? "var(--profit)" : "var(--loss)" }}>{signedUsd(best.netEV)}</strong> EV</span>}
              <span>from <strong style={{ color: "var(--fg)" }}>{data.eligibleItems}</strong> eligible items</span>
              <span style={{ marginLeft: "auto" }}>P(profit) · {pct(data.feeRate)} fee</span>
            </span>
          ) : (
            <span className="hud" style={{ color: "var(--fg-faint)" }}>no scan yet</span>
          )}
        </div>

        {/* controls */}
        {data && hasAny && (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* VIEW toggle — the legible split between contract kinds + closest candidates */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="hud">VIEW</span>
              {viewTabs.map((t) => (
                <Chip
                  key={t.key}
                  active={view === t.key}
                  onClick={() => setView(t.key)}
                  label={t.label}
                  color={t.key === "redpill" ? "var(--loss)" : undefined}
                />
              ))}
            </div>

            {/* contract controls — only when a contract list is on screen */}
            {contractsControlsActive && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {view === "redpill" ? (
                  <span className="hud" style={{ color: "var(--loss)" }}>SORT · by hit size</span>
                ) : (
                  <>
                    <span className="hud">SORT</span>
                    {(["pProfit", "netEV"] as SortKey[]).map((k) => (
                      <Chip key={k} active={sortKey === k} onClick={() => setSortKey(k)} label={k === "pProfit" ? "P(profit)" : "net EV"} />
                    ))}
                  </>
                )}
                <span className="hud" style={{ marginLeft: 8 }}>RARITY</span>
                <Chip active={rarityFilter === "ALL"} onClick={() => setRarityFilter("ALL")} label="ALL" color="var(--green)" />
                {rarities.map((r) => (
                  <Chip key={r} active={rarityFilter === r} onClick={() => setRarityFilter(r)} label={r} color={rarityHex(r)} />
                ))}
                <label className="hud" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--fg-dim)" }}>
                  <input type="checkbox" checked={hideLowConf} onChange={(e) => setHideLowConf(e.target.checked)} />
                  FULL-DATA ONLY
                </label>
                <label className="hud" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-dim)" }} title="Marketplace fee subtracted from outcome prices">
                  FEE
                  <input
                    type="number"
                    min={0}
                    max={0.5}
                    step={0.01}
                    value={fee}
                    onChange={(e) => setFee(Number(e.target.value))}
                    onBlur={() => scan(input, fee)}
                    onKeyDown={(e) => { if (e.key === "Enter") scan(input, fee); }}
                    style={{ width: 64, background: "var(--void)", border: "1px solid var(--surface-line)", color: "var(--amber)", padding: "3px 6px", fontFamily: "var(--mono)", fontSize: 11 }}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* empty: scanned, but nothing at all */}
        {!loading && data && !hasAny && (
          <div className="hud" style={{ marginTop: 28, color: "var(--fg-faint)" }}>
            no contracts or close candidates in this inventory — you need ~10 of one rarity. more appear as prices fill in
          </div>
        )}

        {/* red pill intro — what the default ranking hides */}
        {view === "redpill" && shown.length > 0 && (
          <div className="hud" style={{ marginTop: 18, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", letterSpacing: "0.16em" }}>
            <span className="glow" style={{ color: "var(--loss)" }}>◉ RED PILL</span>
            <span style={{ color: "var(--fg-faint)", letterSpacing: "normal" }}>
              what the ranking hides — each has a rare outcome (the One) that pays a huge multiple. you lose most rolls; the One is the dream.
            </span>
          </div>
        )}

        {/* contract list */}
        {view !== "closest" && shown.length > 0 && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map((c, i) => (
              <OpportunityRow
                key={c.id}
                rank={i + 1}
                contract={c}
                expanded={expanded === c.id}
                onToggle={() => setExpanded((e) => (e === c.id ? null : c.id))}
                onLoad={() => loadIntoSimulator(c)}
                onOutcomePrice={(name, sources) => setPriceModal({ name, sources })}
                onInspect={onInspect ? () => onInspect(c) : undefined}
                selected={selectedId === c.id}
              />
            ))}
          </div>
        )}

        {/* closest candidates */}
        {shownNear.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div className="hud hud-amber" style={{ marginBottom: 10, letterSpacing: "0.18em" }}>
              CLOSEST CANDIDATES · a few items short of a contract
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
              {shownNear.map((n) => (
                <NearMissCard
                  key={n.id}
                  miss={n}
                  onOutputPrice={(name) => setPriceModal({ name })}
                  onSelect={onInspectNear ? () => onInspectNear(n) : undefined}
                  selected={selectedNearId === n.id}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {priceModal && (
        <PriceModal name={priceModal.name} priceSources={priceModal.sources ?? undefined} onClose={() => setPriceModal(null)} />
      )}
    </>
  );
}

// ---- row ------------------------------------------------------------------

function OpportunityRow({
  rank,
  contract: c,
  expanded,
  onToggle,
  onLoad,
  onOutcomePrice,
  onInspect,
  selected,
}: {
  rank: number;
  contract: ResearchContract;
  expanded: boolean;
  onToggle: () => void;
  onLoad: () => void;
  onOutcomePrice: (name: string, sources?: Record<string, number> | null) => void;
  onInspect?: () => void;
  selected?: boolean;
}) {
  const tier = confTier(c.confidence);
  // Workspace mode (onInspect set): the row drives the left inspector and the
  // selected row stays ringed. Standalone: rank #1 gets the ring.
  const highlight = onInspect ? !!selected : rank === 1;
  return (
    <div
      className={`card-hover${highlight ? " card-selected" : ""}`}
      style={{
        background: "var(--surface)",
        borderLeft: `3px solid ${rarityHex(c.inputRarity)}`,
        borderTop: "1px solid var(--surface-line)",
        borderRight: "1px solid var(--surface-line)",
        borderBottom: "1px solid var(--surface-line)",
        padding: "12px 14px",
        opacity: tier === "sparse" ? 0.7 : 1,
      }}
    >
      {/* collapsed summary */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer", flexWrap: "wrap" }} onClick={onInspect ?? onToggle}>
        <span className="hud" style={{ color: "var(--fg-faint)", width: 26 }}>#{rank}</span>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            <KindTag kind={c.kind} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.collection.name}</span>
          </div>
          <div className="hud" style={{ color: "var(--fg-faint)", marginTop: 2 }}>
            {c.inputRarity} → {c.outputRarity}{c.stattrak ? " · ST" : ""} · {c.strategy}
          </div>
        </div>
        <Stat label="P(PROFIT)" value={pct(c.pProfit)} color={pColor(c.pProfit)} big glow />
        <Stat label="NET EV" value={signedUsd(c.netEV)} color={c.netEV >= 0 ? "var(--profit)" : "var(--loss)"} />
        <Stat label="COST" value={usd(c.inputCost)} color="var(--fg)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 92 }}>
          <span className="hud" style={{ color: "var(--fg-faint)" }}>BEST / WORST</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
            <span style={{ color: "var(--profit)" }}>{c.best ? signedUsd(c.best.netPrice - c.inputCost) : "—"}</span>
            <span style={{ color: "var(--fg-faint)" }}> / </span>
            <span style={{ color: "var(--loss)" }}>{c.worst ? signedUsd(c.worst.netPrice - c.inputCost) : "—"}</span>
          </span>
        </div>
        <ConfidenceBadge tier={tier} c={c.confidence} />
        <button
          onClick={(e) => { e.stopPropagation(); onLoad(); }}
          title="Stage this contract in the Trade Up Simulator"
          style={{ background: "transparent", border: "1px solid var(--green-dim)", color: "var(--green)", padding: "7px 12px", fontSize: 11, letterSpacing: "0.12em" }}
        >
          LOAD →
        </button>
        <span className="hud" style={{ color: onInspect ? "var(--green)" : "var(--fg-faint)", width: 14 }}>{onInspect ? "→" : expanded ? "▾" : "▸"}</span>
      </div>

      {/* profit gauge — always visible, the at-a-glance read */}
      <ProfitGauge contract={c} />

      {/* the One — the rare big-multiple hit the default ranking hides (RED PILL) */}
      {c.theOne && <TheOneStrip one={c.theOne} />}

      {/* inline detail — only standalone; in workspace mode the inspector shows it */}
      {!onInspect && expanded && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          <OutcomeBars contract={c} onPrice={onOutcomePrice} />
          <InputsStrip contract={c} onPrice={onOutcomePrice} />
        </div>
      )}
    </div>
  );
}

function KindTag({ kind }: { kind: ResearchContract["kind"] }) {
  const mixed = kind === "mixed";
  return (
    <span
      className="hud"
      title={mixed ? "Inputs span multiple collections (lower odds from dilution)" : "All inputs from one collection"}
      style={{
        flex: "0 0 auto",
        color: mixed ? "var(--amber)" : "var(--green-dim)",
        border: `1px solid ${mixed ? "var(--amber)" : "var(--green-dim)"}`,
        padding: "1px 5px",
        fontSize: 9,
        letterSpacing: "0.1em",
      }}
    >
      {mixed ? "MIXED" : "SINGLE"}
    </span>
  );
}

// "The One" — the rare, high-multiple hit. CRT-red framed so it reads as the
// dangerous-but-tempting longshot the default ranking buries.
function TheOneStrip({ one }: { one: NonNullable<ResearchContract["theOne"]> }) {
  return (
    <div
      title="A rare, high-multiple outcome — invisible in the default P(profit) ranking"
      style={{
        marginTop: 8,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        border: "1px solid var(--loss)",
        background: "rgba(255,107,90,0.06)",
        flexWrap: "wrap",
      }}
    >
      <span className="hud glow" style={{ color: "var(--loss)", letterSpacing: "0.16em", whiteSpace: "nowrap" }}>◉ THE ONE</span>
      <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 12, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={one.name}>
        {one.name}
      </span>
      <span className="glow" style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 16, color: "var(--green-hot)" }}>
        {one.multiple.toFixed(1)}×
      </span>
      <span className="hud" style={{ color: "var(--fg-faint)", whiteSpace: "nowrap" }}>{pct(one.probability)} hit</span>
      <span style={{ fontFamily: "var(--mono)", color: "var(--profit)", whiteSpace: "nowrap" }}>{usd(one.netPrice)}</span>
    </div>
  );
}

function Stat({ label, value, color, big, glow }: { label: string; value: string; color: string; big?: boolean; glow?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: big ? 78 : 64 }}>
      <span className="hud" style={{ color: "var(--fg-faint)" }}>{label}</span>
      <span className={glow ? "glow" : undefined} style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: big ? 20 : 13, color, letterSpacing: "-0.01em" }}>
        {value}
      </span>
    </div>
  );
}

function ConfidenceBadge({ tier, c }: { tier: "full" | "partial" | "sparse"; c: ResearchContract["confidence"] }) {
  const label = tier === "full" ? "full data" : tier === "partial" ? "partial" : "sparse";
  return (
    <span
      className="hud"
      title={`Price coverage, not odds: ${c.pricedInputs}/${c.inputCount} inputs priced, ${pct(c.pricedProb)} of outcome probability priced`}
      style={{ color: CONF_COLOR[tier], border: `1px solid ${CONF_COLOR[tier]}`, padding: "2px 6px", whiteSpace: "nowrap" }}
    >
      {label}
    </span>
  );
}

// ---- profit gauge ---------------------------------------------------------

function ProfitGauge({ contract: c }: { contract: ResearchContract }) {
  const win = Math.max(0, Math.min(1, c.pProfit));
  const pricedLoss = Math.max(0, Math.min(1 - win, c.confidence.pricedProb - win));
  const unpriced = Math.max(0, 1 - c.confidence.pricedProb);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", height: 10, background: "var(--void)", border: "1px solid var(--surface-line)", overflow: "hidden" }}>
        <span style={{ width: `${win * 100}%`, background: "var(--profit)", boxShadow: "0 0 8px rgba(92,255,92,0.5)" }} />
        <span style={{ width: `${pricedLoss * 100}%`, background: "var(--loss)" }} />
        <span style={{ width: `${unpriced * 100}%`, background: "repeating-linear-gradient(45deg, var(--surface-2) 0 4px, transparent 4px 8px)" }} />
      </div>
      <div className="hud" style={{ marginTop: 4, display: "flex", gap: 14, color: "var(--fg-faint)" }}>
        <span style={{ color: "var(--profit)" }}>■ {pct(win)} profit</span>
        {pricedLoss > 0.001 && <span style={{ color: "var(--loss)" }}>■ {pct(pricedLoss)} loss</span>}
        {unpriced > 0.001 && <span>▦ {pct(unpriced)} unpriced</span>}
      </div>
    </div>
  );
}

// ---- outcome distribution -------------------------------------------------

function OutcomeBars({ contract: c, onPrice }: { contract: ResearchContract; onPrice: (name: string, s?: Record<string, number> | null) => void }) {
  const maxProb = Math.max(...c.outcomes.map((o) => o.probability), 0.0001);
  return (
    <div>
      <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 6 }}>OUTCOMES · breakeven {usd(c.inputCost)}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {c.outcomes.map((o, i) => {
          const name = outcomeName(o);
          const priced = o.netPrice != null;
          const profit = priced && o.netPrice! > c.inputCost;
          const barColor = !priced ? "var(--surface-2)" : profit ? "var(--profit)" : "var(--loss)";
          const w = (o.probability / maxProb) * 100;
          return (
            <div key={`${o.skin.id}-${o.wear}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <span style={{ flex: "0 0 200px", color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
                {name}
              </span>
              <div style={{ flex: 1, height: 14, background: "var(--void)", position: "relative", minWidth: 80 }}>
                <span
                  style={{
                    position: "absolute", inset: 0, width: `${w}%`,
                    background: priced ? barColor : "repeating-linear-gradient(45deg, var(--surface-2) 0 4px, transparent 4px 8px)",
                    opacity: priced ? 0.85 : 1,
                  }}
                />
              </div>
              <span className="hud" style={{ flex: "0 0 42px", textAlign: "right", color: "var(--fg-dim)" }}>{pct(o.probability)}</span>
              {priced ? (
                <button
                  type="button"
                  onClick={() => onPrice(name, o.priceSources)}
                  className="hud"
                  title="Price breakdown"
                  style={{ flex: "0 0 64px", textAlign: "right", background: "transparent", border: "none", color: "var(--green)", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3, font: "inherit", cursor: "pointer" }}
                >
                  {usd(o.netPrice)}
                </button>
              ) : (
                <span className="hud" style={{ flex: "0 0 64px", textAlign: "right", color: "var(--fg-faint)" }}>no price</span>
              )}
              <span style={{ flex: "0 0 64px", textAlign: "right", fontFamily: "var(--mono)", color: profit ? "var(--profit)" : priced ? "var(--loss)" : "var(--fg-faint)" }}>
                {priced ? signedUsd(o.netPrice! - c.inputCost) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- inputs strip ---------------------------------------------------------

function InputsStrip({ contract: c, onPrice }: { contract: ResearchContract; onPrice: (name: string, s?: Record<string, number> | null) => void }) {
  return (
    <div>
      <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 6 }}>INPUTS · {c.inputs.length} consumed · {usd(c.inputCost)} sell value</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {c.inputs.map((it, i) => (
          <div key={`${it.assetid}-${i}`} style={{ background: "var(--void)", border: `1px solid ${rarityHex(c.inputRarity)}`, borderLeftWidth: 3, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, lineHeight: 1.3, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.name}>
              {it.name}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--green)" }} title="float">{it.float.toFixed(4)}</span>
              {it.price != null ? (
                <button type="button" onClick={() => onPrice(it.name, it.priceSources)} className="hud" style={{ background: "transparent", border: "none", color: "var(--green)", font: "inherit", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>
                  {usd(it.price)}
                </button>
              ) : (
                <span className="hud" style={{ color: "var(--fg-faint)" }}>no price</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- near-miss card -------------------------------------------------------

function NearMissCard({
  miss: n,
  onOutputPrice,
  onSelect,
  selected,
}: {
  miss: ResearchNearMiss;
  onOutputPrice: (name: string) => void;
  onSelect?: () => void;
  selected?: boolean;
}) {
  const have = Math.min(n.have, 10);
  const top = n.outputs.slice(0, 4);
  const rest = n.outputs.length - top.length;
  return (
    <div
      onClick={onSelect}
      className={onSelect ? `card-hover${selected ? " card-selected" : ""}` : undefined}
      style={{
        background: "var(--surface)",
        borderLeft: `3px solid ${rarityHex(n.inputRarity)}`,
        borderTop: "1px solid var(--surface-line)",
        borderRight: "1px solid var(--surface-line)",
        borderBottom: "1px solid var(--surface-line)",
        padding: "12px 14px",
        cursor: onSelect ? "pointer" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n.collection.name}>
          {n.collection.name}
        </div>
        <span className="hud" style={{ color: "var(--amber)", whiteSpace: "nowrap" }}>need {n.need}</span>
      </div>
      <div className="hud" style={{ color: "var(--fg-faint)", marginTop: 2 }}>
        {n.inputRarity} → {n.outputRarity}{n.stattrak ? " · ST" : ""}
      </div>

      {/* have / 10 progress */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", height: 8, gap: 2 }}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} style={{ flex: 1, background: i < have ? rarityHex(n.inputRarity) : "var(--void)", border: "1px solid var(--surface-line)" }} />
          ))}
        </div>
        <div className="hud" style={{ marginTop: 4, color: "var(--fg-dim)" }}>
          have <strong style={{ color: "var(--fg)" }}>{n.have}</strong> / 10
        </div>
      </div>

      {/* buy-in to finish: cheapest → priciest fillers × need */}
      {(n.buyIn.floor != null || n.buyIn.ceiling != null) && (
        <div className="hud" style={{ marginTop: 6, color: "var(--fg-dim)" }} title={`Cost to buy the ${n.need} remaining skins: cheapest vs priciest filler in the collection`}>
          buy-in{" "}
          <strong style={{ color: "var(--amber)" }}>{usd(n.buyIn.floor)}</strong>
          <span style={{ color: "var(--fg-faint)" }}> – </span>
          <strong style={{ color: "var(--amber)" }}>{usd(n.buyIn.ceiling)}</strong>
        </div>
      )}

      {/* reward pool */}
      {top.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 4 }}>ROLLS FOR</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {top.map((o, i) => (
              <button
                key={`${o.name}-${i}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); onOutputPrice(o.name); }}
                title="Price breakdown"
                style={{ display: "flex", justifyContent: "space-between", gap: 8, background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "var(--fg-dim)", fontSize: 12 }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                <span style={{ color: o.netPrice != null ? "var(--green)" : "var(--fg-faint)", whiteSpace: "nowrap" }}>
                  {o.netPrice != null ? usd(o.netPrice) : "—"}
                </span>
              </button>
            ))}
            {rest > 0 && <span className="hud" style={{ color: "var(--fg-faint)" }}>+{rest} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- helpers --------------------------------------------------------------

// Build a market-name string for an outcome so PriceModal can resolve wear +
// per-marketplace links. Catalog skins carry weapon.name + paint name.
function outcomeName(o: ResearchOutcome): string {
  // Catalog name already includes the weapon ("AK-47 | Redline").
  return `${o.skin.name} (${o.wear})`;
}

function Chip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  const c = color ?? "var(--green)";
  return (
    <button
      onClick={onClick}
      className="hud"
      style={{
        background: active ? c : "transparent",
        color: active ? "var(--void)" : "var(--fg-dim)",
        border: `1px solid ${active ? c : "var(--surface-line)"}`,
        padding: "4px 9px",
        letterSpacing: "0.08em",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

// Reused by the workspace inspector (components/ContractInspector) so a clicked
// contract's detail renders with the exact same pieces as the inline expansion.
export {
  ProfitGauge,
  OutcomeBars,
  InputsStrip,
  KindTag,
  Stat,
  ConfidenceBadge,
  TheOneStrip,
  pct,
  pColor,
  confTier,
  outcomeName,
};
