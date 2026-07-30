import { rarityHex, usd } from "@/lib/display";
import type { InventoryItem } from "@/lib/steam";

export default function InventoryCard({
  item,
  onCardClick,
  onPriceClick,
  ineligible = false,
  reason,
  title,
}: {
  item: InventoryItem;
  onCardClick?: () => void;
  onPriceClick?: () => void;
  ineligible?: boolean;
  reason?: string;
  title?: string;
}) {
  return (
    <div
      className="card-hover"
      onClick={onCardClick}
      title={title}
      aria-disabled={ineligible}
      style={{
        position: "relative",
        background: "var(--surface)",
        border: `4px solid ${ineligible ? "var(--surface-line)" : rarityHex(item.rarity)}`,
        padding: 12,
        cursor: onCardClick ? (ineligible ? "not-allowed" : "pointer") : "default",
        opacity: ineligible ? 0.45 : 1,
      }}
    >
      {ineligible && (
        <span
          className="hud"
          title={reason}
          style={{ position: "absolute", top: 6, right: 6, padding: "1px 5px", letterSpacing: "0.12em", color: "var(--cream-dim)", border: "1px solid var(--surface-line)", background: "var(--void)" }}
        >
          N/A
        </span>
      )}
      {item.icon_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.icon_url}
          alt={item.name ?? "item"}
          style={{ width: "100%", height: 90, objectFit: "contain", filter: ineligible ? "grayscale(1)" : "none" }}
        />
      ) : (
        <div style={{ height: 90 }} />
      )}
      <div style={{ fontSize: 12, lineHeight: 1.3, margin: "8px 0 4px" }}>{item.name ?? "(unnamed)"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span className="hud hud-amber">{item.rarity ?? "—"}</span>
        {item.float != null && (
          <span
            title="Float (wear value)"
            style={{ fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums", fontSize: 12, letterSpacing: "0.01em", color: "var(--green)" }}
          >
            {item.float.toFixed(4)}
          </span>
        )}
      </div>
      {item.price != null ? (
        onPriceClick ? (
          <button
            type="button"
            className="hud"
            onClick={(e) => {
              e.stopPropagation();
              onPriceClick();
            }}
            title="Compare prices across marketplaces"
            style={{ display: "block", width: "100%", marginTop: 4, padding: 0, background: "transparent", border: "none", textAlign: "right", color: "var(--green)", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3, textDecorationColor: "var(--green-dim)", font: "inherit", letterSpacing: "inherit" }}
          >
            {usd(item.price)}
          </button>
        ) : (
          <div className="hud" style={{ marginTop: 4, textAlign: "right", color: "var(--green)" }}>{usd(item.price)}</div>
        )
      ) : (
        <div className="hud" style={{ marginTop: 4, textAlign: "right", color: "var(--cream-dim)" }} title="No market price for this item">
          no price
        </div>
      )}
    </div>
  );
}
