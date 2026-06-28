// Server Component: this is just the page's static shell (the two-column
// layout). The interactive parts are self-contained "use client" islands —
// TradeupProvider, TradeUpConsole, InventoryPanel — so the shell stays out of
// the client bundle and off the cold-compile path. Do NOT add "use client"
// here or hooks to this file; push interactivity into a child island instead.
import TradeUpConsole from "@/components/TradeUpConsole";
import InventoryPanel from "@/components/InventoryPanel";
import AppShell from "@/components/AppShell";
import { TradeupProvider } from "@/lib/tradeup-context";

export default function Page() {
  return (
    <AppShell>
    <TradeupProvider>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
      {/* left: trade-up visualizer (carries the shared CircuitBoard backdrop) */}
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <TradeUpConsole />
      </div>

      {/* right: inventory, independently scrollable below the 48px top bar */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
          position: "sticky",
          top: 48,
          height: "calc(100vh - 48px)",
          overflowY: "auto",
          borderLeft: "1px solid var(--surface-line)",
        }}
      >
        <InventoryPanel />
      </div>
    </div>
    </TradeupProvider>
    </AppShell>
  );
}
