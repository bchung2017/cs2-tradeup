"use client";

import { useEffect, useState } from "react";
import { usd } from "@/lib/display";

// ---------------------------------------------------------------------------
// Shared price-breakdown modal. Opened from a price on either side of the app
// (inventory cards on the right, trade-up inputs/outcomes on the left). Lists
// Steam + third-party marketplaces, each with the price we have on file (when a
// sync attached per-source numbers) and a click-through to that marketplace's
// listing for this exact item — wear included, so the link lands on the right
// row rather than every wear of the skin.
// ---------------------------------------------------------------------------

interface Marketplace {
  key: string;
  label: string;
  color: string;
  // Brand logo URL; falls back to a lettermark disc if it fails to load.
  logo?: string;
  // Builds the listing URL for a raw inventory market_hash_name (wear-aware).
  url: (marketHashName: string) => string;
}

// DMarket filters wear with an `exterior` slug, not by parsing "(Wear)" out of
// the title — so we map the wear name to its slug and pass it explicitly.
const DMARKET_EXTERIOR: Record<string, string> = {
  "Factory New": "factory-new",
  "Minimal Wear": "minimal-wear",
  "Field-Tested": "field-tested",
  "Well-Worn": "well-worn",
  "Battle-Scarred": "battle-scarred",
};

// Pull the "(Wear)" suffix out of a market_hash_name, if present.
function wearOf(name: string): string | null {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : null;
}

function dmarketUrl(name: string): string {
  const wear = wearOf(name);
  const slug = wear ? DMARKET_EXTERIOR[wear] : undefined;
  const exterior = slug ? `&exterior=${slug}` : "";
  return `https://dmarket.com/ingame-items/item-list/csgo-skins?title=${encodeURIComponent(
    stripTags(name),
  )}${exterior}`;
}

const MARKETPLACES: Marketplace[] = [
  {
    key: "steam",
    label: "Steam",
    color: "#66c0f4",
    url: (n) => `https://steamcommunity.com/market/listings/730/${encodeURIComponent(n)}`,
  },
  {
    key: "skinport",
    label: "Skinport",
    color: "#fa490a",
    logo: "https://www.google.com/s2/favicons?domain=skinport.com&sz=64",
    url: (n) => `https://skinport.com/market?search=${encodeURIComponent(stripTags(n))}`,
  },
  {
    key: "csfloat",
    label: "CSFloat",
    color: "#a78bfa",
    url: (n) => `https://csfloat.com/search?market_hash_name=${encodeURIComponent(n)}`,
  },
  {
    key: "dmarket",
    label: "DMarket",
    color: "#27c281",
    logo: "https://www.google.com/s2/favicons?domain=dmarket.com&sz=64",
    url: dmarketUrl,
  },
];

// Strip ★ / StatTrak™ / Souvenir / "(Wear)" for marketplaces whose search reads
// a plain skin name rather than the full Steam market_hash_name.
function stripTags(name: string): string {
  return name
    .replace(/^★\s*/, "")
    .replace(/^StatTrak™?\s*/i, "")
    .replace(/^Souvenir\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

// Brand icon: real logo when we have one (and it loads), else a brand-tinted
// lettermark disc — no hard dependency on the remote asset.
function BrandIcon({ m }: { m: Marketplace }) {
  const [failed, setFailed] = useState(false);
  if (m.logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={m.logo}
        alt=""
        width={30}
        height={30}
        onError={() => setFailed(true)}
        style={{ width: 30, height: 30, borderRadius: 6, objectFit: "contain", background: "var(--void)" }}
      />
    );
  }
  return (
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: m.color,
        color: "var(--void)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--mono)",
        fontWeight: 700,
        fontSize: 15,
      }}
    >
      {m.label[0]}
    </span>
  );
}

export default function PriceModal({
  name,
  priceSources,
  onClose,
}: {
  name: string;
  priceSources?: Record<string, number> | null;
  onClose: () => void;
}) {
  // Esc closes; restore nothing else (the grid stays mounted behind the scrim).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sources = priceSources ?? {};

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--surface-line)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 16px 60px rgba(0,0,0,0.8)",
          padding: "18px 20px 20px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <span className="hud hud-ember">MARKET PRICES</span>
            <div style={{ fontSize: 14, marginTop: 6, color: "var(--cream)", lineHeight: 1.35 }}>
              {name || "(unnamed)"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "1px solid var(--surface-line)",
              color: "var(--cream-dim)",
              cursor: "pointer",
              padding: "2px 9px",
              fontFamily: "var(--mono)",
              fontSize: 14,
              lineHeight: 1.2,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
            gap: 10,
          }}
        >
          {MARKETPLACES.map((m) => {
            const price = sources[m.key];
            return (
              <a
                key={m.key}
                href={m.url(name)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${m.label} listing in a new tab`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                  padding: "12px 8px",
                  background: "var(--void)",
                  border: "1px solid var(--surface-line)",
                  borderTop: `3px solid ${m.color}`,
                  color: "var(--cream)",
                }}
              >
                <BrandIcon m={m} />
                <span className="hud" style={{ color: "var(--cream-dim)" }}>{m.label}</span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 13,
                    color: price != null ? "var(--green)" : "var(--cream-dim)",
                  }}
                >
                  {price != null ? usd(price) : "view →"}
                </span>
              </a>
            );
          })}
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: "var(--cream-dim)", opacity: 0.7, lineHeight: 1.4 }}>
          Prices shown are the last synced values; icons open the live listing for this
          exact wear in a new tab.
        </div>
      </div>
    </div>
  );
}

// Build a Steam-style market_hash_name from parts, so the left-side trade-up
// prices can open the same per-marketplace breakdown the inventory cards use.
export function marketName(opts: {
  weapon: string;
  skin: string;
  wear?: string | null;
  stattrak?: boolean;
}): string {
  const st = opts.stattrak ? "StatTrak™ " : "";
  const wear = opts.wear ? ` (${opts.wear})` : "";
  return `${st}${opts.weapon} | ${opts.skin}${wear}`;
}

// Standard CS2 wear bands, for inputs that only carry a float (no wear label).
export function wearFromFloat(float: number): string {
  if (float < 0.07) return "Factory New";
  if (float < 0.15) return "Minimal Wear";
  if (float < 0.38) return "Field-Tested";
  if (float < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}
