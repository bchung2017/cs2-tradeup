"use client";

// Left pane of the Research workspace. Empty until something is clicked in the
// research list (right). It inspects either:
//  - a CONTRACT — full trade-offs: metrics, profit gauge, the One, outcome
//    distribution, and the exact inputs consumed (reusing ResearchView's pieces);
//  - a CANDIDATE (near-miss) — the items you ALREADY own toward it (so you can see
//    what you have, not just "7/10"), how many more you need, and the reward pool.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usd, signedUsd, rarityHex, oddsString } from "@/lib/display";
import { writeHandoff } from "@/lib/contract-handoff";
import PriceModal from "@/components/PriceModal";
import type { TradeupResult } from "@/types/cs2";
import {
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
} from "@/components/ResearchView";
import type { ResearchBuyOption, ResearchContract, ResearchNearMiss } from "@/types/research";

export type InspectorSelection =
  | { kind: "contract"; contract: ResearchContract }
  | { kind: "near"; miss: ResearchNearMiss };

export default function ContractInspector({ selection }: { selection: InspectorSelection | null }) {
  const [priceModal, setPriceModal] = useState<{ name: string; sources?: Record<string, number> | null } | null>(null);
  const onPrice = (name: string, sources?: Record<string, number> | null) => setPriceModal({ name, sources });

  return (
    <div style={{ padding: "16px 24px 60px" }}>
      <span className="hud hud-ember">◉ INSPECTOR</span>
      {selection == null && <EmptyState />}
      {selection?.kind === "contract" && <ContractDetail c={selection.contract} onPrice={onPrice} />}
      {selection?.kind === "near" && <CandidateDetail key={selection.miss.id} n={selection.miss} onPrice={(name) => onPrice(name)} />}

      {priceModal && (
        <PriceModal name={priceModal.name} priceSources={priceModal.sources ?? undefined} onClose={() => setPriceModal(null)} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        marginTop: 16,
        padding: "40px 20px",
        border: "1px dashed var(--surface-line)",
        color: "var(--fg-faint)",
        textAlign: "center",
        fontSize: 13,
        lineHeight: 1.8,
      }}
    >
      <div className="hud" style={{ letterSpacing: "0.18em" }}>NOTHING SELECTED</div>
      <div style={{ marginTop: 8 }}>click a contract or candidate on the right to inspect it</div>
    </div>
  );
}

// ---- contract -------------------------------------------------------------

function ContractDetail({ c, onPrice }: { c: ResearchContract; onPrice: (name: string, s?: Record<string, number> | null) => void }) {
  const router = useRouter();
  const tier = confTier(c.confidence);
  return (
    <>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <KindTag kind={c.kind} />
        <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 16, color: "var(--fg)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.collection.name}>
          {c.collection.name}
        </h2>
      </div>
      <div className="hud" style={{ color: "var(--fg-faint)", marginTop: 4 }}>
        {c.inputRarity} → {c.outputRarity}{c.stattrak ? " · ST" : ""} · {c.strategy}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
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
      </div>

      <ProfitGauge contract={c} />
      {c.theOne && <TheOneStrip one={c.theOne} />}

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
        <OutcomeBars contract={c} onPrice={onPrice} />
        <InputsStrip contract={c} onPrice={onPrice} />
      </div>

      <button
        onClick={() => { writeHandoff(c); router.push("/"); }}
        title="Stage this contract in the Trade Up Simulator"
        style={{ marginTop: 20, background: "transparent", border: "1px solid var(--green-dim)", color: "var(--green)", padding: "10px 18px", fontSize: 12, letterSpacing: "0.14em", fontWeight: 700 }}
      >
        LOAD INTO SIMULATOR →
      </button>
    </>
  );
}

// ---- candidate (near-miss) ------------------------------------------------

