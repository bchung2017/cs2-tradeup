"use client";

// The Lounge's 3D pond, layered just above the flat background. It follows the
// route: on /lounge the camera eases into the three-quarter view, anywhere
// else it eases back to straight down and then stops drawing. three.js and the
// scene load the first time the Lounge is opened, so other pages don't pay.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { Lounge } from "./circuit/lounge3d";

export default function LoungeBackdrop() {
  const pathname = usePathname();
  const inLounge = pathname === "/lounge";
  const ref = useRef<HTMLCanvasElement>(null);
  const lounge = useRef<Lounge | null>(null);
  const [idle, setIdle] = useState(true);

  useEffect(() => {
    if (!inLounge && !lounge.current) return; // never opened: nothing to do
    let cancelled = false;
    (async () => {
      if (!lounge.current) {
        const { initLounge } = await import("./circuit/lounge3d");
        if (cancelled || !ref.current) return;
        lounge.current = initLounge(ref.current, setIdle);
      }
      lounge.current.setInLounge(inLounge);
    })();
    return () => {
      cancelled = true;
    };
  }, [inLounge]);

  useEffect(() => () => lounge.current?.destroy(), []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0,
        display: idle && !inLounge ? "none" : "block",
      }}
    />
  );
}
