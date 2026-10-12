// Everything needed to put this exact contract together: what to buy and at
// which floats, where the float budget stands, every outcome with its odds,
// float and price, how often you'd be ahead over several pulls, and what to
// watch out for.
import type { Venture } from "@/lib/ventures";
import { backShort, money, pct, ventureLine, VERDICT } from "@/lib/venture-copy";
import { BudgetBar } from "./FloatBar";
import { InputCards, OutcomeCards } from "./ContractCards";
import Ago from "./Ago";
import Handoff from "./Handoff";
import type { Plan } from "@/lib/venture-fit";

const BASIS: Record<string, string> = {
  "steam-listings": "cheapest Steam listings under cap",
  "steam-feed": "Steam median (live check failed)",
  "cash-ask": "lowest third-party ask, any float",
};

export default function VentureDetail({ v, plan }: { v: Venture; plan?: Plan | null }) {
  return (
    <div className="vx-detail">
      <p className="vx-igl"><span className="vx-igl__tag">IGL</span> {ventureLine(v)}</p>
      <Handoff plan={plan} />

      <section>
        <h4 className="hud">Per contract</h4>
        <div className="vx-ahead">
          <div><b>{money(v.cost)}</b><span className="dim">entry</span></div>
          <div><b>{money(v.value)}</b><span className="dim">average pull sells for</span></div>
          <div title="Average sale value of one pull for every $1 the inputs cost">
            <b className={v.backPerDollar >= 1 ? "pos" : v.backPerDollar >= 0.85 ? "" : "neg"}>{backShort(v.backPerDollar)}</b>
            <span className="dim">back per $1</span>
          </div>
          <div title="Chance one pull sells for more than the entry (not the grand prize odds)">
            <b>{pct(v.pProfit)}</b>
            <span className="dim">profit chance</span>
          </div>
        </div>
      </section>

      <section>
        <h4 className="hud">Buy · {v.size} inputs · {v.venue === "steam" ? "Steam" : "third-party cash"}</h4>
        <InputCards v={v} plan={plan} />
        <p className="vx-note">Prices: {[...new Set(v.inputs.map((i) => BASIS[i.basis]))].join("; ")}. Total {money(v.cost)}.</p>
      </section>

      <section>
        <h4 className="hud">Float budget</h4>
        <BudgetBar sum={v.float.sum} max={v.float.max} size={v.size} />
        <p className="vx-note">
          Adjusted float {v.float.adjusted.toFixed(4)}. Each input counts (float − min) / (max − min); keep the sum under {v.float.max.toFixed(3)}
          {v.float.firstChange ? ` or ${v.float.firstChange} drops a wear grade first.` : "."}
        </p>
      </section>

      <section>
        <h4 className="hud">Outcomes · {v.outcomes.length}</h4>
        <OutcomeCards v={v} />
        <p className="vx-note">Most valuable first. Green cards sell for more than the entry, red for less; the chip is profit against the entry. * = feed price, not checked live (under half the cost).</p>
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
            <p className="vx-note">Selling at lowest ask, not top buy order: {Math.round((v.valuePatient / v.cost) * 100)}¢ back per $1.</p>
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
        Found <Ago iso={v.firstSeenAt} /> · checked <Ago iso={v.verifiedAt} /> · {v.sources.join(" · ")}
      </p>
    </div>
  );
}
