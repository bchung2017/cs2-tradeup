// Server Component: this is just the page's static shell (the two-column
// layout). The interactive parts are self-contained "use client" islands —
// TradeUpConsole, InventoryPanel — so the shell stays out of the client bundle
// and off the cold-compile path. Do NOT add "use client" here or hooks to this
// file; push interactivity into a child island instead. TradeupProvider now
// lives in the root layout (survives navigation), so it is NOT wrapped here.
import TradeUpConsole from "@/components/TradeUpConsole";
import InventoryPanel from "@/components/InventoryPanel";

export default function Page() {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
      {/* left: trade-up visualizer (carries the shared CircuitBoard backdrop) */}
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <TradeUpConsole />
      </div>

      {/* right: inventory, independently scrollable. Offset below the top rail
          so the sticky column starts under it rather than beneath it. */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
          position: "sticky",
          top: "var(--rail-h)",
          height: "calc(100vh - var(--rail-h))",
          overflowY: "auto",
          borderLeft: "1px solid var(--surface-line)",
        }}
      >
        <InventoryPanel />
      </div>
    </div>
  );
}
