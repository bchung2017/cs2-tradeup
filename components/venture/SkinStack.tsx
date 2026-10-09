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

export interface StackItem { key: string; name: string; count: number; rarity?: string | null; note?: string }

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

export default function SkinStack({ items, size = 44, label = true }: { items: StackItem[]; size?: number; label?: boolean }) {
  const images = useImages();
  const n = items.length;
  return (
    <div className="vx-stack">
      {items.map((it) => (
        <figure key={it.key} className="vx-skin" style={{ width: size, borderBottomColor: rarityHex(it.rarity) }} title={`${it.count}× ${it.name}${it.note ? ` (${it.note})` : ""}`}>
          <Thumb src={images[it.key]} alt={it.name} w={size} h={Math.round(size * 0.75)} />
          <figcaption className="vx-skin__count">×{it.count}</figcaption>
        </figure>
      ))}
      {label && <span className="vx-stack__lbl dim">{n} different skin{n === 1 ? "" : "s"}</span>}
    </div>
  );
}

// A picture that falls back to a "?" tile when it's missing or fails to load,
// so a dead image never spills its alt text across the row.
function Thumb({ src, alt, w, h }: { src?: string; alt: string; w: number; h: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="vx-skin__none" style={{ height: h }} title={alt}>?</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={w} height={h} loading="lazy" onError={() => setFailed(true)} />;
}