function CandidateDetail({ n, onPrice }: { n: ResearchNearMiss; onPrice: (name: string) => void }) {
  const [selWin, setSelWin] = useState<number | null>(null);
  const have = Math.min(n.have, 10);
  const outcomes = n.outputs.slice(0, 18); // sorted big winner → small by the backend
  const buys = n.toBuy.slice(0, 12); // cheapest low-float fillers first
  const cheapestBuy = buys.find((b) => b.price != null)?.price ?? null;
  const inRar = rarityHex(n.inputRarity);
  const outRar = rarityHex(n.outputRarity);
  const sel = selWin != null ? outcomes[selWin] : null;

  // Assemble the contract: click WHAT-TO-BUY items to fill the slots to 10.
  const FEE = 0.15;
  const slotsNeeded = Math.max(0, 10 - n.items.length); // how many to buy to reach 10
  const [picked, setPicked] = useState<ResearchBuyOption[]>([]);
  const full = picked.length >= slotsNeeded && slotsNeeded >= 0 && n.items.length + picked.length === 10;
  const addPick = (b: ResearchBuyOption) => setPicked((p) => (p.length >= slotsNeeded ? p : [...p, b]));
  const removePick = (idx: number) => setPicked((p) => p.filter((_, i) => i !== idx));

  // Once 10 are assembled, ask the engine for the real outcome distribution.
  const [result, setResult] = useState<TradeupResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeErr, setComputeErr] = useState<string | null>(null);
  useEffect(() => {
    if (n.items.length + picked.length !== 10) {
      setResult(null);
      setComputeErr(null);
      return;
    }
    const inputs = [
      ...n.items.map((it) => ({ skinId: `inv-${it.assetid}`, float: it.float, marketName: it.name })),
      ...picked.map((b, i) => ({ skinId: `buy-${i}`, float: b.float, marketName: b.name })),
    ];
    let cancelled = false;
    setComputing(true);
    setComputeErr(null);
    fetch("/api/tradeup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs, isStatTrak: n.stattrak }),
    })
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) { setComputeErr(body?.error ?? `error ${r.status}`); setResult(null); }
        else setResult(body as TradeupResult);
      })
      .catch((e) => { if (!cancelled) setComputeErr(String(e)); })
      .finally(() => { if (!cancelled) setComputing(false); });
    return () => { cancelled = true; };
  }, [picked, n]);

  return (
    <>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span className="hud" style={{ color: "var(--amber)", border: "1px solid var(--amber)", padding: "1px 5px", fontSize: 9, letterSpacing: "0.1em" }}>CANDIDATE</span>
        <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 16, color: "var(--fg)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n.collection.name}>
          {n.collection.name}
        </h2>
      </div>
      <div className="hud" style={{ color: "var(--fg-faint)", marginTop: 4 }}>
        {n.inputRarity} → {n.outputRarity}{n.stattrak ? " · ST" : ""}
      </div>

      {/* have / 10 progress */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", height: 10, gap: 2 }}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} style={{ flex: 1, background: i < have ? inRar : "var(--void)", border: "1px solid var(--surface-line)" }} />
          ))}
        </div>
        <div className="hud" style={{ marginTop: 6, color: "var(--fg-dim)" }}>
          have <strong style={{ color: "var(--fg)" }}>{n.have}</strong> / 10 ·{" "}
          <span style={{ color: "var(--amber)" }}>need {n.need} more from this collection</span>
        </div>
      </div>

      {/* WHAT YOU COULD WIN — outcomes compared, big→small. Click a tile to pick the
          win you're chasing (populates WHAT TO BUY); click the price for its breakdown. */}
      {outcomes.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 6 }}>
            WHAT YOU COULD WIN · {n.outputRarity} · <span style={{ color: "var(--green-hot)" }}>big</span> → <span style={{ color: "var(--green-dim)" }}>small</span> · click to chase
            <div style={{ color: "var(--fg-faint)", marginTop: 2 }}>priced at the wear your items&apos; float rolls — buy low-float to push it higher</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))", gap: 8 }}>
            {outcomes.map((o, i) => (
              <SkinTile
                key={`${o.name}-${i}`}
                image={o.image}
                name={o.name}
                value={o.netPrice != null ? usd(o.netPrice) : "—"}
                valueColor={o.netPrice == null ? "var(--fg-faint)" : i === 0 ? "var(--green-hot)" : "var(--green)"}
                accent={outRar}
                onSelect={() => setSelWin(i)}
                selected={selWin === i}
                onPriceClick={o.netPrice != null ? () => onPrice(o.name) : undefined}
                badge={i === 0 && o.netPrice != null ? "BIG WIN" : undefined}
                glow={i === 0 && o.netPrice != null}
              />
            ))}
          </div>
        </div>
      )}

      {/* WHAT TO BUY — empty until a win is picked above, then the inputs to buy */}
      <div style={{ marginTop: 18 }}>
        <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 6 }}>WHAT TO BUY</div>
        {sel == null ? (
          <div style={{ padding: "26px 16px", border: "1px dashed var(--surface-line)", color: "var(--fg-faint)", textAlign: "center", fontSize: 13 }}>
            ↑ pick a win above to see what to buy
          </div>
        ) : (
          <>
            <div className="hud" style={{ color: "var(--fg-dim)", marginBottom: 8, lineHeight: 1.7 }}>
              chasing <span style={{ color: "var(--green-hot)" }}>{sel.name}</span>{sel.netPrice != null ? <> ({usd(sel.netPrice)})</> : null} · buy <strong style={{ color: "var(--fg)" }}>{n.need}</strong> <span style={{ color: "var(--amber)" }}>low-float</span> fillers
              {cheapestBuy != null && <> · ≈ <span style={{ color: "var(--amber)" }}>{usd(cheapestBuy * n.need)}</span> to complete</>}
              <div style={{ color: "var(--fg-faint)" }}>low float pushes the roll to a top wear — that&apos;s how the jackpot actually lands.</div>
            </div>
            {buys.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))", gap: 8 }}>
                {buys.map((b, i) => (
                  <SkinTile
                    key={`${b.name}-${i}`}
                    image={b.image}
                    name={b.name}
                    value={b.price != null ? usd(b.price) : "—"}
                    valueColor={b.price == null ? "var(--fg-faint)" : "var(--amber)"}
                    accent={inRar}
                    onSelect={full ? undefined : () => addPick(b)}
                    onPriceClick={b.price != null ? () => onPrice(b.name) : undefined}
                    badge={full ? undefined : "+ ADD"}
                  />
                ))}
              </div>
            ) : (
              <div className="hud" style={{ color: "var(--fg-faint)" }}>no priced input skins to buy in this collection</div>
            )}
          </>
        )}
      </div>

      {/* YOUR CONTRACT — your owned items (green · OWNED) + bought fillers (amber ·
          click to remove) + empty slots, assembling to 10. */}
      <div style={{ marginTop: 18 }}>
        <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
          <span>YOUR CONTRACT · <span style={{ color: full ? "var(--green-hot)" : "var(--fg)" }}>{n.items.length + picked.length}</span> / 10</span>
          {picked.length > 0 && (
            <button type="button" onClick={() => setPicked([])} className="hud" style={{ background: "transparent", border: "none", color: "var(--loss)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>clear buys</button>
          )}
          {!full && <span style={{ color: "var(--amber)" }}>← click WHAT TO BUY items to fill the {slotsNeeded - picked.length} empty slot{slotsNeeded - picked.length === 1 ? "" : "s"}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))", gap: 8 }}>
          {/* yours */}
          {n.items.map((it, i) => (
            <SkinTile
              key={`have-${it.assetid}-${i}`}
              image={it.image}
              name={it.name}
              value={it.price != null ? usd(it.price) : "—"}
              valueColor={it.price == null ? "var(--fg-faint)" : "var(--green)"}
              sub={it.float.toFixed(4)}
              accent={inRar}
              onPriceClick={it.price != null ? () => onPrice(it.name) : undefined}
              badge="OWNED"
            />
          ))}
          {/* bought — click to remove */}
          {picked.map((b, i) => (
            <SkinTile
              key={`pick-${i}`}
              image={b.image}
              name={b.name}
              value={b.price != null ? usd(b.price) : "—"}
              valueColor="var(--amber)"
              sub={`buy · ${b.wear}`}
              accent="var(--amber)"
              onSelect={() => removePick(i)}
              onPriceClick={b.price != null ? () => onPrice(b.name) : undefined}
              badge="BUY ✕"
            />
          ))}
          {/* remaining empty slots */}
          {Array.from({ length: Math.max(0, slotsNeeded - picked.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              title="empty — click a WHAT TO BUY item to fill this slot"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 90, border: "1px dashed var(--surface-line)", background: "var(--void)" }}
            >
              <span style={{ fontSize: 22, lineHeight: 1, color: "var(--fg-faint)" }}>+</span>
              <span className="hud" style={{ color: "var(--fg-faint)" }}>empty</span>
            </div>
          ))}
        </div>
      </div>

      {/* EXPECTED OUTCOMES — every possible roll from the assembled 10, with odds + net gain/loss */}
      {full && (
        <div style={{ marginTop: 18 }}>
          <div className="hud" style={{ color: "var(--fg-faint)", marginBottom: 6 }}>EXPECTED OUTCOMES · all possible rolls from these 10</div>
          {computing ? (
            <div className="hud" style={{ color: "var(--fg-dim)" }}>computing…</div>
          ) : computeErr ? (
            <div className="hud" style={{ color: "var(--amber)" }}>couldn&apos;t compute — {computeErr}</div>
          ) : result ? (
            <OutcomeResult result={result} stattrak={n.stattrak} fee={FEE} onPrice={onPrice} />
          ) : null}
        </div>
      )}
    </>
  );
}

