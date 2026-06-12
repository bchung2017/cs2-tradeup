"use client";

import TradeUpConsole from "@/components/TradeUpConsole";
import InventoryPanel from "@/components/InventoryPanel";
import { TradeupProvider } from "@/lib/tradeup-context";

export default function Page() {
  return (
    <TradeupProvider>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
      {/* left: trade-up visualizer (carries the shared CircuitBoard backdrop) */}
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <TradeUpConsole />
      </div>

      {/* right: inventory, independently scrollable */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          borderLeft: "1px solid var(--surface-line)",
        }}
      >
        <InventoryPanel />
      </div>
    </div>
    </TradeupProvider>
  );
}
