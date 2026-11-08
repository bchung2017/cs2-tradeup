// The homepage: the Lounge, seen standing at the edge of the pool. The scene
// is drawn by components/LoungeBackdrop.tsx behind every page; this page only
// gives it the screen.
export default function Home() {
  return <main aria-label="Lounge" style={{ minHeight: "calc(100vh - var(--rail-h))" }} />;
}
