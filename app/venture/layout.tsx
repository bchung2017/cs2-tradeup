// Venture: trade-up contracts found by IGL-9000. Two pages, picked from the top
// rail's VENTURE menu: Market Ventures (what's out there now) and My Ventures
// (what your inventory can start, plus what you track).
import type { Metadata } from "next";
import VentureHeading from "@/components/venture/VentureHeading";
import { STANDING_LINE } from "@/lib/venture-copy";

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
      <p className="vx-standing">{STANDING_LINE}</p>
      {children}
    </main>
  );
}
