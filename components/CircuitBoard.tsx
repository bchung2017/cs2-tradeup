"use client";

import { useEffect, useRef } from "react";
import { initCircuitKoi } from "./circuit/circuitKoi";
import { initCircuitLite } from "./circuit/circuitLite";

// Phones and tablets (and the installed app on them) get the lite renderer:
// half resolution, baked layers, 20 fps, no water or koi.
const isTouch = () => matchMedia("(pointer: coarse)").matches;

interface Props {
  /** 0..1 ambient activity (filled slots / count). */
  intensity?: number;
  /** true during contract execution. */
  surge?: boolean;
}

export default function CircuitBoard({ intensity = 0.15, surge = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<{ setLive(i: number, s: boolean): void; destroy(): void } | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const handle = isTouch() ? initCircuitLite(canvasRef.current) : initCircuitKoi(canvasRef.current);
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setLive(intensity, surge);
  }, [intensity, surge]);

  return (
    <canvas
      id="board"
      ref={canvasRef}
      aria-hidden
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none", background: "#020507" }}
    />
  );
}
