"use client";

import { useEffect, useRef } from "react";
import { initCircuitKoi } from "./circuit/circuitKoi";

interface Props {
  /** 0..1 ambient activity (filled slots / count). */
  intensity?: number;
  /** true during contract execution. */
  surge?: boolean;
}

export default function CircuitBoard({ intensity = 0.15, surge = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<ReturnType<typeof initCircuitKoi> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const handle = initCircuitKoi(canvasRef.current);
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
