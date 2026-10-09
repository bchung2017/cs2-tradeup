// Low-cost circuit background for phones and the installed app. Same circuit
// artwork as circuitKoi.js, with the per-frame work cut to the bone:
//   - drawn at half the screen's CSS resolution and stretched by the browser
//   - everything static (substrate, traces, glow halo, resting vias, the
//     brighter "lit" trace layer) baked once per resize, blurs included
//   - each frame: one blit, a breathing glow as a second blit at varying alpha,
//     a sheen as a clipped blit of the lit layer, and a handful of electrons
//     as plain strokes; no shadowBlur, no per-segment color math, no koi
//   - capped at 20 fps, stopped while the tab is hidden, a single still
//     frame when the system asks for reduced motion
import { CIRCUIT_DATA } from "./circuitData";

type Pt = { x: number; y: number };
interface Electron { tr: Pt[]; seg: number; t: number; hist: Pt[] }

const SCALE = 0.5; // backing pixels per CSS pixel
const FPS = 20;
const MAX_ELECTRONS = 6;
const BG = "#020507";

export function initCircuitLite(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const live = { intensity: 0.15, surge: false };
  let stopped = false;
  let raf = 0;
  if (!ctx) return { setLive() {}, destroy() {} };

  const base = document.createElement("canvas"); // substrate + dim traces + resting vias
  const glow = document.createElement("canvas"); // blurred halo, blitted at a breathing alpha
  const lit = document.createElement("canvas"); // bright traces, revealed by the sheen
  let W = 0, H = 0; // backing size
  let paths: Pt[][] = [];
  let routes: Pt[][] = []; // traces long enough to carry an electron
  let electrons: Electron[] = [];

  function layout() {
    W = Math.max(1, Math.round(innerWidth * SCALE));
    H = Math.max(1, Math.round(innerHeight * SCALE));
    for (const c of [canvas, base, glow, lit]) { c.width = W; c.height = H; }
    const D = CIRCUIT_DATA as { vw: number; vh: number; t: number[][][]; p: number[][] };
    const s = Math.max(W / D.vw, H / D.vh);
    const ox = (W - D.vw * s) / 2, oy = (H - D.vh * s) / 2;
    paths = D.t.map((t) => t.map(([x, y]) => ({ x: x * s + ox, y: y * s + oy })));
    routes = paths.filter((p) => {
      let len = 0;
      for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
      return p.length >= 4 && len > 40;
    });
    electrons = [];

    const stroke = (c: CanvasRenderingContext2D) => {
      c.beginPath();
      for (const p of paths) {
        c.moveTo(p[0].x, p[0].y);
        for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, p[i].y);
      }
      c.stroke();
    };

    const b = base.getContext("2d")!;
    b.fillStyle = BG;
    b.fillRect(0, 0, W, H);
    b.strokeStyle = "rgba(25,160,25,0.22)";
    b.lineWidth = 0.75;
    stroke(b);
    b.fillStyle = "rgba(51,255,51,0.22)";
    b.strokeStyle = "rgba(25,160,25,0.2)";
    for (const [x, y] of D.p) {
      const px = x * s + ox, py = y * s + oy;
      b.beginPath(); b.arc(px, py, 1.2, 0, 6.28); b.fill();
      b.beginPath(); b.arc(px, py, 2.1, 0, 6.28); b.stroke();
    }
    // a dark vignette, baked rather than drawn per frame
    const v = b.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    b.fillStyle = v;
    b.fillRect(0, 0, W, H);

    const g = glow.getContext("2d")!;
    g.clearRect(0, 0, W, H);
    g.shadowColor = "rgba(60,255,150,0.9)";
    g.shadowBlur = 4;
    g.strokeStyle = "rgba(40,220,130,0.16)";
    g.lineWidth = 1;
    stroke(g);

    const l = lit.getContext("2d")!;
    l.clearRect(0, 0, W, H);
    l.strokeStyle = "rgba(150,255,190,0.85)";
    l.lineWidth = 0.9;
    stroke(l);
  }

  // sheen: a diagonal band sweeping across, every ~12 s
  let sheenStart = -1;
  function drawSheen(t: number) {
    const dur = live.surge ? 2.5 : 4, gap = 8;
    if (sheenStart < 0) sheenStart = t;
    const p = (t - sheenStart) / dur;
    if (p > 1 + gap / dur) { sheenStart = t; return; }
    if (p > 1) return;
    const diag = W + H, band = diag * 0.12, pos = -band + p * (diag + band * 2);
    ctx!.save();
    ctx!.globalAlpha = Math.sin(p * Math.PI) * 0.7;
    ctx!.beginPath(); // the band x + y ∈ [pos − band/2, pos + band/2]
    ctx!.moveTo(pos - band / 2, 0); ctx!.lineTo(pos + band / 2, 0);
    ctx!.lineTo(pos + band / 2 - H, H); ctx!.lineTo(pos - band / 2 - H, H);
    ctx!.closePath();
    ctx!.clip();
    ctx!.drawImage(lit, 0, 0);
    ctx!.restore();
  }

  function drawElectrons() {
    const cap = live.surge ? MAX_ELECTRONS * 2 : MAX_ELECTRONS;
    if (electrons.length < cap && routes.length && Math.random() < 0.08 + live.intensity * 0.2) {
      const tr = routes[Math.floor(Math.random() * routes.length)];
      electrons.push({ tr, seg: 0, t: 0, hist: [] });
    }
    const step = live.surge ? 0.3 : 0.15; // segment fraction per frame at 20 fps
    ctx!.globalCompositeOperation = "lighter";
    ctx!.lineCap = "round";
    electrons = electrons.filter((e) => {
      e.t += step;
      while (e.t >= 1) { e.t -= 1; e.seg++; }
      if (e.seg >= e.tr.length - 1) return false;
      const a = e.tr[e.seg], b = e.tr[e.seg + 1];
      const p = { x: a.x + (b.x - a.x) * e.t, y: a.y + (b.y - a.y) * e.t };
      e.hist.push(p);
      if (e.hist.length > 6) e.hist.shift();
      ctx!.strokeStyle = "rgba(120,255,140,0.35)";
      ctx!.lineWidth = 1.2;
      ctx!.beginPath();
      ctx!.moveTo(e.hist[0].x, e.hist[0].y);
      for (const h of e.hist) ctx!.lineTo(h.x, h.y);
      ctx!.stroke();
      ctx!.fillStyle = "rgba(120,255,140,0.18)";
      ctx!.beginPath(); ctx!.arc(p.x, p.y, 3, 0, 6.28); ctx!.fill();
      ctx!.fillStyle = "rgba(200,255,210,0.95)";
      ctx!.beginPath(); ctx!.arc(p.x, p.y, 1.3, 0, 6.28); ctx!.fill();
      return true;
    });
    ctx!.globalCompositeOperation = "source-over";
  }

  function draw(t: number, still = false) {
    ctx!.drawImage(base, 0, 0);
    ctx!.globalAlpha = still ? 0.6 : 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.6)) + live.intensity * 0.2;
    ctx!.drawImage(glow, 0, 0);
    ctx!.globalAlpha = 1;
    if (still) return;
    drawSheen(t);
    drawElectrons();
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let last = 0;
  function frame(now: number) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS - 2) return;
    last = now;
    draw(now / 1000);
  }

  function onResize() {
    layout();
    draw(performance.now() / 1000, reduced);
  }
  function onVisibility() {
    cancelAnimationFrame(raf);
    if (!document.hidden && !reduced && !stopped) raf = requestAnimationFrame(frame);
  }

  layout();
  draw(0, reduced);
  if (!reduced) raf = requestAnimationFrame(frame);
  addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    setLive(intensity: number, surge: boolean) {
      live.intensity = intensity;
      live.surge = surge;
    },
    destroy() {
      stopped = true;
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
