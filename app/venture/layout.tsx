// Venture: trade-up contracts found by IGL-9000. Two pages, picked from the top
// rail's VENTURE menu: Market Ventures (what's out there now) and My Ventures
// (every contract your inventory can start).
import type { Metadata } from "next";
import VentureHeading from "@/components/venture/VentureHeading";

export const metadata: Metadata = {
  title: "CS2 Journeyman · Venture",
  description: "Trade-up contracts IGL-9000 found, checked at live prices.",
};

export default function VentureLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="pane pane--venture">
      <header className="vx-head">
        <div>
          <span className="hud hud-ember">IGL-9000 · Venture</span>
          <VentureHeading />
        </div>
      </header>
      {children}
    </main>
  );
}
