"use client";

// A contract as picture cards: one card per input slot (5 or 10, your own
// copies glowing in their slots), and one per outcome, most valuable first,
// tinted green when it sells for more than the entry and red when it doesn't.
import type { Venture, VentureInput, VentureOutcome } from "@/lib/ventures";
import type { FitOwned, Plan } from "@/lib/venture-fit";
import { rarityHex, signedUsd } from "@/lib/display";
import { abbr, money, oneIn } from "@/lib/venture-copy";
import { OutcomeBar } from "./FloatBar";
import { withPhase } from "@/lib/doppler";
import { Thumb, useImages } from "./SkinStack";

const steamUrl = (skin: string, wear: string) => `https://steamcommunity.com/market/listings/730/${encodeURIComponent(`${skin} (${wear})`)}`;
const BASIS: Record<string, string> = {
  "steam-listings": "cheapest Steam listings under cap",
  "steam-feed": "Steam median (live check failed)",
  "cash-ask": "lowest third-party ask, any float",
};

// "★ Skeleton Knife | Doppler" → ["Skeleton Knife", "Doppler"]
function split(name: string): [string, string] {
  const [weapon, ...rest] = name.replace(/^★\s*/, "").split(" | ");
  return [weapon, rest.join(" | ")];
}
const chance = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 2 : p < 0.1 ? 1 : 0)}%`;

export function InputCards({ v, plan }: { v: Venture; plan?: Plan | null }) {
  const images = useImages();
  const slots: { input: VentureInput; owned: FitOwned | null }[] =
    plan?.slots.map((s) => ({ input: s.input, owned: s.owned })) ??
    v.inputs.flatMap((input) => Array.from({ length: input.count }, () => ({ input, owned: null })));
  return (
    <div className="vx-cards vx-cards--in">
      {slots.map(({ input: i, owned: o }, k) => {
        const rar = rarityHex(o?.skin.rarity.name ?? i.rarity);
        const [weapon, paint] = split(o?.name ?? i.skin);
        return (
          <article
            key={k}
            className={`vx-card vx-card--in${o ? " owned-glow" : ""}`}
            style={{ ["--tint" as string]: rar, ["--glow" as string]: rar }}
          >
            <header className="vx-card__chips">
              {o
                ? <span className="vx-chip-pill is-mine">owned</span>
                : <span className="vx-chip-pill" title={BASIS[i.basis]}>{money(i.priceEach)}</span>}
              <span className="vx-chip-pill">{abbr(o?.wear ?? i.wear)}</span>
            </header>
            <div className="vx-card__img"><Thumb src={o?.skin.image ?? images[i.skinId]} alt={o?.name ?? i.skin} w={120} h={90} /></div>
            <div className="vx-card__name"><b>{weapon}</b><span>{paint}</span></div>
            <div className="vx-card__box">
              {o ? (
                <><span>Your float</span><b>{o.float.toFixed(4)}</b></>
              ) : (
                <><span>Float to buy</span><b>≤ {i.floatMax.toFixed(3)}</b><small>{i.floatMin.toFixed(3)} – {i.floatMax.toFixed(3)}</small></>
              )}
            </div>
            <footer className="vx-card__foot">
              <span className="dim" title={i.collection}>{i.collection.replace(/^The /, "").replace(/ Collection$/, "")}</span>
              {!o && (
                <a href={steamUrl(i.skin, i.wear)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Steam market listings">
                  {i.listed != null ? `${i.listed} listed` : "listings"} ↗
                </a>
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

export function OutcomeCards({ v }: { v: Venture }) {
  const images = useImages();
  const sorted = [...v.outcomes].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return (
    <div className="vx-cards vx-cards--out">
      {sorted.map((o, k) => <OutcomeCard key={o.skinId} o={o} cost={v.cost} best={k === 0} image={images[o.skinId]} />)}
    </div>
  );
}

function OutcomeCard({ o, cost, best, image }: { o: VentureOutcome; cost: number; best: boolean; image?: string }) {
  const profit = o.value == null ? null : o.value - cost;
  const tone = profit == null ? "flat" : profit > 0 ? "up" : "down";
  const [weapon, paint] = split(withPhase(o.name, o.phase));
  return (
    <article className={`vx-card vx-card--out is-${tone}`} style={{ ["--rar" as string]: rarityHex(o.rarity) }}>
      <header className="vx-card__chips">
        <span className="vx-chip-pill" title={oneIn(o.probability)}>{chance(o.probability)}</span>
        <span className={`vx-card__profit is-${tone}`}>{profit == null ? "—" : signedUsd(profit)}</span>
      </header>
      {best && <span className="vx-card__best">BEST</span>}
      <div className="vx-card__img"><Thumb src={image} alt={withPhase(o.name, o.phase)} w={120} h={90} /></div>
      <OutcomeBar float={o.float} min={o.skinMin} max={o.skinMax} />
      <div className="vx-card__name"><b>{weapon}</b><span>{paint}</span></div>
      <div className="vx-card__meta">
        <span>{abbr(o.wear)} {o.float.toFixed(4)}</span>
        {o.sold24h != null && <span className="vx-chip-pill" title="sold in the last 24h">{o.sold24h} sold</span>}
      </div>
      {o.rarePhases && o.rarePhases.length > 0 && (
        <div className="vx-card__phases" title="phase average; rare phases at an even split">
          {o.rarePhases.map((p) => `${p.phase} ${money(p.value)}`).join(" · ")}
        </div>
      )}
      <div className="vx-card__price">
        {money(o.value)}
        {!o.checked && <span className="dim" title="feed price, not checked live"> *</span>}
      </div>
    </article>
  );
}
