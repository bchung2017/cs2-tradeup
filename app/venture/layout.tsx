// Venture: trade-up contracts found by IGL-9000. Two subtabs, each its own route
// so a view can be linked: Market Ventures (what's out there now) and My
// Ventures (what your inventory can start, plus what you track).
import type { Metadata } from "next";
import VentureTabs from "@/components/venture/VentureTabs";
import { STANDING_LINE } from "@/lib/venture-copy";

export const metadata: Metadata = {
  title: "CS2 Journeyman · Venture",
  description: "Trade-up contracts IGL-9000 found, checked against live market prices.",
};

export default function VentureLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="pane pane--venture">
      <header className="vx-head">
        <div>
          <span className="hud hud-ember">IGL-9000</span>
          <h1 className="vx-title">Venture</h1>
        </div>
        <VentureTabs />
      </header>
      <p className="vx-standing">{STANDING_LINE}</p>
      {children}
    </main>
  );
}
