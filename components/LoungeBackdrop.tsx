"use client";

// The Lounge's 3D pond, layered just above the flat background. It follows the
// route: on /lounge the camera eases into the three-quarter view, anywhere
// else it eases back to straight down and then stops drawing.
//
// The first visit builds the scene: three.js and the scene code download, then
// the scene is assembled a step at a time behind a loading bar (the page stays
// responsive), and only once everything is ready does the camera start moving,
// so the move is smooth. Later visits start at once.
//
// On the homepage it plays the intro instead: the page offers the week's
// jackpot knives (lib/intro-bus.ts), the cave is built behind the same bar,
// then the camera runs the whole sequence on its own.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Lounge } from "./circuit/lounge3d";
import { nextIntro } from "@/lib/intro-bus";

export default function LoungeBackdrop() {
  const pathname = usePathname();
  const inLounge = pathname === "/lounge";
  const isHome = pathname === "/";
  const inLoungeRef = useRef(inLounge);
  inLoungeRef.current = inLounge;
  const isHomeRef = useRef(isHome);
  isHomeRef.current = isHome;
  const ref = useRef<HTMLCanvasElement>(null);
  const lounge = useRef<Lounge | null>(null);
  const loading = useRef(false);
  const [idle, setIdle] = useState(true);
  const [progress, setProgress] = useState<number | null>(null); // null: not loading

  // the intro: once the Lounge exists and the page has offered its knives
  const playing = useRef(false);
  async function playIntro(l: Lounge, from: number) {
    if (playing.current) return;
    playing.current = true;
    try {
      const knives = await nextIntro();
      if (!isHomeRef.current) return;
      setProgress(from);
      await l.playIntro(knives, (d) => setProgress(from + (1 - from) * d));
    } catch (e) {
      console.error("Intro failed", e);
      dispatchEvent(new CustomEvent("lounge:intro", { detail: "failed" }));
      if (isHomeRef.current) l.setInLounge(false);
    } finally {
      setProgress(null);
      playing.current = false;
    }
  }

  useEffect(() => {
    const l0 = lounge.current;
    if (l0) {
      if (isHome) void playIntro(l0, 0);
      else { l0.stopIntro(); l0.setInLounge(inLounge); }
      return;
    }
    if (!(inLounge || isHome) || loading.current) return;
    loading.current = true;
    setProgress(0);
    (async () => {
      try {
        // the download is the first stretch of the bar; on the homepage the
        // cave takes the last stretch
        const span = isHomeRef.current ? 0.75 : 0.9;
        const mod = await import("./circuit/lounge3d");
        setProgress(0.1);
        if (!ref.current) return;
        const l = await mod.createLounge(ref.current, setIdle, (d) => setProgress(0.1 + span * d));
        lounge.current = l;
        if (isHomeRef.current) await playIntro(l, 0.1 + span);
        else {
          setProgress(null);
          // left while it was loading: stay flat until the next visit
          l.setInLounge(inLoungeRef.current);
        }
      } catch (e) {
        console.error("Lounge failed to load", e);
        setProgress(null); // no WebGL or a failed download: the flat background stays
        if (isHomeRef.current) dispatchEvent(new CustomEvent("lounge:intro", { detail: "failed" }));
      } finally {
        loading.current = false;
      }
    })();
  }, [inLounge, isHome]);

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
          display: idle && !inLounge && !isHome && progress == null ? "none" : "block",
        }}
      />
      {progress != null && (inLounge || isHome) && (
        <div className="lounge-loading" role="progressbar" aria-label="Loading the Lounge" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span className="hud">LOADING LOUNGE</span>
          <div className="lounge-loading__bar"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <span className="lounge-loading__pct">{Math.round(progress * 100)}%</span>
        </div>
      )}
    </>
  );
}
