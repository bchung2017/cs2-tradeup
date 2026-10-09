"use client";

// Skin pictures for a contract: one per distinct skin, with how many of it go
// in. 9× of one and 1× of another is two pictures; ten different skins is ten.
// Images come from the catalog via ImagesProvider (the server page builds a map
// of just the skins it shows).
import { createContext, useContext, useState } from "react";
import { rarityHex } from "@/lib/display";

const Images = createContext<Record<string, string>>({});
export const ImagesProvider = Images.Provider;
export const useImages = () => useContext(Images);

export interface StackItem { key: string; name: string; count: number; rarity?: string | null; note?: string; mine?: boolean }

// Inputs → one entry per skin (two wears of the same skin are one picture).
export function stackInputs(inputs: { skinId: string; skin: string; wear: string; count: number; rarity: string }[]): StackItem[] {
  const by = new Map<string, StackItem & { wears: string[] }>();
  for (const i of inputs) {
    const cur = by.get(i.skinId) ?? { key: i.skinId, name: i.skin, count: 0, rarity: i.rarity, wears: [] };
    cur.count += i.count;
    cur.wears.push(`${i.count}× ${i.wear}`);
    by.set(i.skinId, cur);
  }
  return [...by.values()].map(({ wears, ...it }) => ({ ...it, note: wears.join(", ") }));
}

export default function SkinStack({ items, size = 44 }: { items: StackItem[]; size?: number }) {
  const images = useImages();
  return (
    <div className="vx-stack">
      {items.map((it) => (
        <figure key={it.key} className={`vx-skin${it.mine ? " is-mine" : ""}`} style={{ width: size, borderBottomColor: rarityHex(it.rarity) }} title={`${it.count}× ${it.name}${it.note ? ` (${it.note})` : ""}${it.mine ? " · yours" : ""}`}>
          <Thumb src={images[it.key]} alt={it.name} w={size} h={Math.round(size * 0.75)} />
          <figcaption className="vx-skin__count">×{it.count}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// A picture that falls back to a "?" tile when it's missing or fails to load,
// so a dead image never spills its alt text across the row.
export function Thumb({ src, alt, w, h }: { src?: string; alt: string; w: number; h: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="vx-skin__none" style={{ height: h }} title={alt}>?</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={w} height={h} loading="lazy" onError={() => setFailed(true)} />;
}

// The best outcome, spelled out as the grand prize with its own odds, so the
// profit chance next to it isn't read as the chance of hitting it.
export function GrandPrize({ imageKey, name, value, probability, rarity }: { imageKey: string; name: string; value: string; probability: number; rarity?: string | null }) {
  const images = useImages();
  const odds = probability <= 0 ? "never" : `1 in ${Math.round(1 / probability)}`;
  return (
    <div className="vx-prize" title={`Grand prize: ${name}, ${value}. Comes out ${odds} contracts (${(probability * 100).toFixed(1)}%).`}>
      <span className="vx-prize__img" style={{ borderBottomColor: rarityHex(rarity) }}><Thumb src={images[imageKey]} alt={name} w={52} h={39} /></span>
      <span className="vx-prize__txt">
        <span className="vx-prize__lbl">grand prize</span>
        <b>{value}</b>
        <span className="vx-prize__name">{name.replace(/^★ /, "")}</span>
        <span className="dim">{odds} chance</span>
      </span>
    </div>
  );
}
