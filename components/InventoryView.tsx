"use client";

import { useEffect, useState } from "react";
import { useTradeup } from "@/lib/tradeup-context";
import PriceModal from "@/components/PriceModal";
import InventoryCard from "@/components/InventoryCard";
import type { InventoryItem } from "@/lib/steam";

export default function InventoryView() {
  const { steamid } = useTradeup();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceItem, setPriceItem] = useState<InventoryItem | null>(null);

  useEffect(() => {
    if (!steamid) {
      setItems(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/inventory/${steamid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "not synced yet" : `http ${r.status}`))))
      .then((d) => {
        if (live) setItems(d.items ?? []);
      })
      .catch((e) => {
        if (live) {
          setItems([]);
          setError((e as Error).message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [steamid]);

  return (
    <main className="inventory-full">
      <header style={{ marginBottom: 6 }}>
        <span className="hud hud-ember">INVENTORY</span>
        <h1
          className="glow"
          style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 28, margin: "4px 0 0", color: "var(--green)" }}
        >
          <span style={{ color: "var(--green-dim)" }}>$ </span>
          inventory
        </h1>
      </header>

      {!steamid && (
        <div className="hud" style={{ marginTop: 24 }}>
          NO PROFILE LOADED — LOAD ONE FROM THE CONSOLE
        </div>
      )}

      {steamid && loading && (
        <div className="hud" style={{ marginTop: 24 }}>
          LOADING…
        </div>
      )}

      {steamid && !loading && items && items.length === 0 && (
        <div className="hud" style={{ marginTop: 24 }}>
          {error ? error.toUpperCase() : "NO ITEMS"} — SYNC THIS PROFILE FROM THE CONSOLE
        </div>
      )}

      {items && items.length > 0 && (
        <div className="inventory-grid" style={{ marginTop: 16 }}>
          {items.map((it) => (
            <InventoryCard key={it.assetid} item={it} title="Compare prices" onCardClick={() => setPriceItem(it)} />
          ))}
        </div>
      )}

      {priceItem && (
        <PriceModal
          name={priceItem.name ?? ""}
          image={priceItem.icon_url}
          priceSources={priceItem.priceSources}
          onClose={() => setPriceItem(null)}
        />
      )}
    </main>
  );
}
