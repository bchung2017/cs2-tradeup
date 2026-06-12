"use client";

import { useEffect, useRef } from "react";

interface Props {
  /** 0..1 — ambient activity level (e.g. filled slots / 10). */
  intensity: number;
  /** true during contract execution — traces surge bright. */
  surge: boolean;
}

type Pt = { x: number; y: number };
type Trace = {
  pts: Pt[];          // polyline, Manhattan-routed
  len: number;        // total length in px (for pulse param)
  width: number;
  baseAlpha: number;
};
type Via = {
  x: number;
  y: number;
  r: number;
  rings: number;
  charged: boolean;   // a "hot" pad that glows brighter
  phase: number;      // breathing offset
};
type Pulse = {
  trace: number;      // index into traces
  t: number;          // 0..1 position along trace
  speed: number;
  life: number;       // remaining 0..1
};

const GREEN = { r: 51, g: 255, b: 51 };

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Walk a polyline to find the point at arc-length fraction t (0..1). */
function pointAt(trace: Trace, t: number): Pt {
  const target = t * trace.len;
  let acc = 0;
  for (let i = 0; i < trace.pts.length - 1; i++) {
    const a = trace.pts[i];
    const b = trace.pts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= target) {
      const f = seg === 0 ? 0 : (target - acc) / seg;
      return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
    }
    acc += seg;
  }
  return trace.pts[trace.pts.length - 1];
}

function polylineLen(pts: Pt[]): number {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    l += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return l;
}

/** Manhattan route between two points with a random elbow. */
function manhattan(a: Pt, b: Pt, rng: () => number): Pt[] {
  const pts: Pt[] = [a];
  // pick a midpoint to elbow at; sometimes 2 elbows for that PCB stagger
  if (rng() > 0.5) {
    const midX = lerp(a.x, b.x, 0.3 + rng() * 0.4);
    pts.push({ x: midX, y: a.y });
    pts.push({ x: midX, y: b.y });
  } else {
    const midY = lerp(a.y, b.y, 0.3 + rng() * 0.4);
    pts.push({ x: a.x, y: midY });
    pts.push({ x: b.x, y: midY });
  }
  pts.push(b);
  return pts;
}

