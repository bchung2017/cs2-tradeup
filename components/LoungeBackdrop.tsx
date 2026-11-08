"use client";

// The Lounge's 3D pond, layered just above the flat background. It follows the
// route: on /lounge the camera eases into the three-quarter view, anywhere
// else it eases back to straight down and then stops drawing.
//
// The first visit builds the scene: three.js and the scene code download, then
// the scene is assembled a step at a time behind a loading bar (the page stays
// responsive), and only once everything is ready does the camera start moving,
// so the move is smooth. Later visits start at once.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Lounge } from "./circuit/lounge3d";

export default function LoungeBackdrop() {
  const pathname = usePathname();
  const inLounge = pathname === "/lounge";
  const inLoungeRef = useRef(inLounge);
  inLoungeRef.current = inLounge;
  const ref = useRef<HTMLCanvasElement>(null);
  const lounge = useRef<Lounge | null>(null);
  const loading = useRef(false);
  const [idle, setIdle] = useState(true);
  const [progress, setProgress] = useState<number | null>(null); // null: not loading

  useEffect(() => {
    if (lounge.current) {
      lounge.current.setInLounge(inLounge);
      return;
    }
    if (!inLounge || loading.current) return;
    loading.current = true;
    setProgress(0);
    (async () => {
      try {
        // the download is the first stretch of the bar
        const mod = await import("./circuit/lounge3d");
        setProgress(0.1);
        if (!ref.current) return;
        const l = await mod.createLounge(ref.current, setIdle, (d) => setProgress(0.1 + 0.9 * d));
        lounge.current = l;
        setProgress(null);
        // left while it was loading: stay flat until the next visit
        l.setInLounge(inLoungeRef.current);
      } catch (e) {
        console.error("Lounge failed to load", e);
        setProgress(null); // no WebGL or a failed download: the flat background stays
      } finally {
        loading.current = false;
      }
    })();
  }, [inLounge]);

  useEffect(() => () => lounge.current?.destroy(), []);

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          opacity: 0,
          display: idle && !inLounge && progress == null ? "none" : "block",
        }}
      />
      {progress != null && inLounge && (
        <div className="lounge-loading" role="progressbar" aria-label="Loading the Lounge" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span className="hud">LOADING LOUNGE</span>
          <div className="lounge-loading__bar"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <span className="lounge-loading__pct">{Math.round(progress * 100)}%</span>
        </div>
      )}
    </>
  );
}