// Jackpot-focused outcome view. We're hunting the rare big hit, so the headline is
// the TOP prize and its odds — not the average (EV). Below it, every possible roll,
// value-sorted, green if it clears your cost. Net = after-fee; cost = what you put in.
function OutcomeResult({
  result,
  stattrak,
  fee,
  onPrice,
}: {
  result: TradeupResult;
  stattrak: boolean;
  fee: number;
  onPrice: (name: string) => void;
}) {
  const net = 1 - fee;
  const cost = result.inputCost;
  const nameOf = (skin: { name: string }, wear: string) =>
    `${stattrak ? "StatTrak™ " : ""}${skin.name} (${wear})`; // name already "Weapon | Paint"

  const rolls = result.outcomes.map((o) => ({
    o,
    nv: o.estimatedPrice != null ? o.estimatedPrice * net : null,
    nm: nameOf(o.skin, o.outputWear),
  }));
  const priced = rolls.filter((r) => r.nv != null);
  const sorted = [...rolls].sort((a, b) => (b.nv ?? -1) - (a.nv ?? -1));
  const jackpot = sorted[0]?.nv != null ? sorted[0] : null;
  // chance any roll clears your cost (your "profit" odds, not the average)
  const winChance = priced.filter((r) => r.nv! > cost).reduce((s, r) => s + r.o.probability, 0);

  return (
    <>
      {/* JACKPOT — the prize we're actually chasing, with its odds */}
      {jackpot && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 12px",
            border: "1px solid var(--green-hot)",
            background: "rgba(170,255,170,0.05)",
            boxShadow: "0 0 18px rgba(170,255,170,0.18)",
            marginBottom: 12,
          }}
        >
          {jackpot.o.skin.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={jackpot.o.skin.image} alt="" loading="lazy" style={{ width: 96, height: 64, objectFit: "contain", flex: "0 0 auto" }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="hud glow" style={{ color: "var(--green-hot)", letterSpacing: "0.16em" }}>◉ JACKPOT</span>
            <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={jackpot.nm}>{jackpot.nm}</div>
            <div style={{ marginTop: 4, display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
              <button type="button" onClick={() => onPrice(jackpot.nm)} className="glow" style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 24, fontWeight: 700, color: "var(--green-hot)", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 4 }}>
                {usd(jackpot.nv)}
              </button>
              <span className="hud" style={{ color: "var(--fg-dim)" }}>{pct(jackpot.o.probability)} · {oddsString(jackpot.o.probability)}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: jackpot.nv! - cost >= 0 ? "var(--profit)" : "var(--loss)" }}>
                {signedUsd(jackpot.nv! - cost)} if it hits
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="hud" style={{ color: "var(--fg-dim)", marginBottom: 10 }}>
        cost in <strong style={{ color: "var(--fg)" }}>{usd(cost)}</strong> · you profit on{" "}
        <strong style={{ color: winChance > 0 ? "var(--profit)" : "var(--loss)" }}>{pct(winChance)}</strong> of rolls
      </div>

      {/* every possible roll, biggest first */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(122px, 1fr))", gap: 8 }}>
        {sorted.map((r, i) => {
          const win = r.nv != null && r.nv > cost;
          return (
            <SkinTile
              key={`${r.o.skin.id}-${r.o.outputWear}-${i}`}
              image={r.o.skin.image}
              name={r.nm}
              value={r.nv != null ? usd(r.nv) : "—"}
              valueColor={r.nv == null ? "var(--fg-faint)" : i === 0 ? "var(--green-hot)" : win ? "var(--profit)" : "var(--loss)"}
              sub={pct(r.o.probability)}
              accent={i === 0 ? "var(--green-hot)" : win ? "var(--profit)" : "var(--surface-line)"}
              onPriceClick={r.nv != null ? () => onPrice(r.nm) : undefined}
              badge={i === 0 ? "TOP" : undefined}
              glow={i === 0}
            />
          );
        })}
      </div>
      <div className="hud" style={{ marginTop: 8, color: "var(--fg-faint)", lineHeight: 1.6 }}>
        every possible roll · % = chance it lands · value net (after {Math.round(fee * 100)}% fee) · green clears your {usd(cost)} cost.
      </div>
    </>
  );
}

