// Server shell for the Venture route view. Interactivity + the CircuitBoard
// backdrop live in the VenturePanel client island, keeping this off the client
// bundle (same pattern as app/page.tsx and app/cache/page.tsx).
import type { Metadata } from "next";
import VenturePanel from "@/components/VenturePanel";

export const metadata: Metadata = {
  title: "CS2 Journeyman · Venture",
  description: "The route: a chain of trade-ups from your stash to a destination skin, called by IGL-9000.",
};

export default function VenturePage() {
  return <VenturePanel />;
}
