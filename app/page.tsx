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
    // On wide screens the two panels are side-by-side columns; below 860px the
    // .app-shell media query stacks them into rows (console on top, inventory
    // below). See globals.css.
    <div className="app-shell">
      {/* left/top: trade-up visualizer (carries the shared CircuitBoard backdrop) */}
      <div className="app-col">
        <TradeUpConsole />
      </div>

      {/* right/bottom: inventory — independently scrollable on desktop, inline
          with the page once stacked */}
      <div className="app-col app-col--inv">
        <InventoryPanel />
      </div>
    </div>
  );
}
