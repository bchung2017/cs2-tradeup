// Low-cost circuit background for phones and the installed app. Same circuit
// artwork as circuitKoi.js, with the per-frame work cut to the bone:
//   - drawn at one backing pixel per CSS pixel (a third of a 3x phone screen),
//     the same resolution the original's mobile path used, so 1px traces and
//     via rings stay crisp instead of smearing when stretched
//   - everything static (substrate, traces, glow halo, the brighter "lit"
//     trace layer) baked once, blurs included; rebaked only when the width
//     changes or the height changes by more than an address bar
//   - each frame: two blits, a sheen as a clipped blit of the lit layer, the
//     vias twinkling as plain arcs, and a handful of electrons as plain
//     strokes; no shadowBlur, no per-segment color math, no koi
//   - capped at 20 fps, stopped while the tab is hidden, a single still
//     frame when the system asks for reduced motion
import { CIRCUIT_DATA } from "./circuitData";

type Pt = { x: number; y: number };
interface Electron { tr: Pt[]; seg: number; t: number; hist: Pt[] }
interface Via { x: number; y: number; ph: number }

const SCALE = 1; // backing pixels per CSS pixel (not per device pixel)
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
  let vias: Via[] = [];

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
    const seen = new Set<string>();
    vias = [];
    for (const [x, y] of D.p) {
      const px = x * s + ox, py = y * s + oy, k = `${Math.round(px)},${Math.round(py)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      vias.push({ x: px, y: py, ph: Math.random() * 6.28 });
    }

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
    b.strokeStyle = "rgba(25,160,25,0.16)"; // the original's base trace
    b.lineWidth = 1;
    stroke(b);
    // a dark vignette, baked rather than drawn per frame
    const v = b.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    b.fillStyle = v;
    b.fillRect(0, 0, W, H);

    const g = glow.getContext("2d")!;
    g.clearRect(0, 0, W, H);
    g.shadowColor = "rgba(60,255,150,0.9)";
    g.shadowBlur = 6;
    g.strokeStyle = "rgba(40,220,130,0.08)";
    g.lineWidth = 1.5;
    stroke(g);

    const l = lit.getContext("2d")!;
    l.clearRect(0, 0, W, H);
    l.strokeStyle = "rgba(150,255,190,0.6)";
    l.lineWidth = 1;
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
    ctx!.globalAlpha = Math.sin(p * Math.PI) * 0.6;
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
    const step = live.surge ? 0.15 : 0.075; // the original's per-frame pace, at 20 fps
    ctx!.globalCompositeOperation = "lighter";
    ctx!.lineCap = "round";
    electrons = electrons.filter((e) => {
      e.t += step;
      while (e.t >= 1) { e.t -= 1; e.seg++; }
      if (e.seg >= e.tr.length - 1) return false;
      const a = e.tr[e.seg], b = e.tr[e.seg + 1];
      const p = { x: a.x + (b.x - a.x) * e.t, y: a.y + (b.y - a.y) * e.t };
      e.hist.push(p);
      if (e.hist.length > 10) e.hist.shift();
      const n = e.hist.length;
      for (let i = 1; i < n; i++) {
        const f = i / n;
        ctx!.strokeStyle = `rgba(120,255,140,${f * f * 0.5})`;
        ctx!.lineWidth = 0.5 + f * 2;
        ctx!.beginPath(); ctx!.moveTo(e.hist[i - 1].x, e.hist[i - 1].y); ctx!.lineTo(e.hist[i].x, e.hist[i].y); ctx!.stroke();
      }
      ctx!.fillStyle = "rgba(120,255,140,0.07)"; // stands in for the original's blur
      ctx!.beginPath(); ctx!.arc(p.x, p.y, 9, 0, 6.28); ctx!.fill();
      ctx!.fillStyle = "rgba(120,255,140,0.16)";
      ctx!.beginPath(); ctx!.arc(p.x, p.y, 5, 0, 6.28); ctx!.fill();
      ctx!.fillStyle = "rgba(180,255,190,0.95)";
      ctx!.beginPath(); ctx!.arc(p.x, p.y, 2.4, 0, 6.28); ctx!.fill();
      return true;
    });
    ctx!.globalCompositeOperation = "source-over";
  }

  // vias as the original draws them at rest: a dot and a ring, each slowly
  // breathing on its own phase
  function drawVias(t: number) {
    const k = 0.4 + live.intensity;
    ctx!.lineWidth = 1;
    for (const v of vias) {
      const b = (0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.4 + v.ph))) * k;
      ctx!.fillStyle = `rgba(51,255,51,${b * 0.3})`;
      ctx!.beginPath(); ctx!.arc(v.x, v.y, 2.3, 0, 6.28); ctx!.fill();
      ctx!.strokeStyle = `rgba(25,160,25,${b * 0.22})`;
      ctx!.beginPath(); ctx!.arc(v.x, v.y, 4.2, 0, 6.28); ctx!.stroke();
    }
  }

  function draw(t: number, still = false) {
    ctx!.drawImage(base, 0, 0);
    ctx!.globalAlpha = still ? 0.8 : 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.6));
    ctx!.drawImage(glow, 0, 0);
    ctx!.globalAlpha = 1;
    drawVias(t);
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

  // Android fires resize as the address bar slides in and out while
  // scrolling; rebaking for that would stutter. Rebake for real changes only.
  let lastW = innerWidth, lastH = innerHeight, resizeTimer = 0;
  function onResize() {
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 160) return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      lastW = innerWidth; lastH = innerHeight;
      layout();
      draw(performance.now() / 1000, reduced);
    }, 150);
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
      clearTimeout(resizeTimer);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
