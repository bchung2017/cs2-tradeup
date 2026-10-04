// Everything needed to put this exact contract together: what to buy and at
// which floats, where the float budget stands, every outcome with its odds,
// float and price, how often you'd be ahead over several pulls, and what to
// watch out for.
import type { Venture } from "@/lib/ventures";
import { rarityHex } from "@/lib/display";
import { abbr, ago, money, oneIn, pct, ventureLine, VERDICT } from "@/lib/venture-copy";
import { BudgetBar, OutcomeBar } from "./FloatBar";

const steamUrl = (skin: string, wear: string) => `https://steamcommunity.com/market/listings/730/${encodeURIComponent(`${skin} (${wear})`)}`;
const BASIS: Record<string, string> = {
  "steam-listings": "cheapest Steam listings under the cap",
  "steam-feed": "Steam sale median (live check didn't load)",
  "cash-ask": "lowest third-party ask, float ignored",
};

export default function VentureDetail({ v, owned }: { v: Venture; owned?: Set<string> }) {
  return (
    <div className="vx-detail">
      <p className="vx-igl"><span className="vx-igl__tag">IGL</span> {ventureLine(v)}</p>

      <section>
        <h4 className="hud">Buy · {v.size} inputs · {v.venue === "steam" ? "Steam" : "third-party cash"}</h4>
        <table className="vx-table">
          <thead><tr><th>Input</th><th>Collection</th><th>Wear</th><th>Float to buy</th><th className="num">Each</th><th className="num">Listed</th></tr></thead>
          <tbody>
            {v.inputs.map((i) => {
              const have = owned?.has(`${i.skin}|${i.wear}`);
              return (
                <tr key={`${i.skinId}|${i.wear}`}>
                  <td>
                    <span className="vx-rar" style={{ background: rarityHex(i.rarity) }} />
                    {i.count}× <a href={steamUrl(i.skin, i.wear)} target="_blank" rel="noreferrer">{i.skin}</a>
                    {have && <span className="vx-own">you own this</span>}
                  </td>
                  <td className="dim">{i.collection.replace(/^The /, "")}</td>
                  <td>{abbr(i.wear)}</td>
                  <td className="mono">{i.floatMin.toFixed(3)} – {i.floatMax.toFixed(3)}</td>
                  <td className="num" title={BASIS[i.basis]}>{money(i.priceEach)}</td>
                  <td className="num dim">{i.listed ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="vx-note">Prices: {[...new Set(v.inputs.map((i) => BASIS[i.basis]))].join("; ")}. Total {money(v.cost)}.</p>
      </section>

      <section>
        <h4 className="hud">Float budget</h4>
        <BudgetBar sum={v.float.sum} max={v.float.max} size={v.size} />
        <p className="vx-note">
          Adjusted float {v.float.adjusted.toFixed(4)}. Each input counts as (float − its min) / (its max − its min); keep the sum under {v.float.max.toFixed(3)}
          {v.float.firstChange ? ` or ${v.float.firstChange} drops a wear grade first.` : "."}
        </p>
      </section>

      <section>
        <h4 className="hud">Outcomes · {v.outcomes.length}</h4>
        <table className="vx-table">
          <thead><tr><th>Outcome</th><th className="num">Odds</th><th>Float</th><th></th><th className="num">Sells for</th><th className="num">Sold 24h</th></tr></thead>
          <tbody>
            {v.outcomes.map((o) => (
              <tr key={o.skinId} className={o.win ? "is-win" : ""}>
                <td>
                  <span className="vx-rar" style={{ background: rarityHex(o.rarity) }} />
                  {o.name} <span className="dim">({abbr(o.wear)})</span>
                  {o.rarePhases && o.rarePhases.length > 0 && (
                    <span className="vx-phase" title="phase average; rare phases at an even split">
                      {o.rarePhases.map((p) => `${p.phase} ${money(p.value)}`).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="num">{pct(o.probability)} <span className="dim">{oneIn(o.probability)}</span></td>
                <td className="mono">{o.float.toFixed(4)}</td>
                <td><OutcomeBar float={o.float} min={o.skinMin} max={o.skinMax} /></td>
                <td className="num">{money(o.value)}{!o.checked && <span className="dim" title="model price, not checked live"> *</span>}</td>
                <td className="num dim">{o.sold24h ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="vx-note">Green rows sell for more than the contract costs. * = feed price, not checked live (worth under half the cost).</p>
      </section>

      <section className="vx-grid2">
        <div>
          <h4 className="hud">Chance you come out ahead</h4>
          <div className="vx-ahead">
            {v.pAhead.map((a) => (
              <div key={a.n}><b>{pct(a.p)}</b><span className="dim">after {a.n} {a.n === 1 ? "pull" : "pulls"}</span></div>
            ))}
          </div>
          {v.valuePatient != null && (
            <p className="vx-note">Selling at the lowest ask instead of the top buy order: {Math.round((v.valuePatient / v.cost) * 100)}¢ back per $1.</p>
          )}
        </div>
        <div>
          <h4 className="hud">Watch out</h4>
          <ul className="vx-warn">
            <li className={`tone-${VERDICT[v.verdict].tone}`}>{VERDICT[v.verdict].note}</li>
            {v.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      </section>

      <p className="vx-meta">
        Found {ago(v.firstSeenAt)} · checked {ago(v.verifiedAt)} · {v.sources.join(" · ")}
      </p>
    </div>
  );
}
