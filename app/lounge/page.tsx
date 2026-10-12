import type { Metadata } from "next";

export const metadata: Metadata = { title: "CS2 Journeyman · Lounge" };

// The Lounge is the scene itself (components/LoungeBackdrop.tsx draws it
// behind every page); this page only gives it the screen.
export default function LoungePage() {
  return <main aria-label="Lounge" style={{ minHeight: "calc(100vh - var(--rail-h))" }} />;
}