// Tiny seeded RNG so the board is stable per-mount (no rerender churn).
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function CircuitBoard({ intensity, surge }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // live prop mirror so the rAF loop reads current values without restarting
  const propsRef = useRef({ intensity, surge });
  propsRef.current = { intensity, surge };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxMaybe = canvas.getContext("2d");
    if (!ctxMaybe) return;
    const cv: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = ctxMaybe;

    let raf = 0;
    let traces: Trace[] = [];
    let vias: Via[] = [];
    let pulses: Pulse[] = [];
    let W = 0;
    let H = 0;
    let dpr = 1;

    function build() {
      const rng = mulberry32(0xc5c0ffee);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      traces = [];
      vias = [];
      pulses = [];

      // Bus rails enter from left & right edges, route inward — like the reference.
      const railCount = Math.round((H / 90) * 0.8) + 4;
      for (let i = 0; i < railCount; i++) {
        const fromLeft = rng() > 0.5;
        const edgeY = (i / railCount) * H + (rng() - 0.5) * 40;
        const start: Pt = { x: fromLeft ? -10 : W + 10, y: edgeY };
        const end: Pt = {
          x: fromLeft ? lerp(W * 0.15, W * 0.55, rng()) : lerp(W * 0.45, W * 0.85, rng()),
          y: lerp(0, H, rng()),
        };
        const pts = manhattan(start, end, rng);
        const len = polylineLen(pts);
        traces.push({
          pts,
          len,
          width: rng() > 0.7 ? 2 : 1,
          baseAlpha: 0.1 + rng() * 0.12,
        });
        // terminus via
        vias.push({
          x: end.x,
          y: end.y,
          r: 4 + rng() * 5,
          rings: rng() > 0.5 ? 2 : 1,
          charged: rng() > 0.72,
          phase: rng() * Math.PI * 2,
        });
      }

      // Scattered standalone pads (the dotted columns in the reference).
      const padCount = Math.round((W * H) / 52000);
      for (let i = 0; i < padCount; i++) {
        vias.push({
          x: rng() * W,
          y: rng() * H,
          r: 3 + rng() * 4,
          rings: rng() > 0.6 ? 2 : 1,
          charged: rng() > 0.8,
          phase: rng() * Math.PI * 2,
        });
      }
    }

    function spawnPulse(rng: () => number, hot: boolean) {
      if (!traces.length) return;
      pulses.push({
        trace: Math.floor(rng() * traces.length),
        t: 0,
        speed: (hot ? 0.5 : 0.22) + rng() * 0.25,
        life: 1,
      });
    }

    const rng = mulberry32(0xbadf00d);
    let last = performance.now();
    let spawnAcc = 0;

    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { intensity: I, surge: S } = propsRef.current;

      ctx.clearRect(0, 0, W, H);

      // ---- traces ----
      const traceBoost = S ? 0.5 : lerp(0, 0.25, I);
      for (const tr of traces) {
        ctx.beginPath();
        ctx.moveTo(tr.pts[0].x, tr.pts[0].y);
        for (let i = 1; i < tr.pts.length; i++) ctx.lineTo(tr.pts[i].x, tr.pts[i].y);
        ctx.strokeStyle = `rgba(${GREEN.r},${GREEN.g},${GREEN.b},${tr.baseAlpha + traceBoost})`;
        ctx.lineWidth = tr.width;
        ctx.stroke();
      }

      // ---- vias (breathing) ----
      const t = now / 1000;
      for (const v of vias) {
        const breath = 0.5 + 0.5 * Math.sin(t * (v.charged ? 2.2 : 1.1) + v.phase);
        const baseA = v.charged ? 0.35 : 0.16;
        const a = baseA + breath * (v.charged ? 0.55 : 0.22) + (S ? 0.25 : I * 0.15);

        // outer rings
        for (let k = v.rings; k >= 1; k--) {
          ctx.beginPath();
          ctx.arc(v.x, v.y, v.r * (k / v.rings), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${GREEN.r},${GREEN.g},${GREEN.b},${a * 0.7})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        // hot core + glow
        if (v.charged) {
          const grd = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r * 2.4);
          grd.addColorStop(0, `rgba(170,255,170,${a})`);
          grd.addColorStop(1, "rgba(51,255,51,0)");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(v.x, v.y, v.r * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(v.x, v.y, Math.max(1, v.r * 0.32), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${GREEN.r},${GREEN.g},${GREEN.b},${a})`;
        ctx.fill();
      }

      // ---- pulses traveling along traces ----
      spawnAcc += dt;
      const spawnRate = lerp(0.45, 0.06, Math.min(1, I)) / (S ? 4 : 1);
      while (spawnAcc > spawnRate) {
        spawnAcc -= spawnRate;
        spawnPulse(rng, S);
      }

      for (const p of pulses) {
        p.t += p.speed * dt;
        if (p.t >= 1) p.life -= dt * 3;
        const tr = traces[p.trace];
        if (!tr) {
          p.life = 0;
          continue;
        }
        const head = pointAt(tr, Math.min(1, p.t));
        const grd = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 9);
        const pa = Math.max(0, Math.min(1, p.life)) * (S ? 1 : 0.85);
        grd.addColorStop(0, `rgba(200,255,200,${pa})`);
        grd.addColorStop(0.5, `rgba(51,255,51,${pa * 0.6})`);
        grd.addColorStop(1, "rgba(51,255,51,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      pulses = pulses.filter((p) => p.life > 0 && p.t < 1.2);

      raf = requestAnimationFrame(frame);
    }

    build();
    raf = requestAnimationFrame(frame);

    const onResize = () => build();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
