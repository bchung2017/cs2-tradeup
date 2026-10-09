"use client";

// Skin pictures for a contract: one per distinct skin, with how many of it go
// in. 9× of one and 1× of another is two pictures; ten different skins is ten.
// Images come from the catalog via ImagesProvider (the server page builds a map
// of just the skins it shows).
import { createContext, useContext, useState } from "react";
import { rarityHex } from "@/lib/display";
import type { Plan } from "@/lib/venture-fit";
import type { VentureInput } from "@/lib/ventures";

const Images = createContext<Record<string, string>>({});
export const ImagesProvider = Images.Provider;
export const useImages = () => useContext(Images);

export interface StackItem { key: string; name: string; count: number; rarity?: string | null; note?: string; mine?: boolean; image?: string; imageKey?: string }

// Inputs with your inventory swapped in: the copies you own (same skin or a
// stand-in) are their own glowing pictures, the rest are what's left to buy.
export function stackPlan(inputs: VentureInput[], plan: Plan | null | undefined): StackItem[] {
  const owned = plan?.slots.filter((s) => s.owned) ?? [];
  if (!owned.length) return stackInputs(inputs);
  const mine = new Map<string, StackItem & { floats: string[] }>();
  for (const s of owned) {
    const o = s.owned!;
    const cur = mine.get(o.skin.id) ?? { key: `own|${o.skin.id}`, imageKey: o.skin.id, image: o.skin.image, name: o.name, count: 0, rarity: o.skin.rarity.name, mine: true, floats: [] };
    cur.count++;
    cur.floats.push(o.float.toFixed(4));
    mine.set(o.skin.id, cur);
  }
  const ownedPer = new Map<VentureInput, number>();
  for (const s of owned) ownedPer.set(s.input, (ownedPer.get(s.input) ?? 0) + 1);
  const rest = inputs.map((i) => ({ ...i, count: i.count - (ownedPer.get(i) ?? 0) })).filter((i) => i.count > 0);
  return [...[...mine.values()].map(({ floats, ...it }) => ({ ...it, note: `float ${floats.join(", ")}` })), ...stackInputs(rest)];
}

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
        <figure
          key={it.key}
          className={`vx-skin${it.mine ? " owned-glow" : ""}`}
          style={{ width: size, borderBottomColor: rarityHex(it.rarity), ["--glow" as string]: rarityHex(it.rarity) }}
          title={`${it.count}× ${it.name}${it.note ? ` (${it.note})` : ""}${it.mine ? " · in your inventory" : ""}`}
        >
          {it.mine && <span className="owned-tag">yours</span>}
          <Thumb src={images[it.imageKey ?? it.key] ?? it.image} alt={it.name} w={size} h={Math.round(size * 0.75)} />
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

// Every slot of the contract as its own picture, 5 or 10 of them; the copies
// you own glow, with one tag saying how many are yours.
export function SlotStrip({ items, size = 38 }: { items: StackItem[]; size?: number }) {
  const images = useImages();
  const slots = items.flatMap((it) => Array.from({ length: it.count }, (_, k) => ({ it, k })));
  const mine = items.filter((it) => it.mine).reduce((a, it) => a + it.count, 0);
  return (
    <div className="vx-strip">
      {mine > 0 && <span className="owned-tag" style={{ ["--glow" as string]: rarityHex(items.find((it) => it.mine)?.rarity) }}>{mine} yours</span>}
      <div className="vx-strip__slots">
        {slots.map(({ it, k }) => (
          <figure
            key={`${it.key}|${k}`}
            className={`vx-skin${it.mine ? " owned-glow" : ""}`}
            style={{ width: size, borderBottomColor: rarityHex(it.rarity), ["--glow" as string]: rarityHex(it.rarity) }}
            title={`${it.name}${it.note ? ` (${it.note})` : ""}${it.mine ? " · in your inventory" : ""}`}
          >
            <Thumb src={images[it.imageKey ?? it.key] ?? it.image} alt={it.name} w={size} h={Math.round(size * 0.75)} />
          </figure>
        ))}
      </div>
    </div>
  );
}

export interface Roll { imageKey: string; name: string; value: number | null; probability: number; rarity?: string | null }

// The best few outcomes as pictures: the grand prize first, then the next
// best, each with its own value and odds.
export function BestRolls({ rolls, money }: { rolls: Roll[]; money: (n: number | null) => string }) {
  const images = useImages();
  if (!rolls.length) return <span />;
  return (
    <div className="vx-rolls">
      <span className="vx-rolls__lbl">grand prize · next best</span>
      <div className="vx-rolls__row">
        {rolls.map((r, i) => {
          const odds = r.probability <= 0 ? "never" : `1 in ${Math.round(1 / r.probability)}`;
          return (
            <figure key={r.name} className={`vx-roll${i === 0 ? " is-top" : ""}`} title={`${i === 0 ? "Grand prize: " : ""}${r.name}, ${money(r.value)}. ${odds} contracts (${(r.probability * 100).toFixed(1)}%).`}>
              <span className="vx-roll__img" style={{ borderBottomColor: rarityHex(r.rarity) }}><Thumb src={images[r.imageKey]} alt={r.name} w={60} h={45} /></span>
              <b>{money(r.value)}</b>
              <span className="dim">{odds}</span>
            </figure>
          );
        })}
      </div>
      <span className="vx-rolls__name">{rolls[0].name.replace(/^★ /, "")}</span>
    </div>
  );
}