// A skin tile: picture + name + a value line (and optional sub-line). The tile
// BODY is for selection (onSelect); only the value, rendered as a link, opens the
// price modal (onPriceClick) — clicking anywhere else never opens it.
function SkinTile({
  image,
  name,
  value,
  valueColor,
  accent,
  onSelect,
  onPriceClick,
  badge,
  glow,
  sub,
  selected,
}: {
  image?: string | null;
  name: string;
  value: string;
  valueColor: string;
  accent: string;
  onSelect?: () => void;
  onPriceClick?: () => void;
  badge?: string;
  glow?: boolean;
  sub?: string;
  selected?: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      title={name}
      className={onSelect ? `card-hover${selected ? " card-selected" : ""}` : undefined}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: "var(--void)",
        border: `1px solid ${accent}`,
        borderLeftWidth: 3,
        cursor: onSelect ? "pointer" : "default",
        boxShadow: glow ? `0 0 14px ${valueColor}` : undefined,
      }}
    >
      {badge && (
        <span className="hud glow" style={{ position: "absolute", top: 4, right: 4, color: "var(--void)", background: valueColor, padding: "1px 4px", fontSize: 8, letterSpacing: "0.06em", zIndex: 1 }}>
          {badge}
        </span>
      )}
      <div style={{ height: 58, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        ) : (
          <span className="hud" style={{ color: "var(--fg-faint)" }}>no image</span>
        )}
      </div>
      <div style={{ padding: "6px 8px" }}>
        <div style={{ fontSize: 11, lineHeight: 1.3, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
          {onPriceClick ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPriceClick(); }}
              title="Price breakdown"
              style={{ background: "transparent", border: "none", padding: 0, font: "inherit", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: valueColor, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
            >
              {value}
            </button>
          ) : (
            <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: valueColor, fontWeight: 700 }}>{value}</span>
          )}
          {sub && <span className="hud" style={{ color: "var(--fg-faint)", fontSize: 10 }} title="float">{sub}</span>}
        </div>
      </div>
    </div>
  );
}
