import LoungeTour from "@/components/home/LoungeTour";

// The homepage: the Lounge, seen standing at the edge of the pool. The scene
// is drawn by components/LoungeBackdrop.tsx behind every page; this page gives
// it the screen and the tour's controls (into the Venture Studios building).
export default function Home() {
  return (
    <main aria-label="Lounge" style={{ minHeight: "calc(100vh - var(--rail-h))" }}>
      <LoungeTour />
    </main>
  );
}
