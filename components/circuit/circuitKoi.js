// Circuit + koi + WebGL-water background. Vendored verbatim from the design
// source and wrapped so it only runs when initCircuitKoi(canvas) is called on
// the client. Plain JS on purpose — do not restyle by hand.
import { CIRCUIT_DATA } from "./circuitData";

export function initCircuitKoi(canvas) {
  const win = window;
  win.__CIRCUIT_DATA = CIRCUIT_DATA;
  let stopped = false;
  const teardown = [];

window.__IS_TOUCH = matchMedia("(pointer: coarse)").matches;
window.Circuit2D = (function () {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  // cache canvas: the static base-trace layer, drawn once per resize and blitted
  // each frame instead of re-stroking 1398 traces. Only animated overlays
  // (sheen, electrons, blooms, breathing glow) are drawn live on top.
  const cache = document.createElement("canvas");
  const cctx = cache.getContext("2d");
  const live = { intensity: 0.15, surge: false };

  let W = 0, H = 0, DPR = 1;
  let traces = [], pulses = [], vias = [], viaAt = new Map();
  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const GRID = 40;

  // ---- hsl -> "r,g,b" ------------------------------------------------------
  function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c);
    };
    return `${f(0)},${f(8)},${f(4)}`;
  }

  // ---- autorouter: continuous self-avoiding walks, no crossings ------------
  const edgeKey = (ax, ay, bx, by) =>
    ax < bx || ay < by ? `${ax},${ay}-${bx},${by}` : `${bx},${by}-${ax},${ay}`;
  const nodeKey = (x, y) => `${x},${y}`;

  // build(): load the EXACT reference circuit (extracted from the source image by
  // skeletonizing its traces and detecting its ring pads), scaled with COVER fit
  // to fill the viewport. This is the real layout, not a generated approximation.
  function build() {
    seed = 1337; traces = []; vias = []; viaAt = new Map();
    const D = window.__CIRCUIT_DATA;
    if (!D) return;
    // cover-fit: scale so the (square) artwork fills the viewport, center-cropped
    const s = Math.max(W / D.vw, H / D.vh);
    const ox = (W - D.vw * s) / 2, oy = (H - D.vh * s) / 2;
    const TX = (x) => x * s + ox, TY = (y) => y * s + oy;
    for (const t of D.t) {
      traces.push(t.map(([x, y]) => ({ x: TX(x), y: TY(y) })));
    }
    const seen = new Set();
    for (const [x, y] of D.p) {
      const px = TX(x), py = TY(y), k = `${Math.round(px)},${Math.round(py)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      vias.push({ x: px, y: py, ph: rnd() * 6.28, excite: 0 });
    }

    viaAt = new Map();
    for (const vv of vias) viaAt.set(`${Math.round(vv.x)},${Math.round(vv.y)}`, vv);
  }

  // ---- sheen: sweep + bloom, ruffled borders -------------------------------
  function windNoise(u, t) {
    return 0.55 * Math.sin(u * 6.3 + t * 1.1) + 0.30 * Math.sin(u * 13.7 - t * 1.7 + 1.3) + 0.15 * Math.sin(u * 27.1 + t * 2.3 + 4.2);
  }
  function ringNoise(a, t) {
    const T = a * 2 * Math.PI;
    return 0.55 * Math.sin(3 * T + t * 1.1) + 0.30 * Math.sin(7 * T - t * 1.7 + 1.3) + 0.15 * Math.sin(13 * T + t * 2.3 + 4.2);
  }
  const W2 = () => W / 2, H2 = () => H / 2;
  function bandFn(d, p, width) {
    const dist = Math.abs(d - p);
    if (dist > width) return 0;
    const t = 1 - dist / width;
    return t * t;
  }
  const SHEEN_MODES = [
    (() => {
      const axes = [
        (x, y) => [(x + y) / (W + H), (x - y) / (W + H)],
        (x, y) => [(x - y + H) / (W + H), (x + y) / (W + H)],
        (x, y) => [x / W, y / H],
        (x, y) => [y / H, x / W],
        (x, y) => [1 - x / W, y / H],
        (x, y) => [1 - (x + y) / (W + H), (x - y) / (W + H)],
      ];
      let axis = axes[0];
      const fn = (x, y, p) => {
        const [d, across] = axis(x, y);
        const ruffle = windNoise(across * 4, p * 6) * 0.035;
        return bandFn(d + ruffle, p, 0.12);
      };
      fn.reset = () => { axis = axes[Math.floor(rnd() * axes.length)]; };
      return fn;
    })(),
  ];
  const sheen = { active: true, p: 0, cooldown: 0, mode: SHEEN_MODES[0] };
  function startSheen() {
    sheen.active = true; sheen.p = 0;
    sheen.mode = SHEEN_MODES[Math.floor(rnd() * SHEEN_MODES.length)];
    if (sheen.mode.reset) sheen.mode.reset();
  }
  function updateSheen() {
    if (sheen.active) {
      sheen.p += live.surge ? 0.014 : 0.009;
      if (sheen.p >= 1) { sheen.active = false; sheen.cooldown = 150 + Math.floor(rnd() * 240); }
    } else if (sheen.cooldown > 0) sheen.cooldown--;
    else startSheen();
  }

  function sheenAt(x, y) {
    return sheen.active ? sheen.mode(x, y, sheen.p) * Math.sin(sheen.p * Math.PI) : 0;
  }

  // ---- pulses / electrons --------------------------------------------------
  function spawn() {
    const rate = (0.04 + live.intensity * 0.3) * (live.surge ? 4 : 1);
    const attempts = window.__IS_TOUCH ? (live.surge ? 2 : 1) : (live.surge ? 6 : 3);
    for (let a = 0; a < attempts; a++) {
      if (rnd() < rate && traces.length) {
        const tr = traces[Math.floor(rnd() * traces.length)];
        pulses.push({ tr, seg: 0, t: 0, end: tr[tr.length - 1] });
      }
    }
  }

  // bake the static base layer once: dark substrate + every trace as a dim line,
  // plus the static via dots/rings at their resting brightness. Animated lighting
  // is composited live on top of a blit of this cache.
  const CACHE_BASE_A = 0.16;        // reference base alpha baked in (blit scales it)
  function buildCache() {
    cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cctx.clearRect(0, 0, W, H);
    cctx.fillStyle = "#020507";
    cctx.fillRect(0, 0, W, H);
    // base dim traces, batched into one stroke
    cctx.strokeStyle = `rgba(25,160,25,${CACHE_BASE_A})`;
    cctx.lineWidth = 1;
    cctx.beginPath();
    for (const tr of traces) {
      cctx.moveTo(tr[0].x, tr[0].y);
      for (let i = 1; i < tr.length; i++) cctx.lineTo(tr[i].x, tr[i].y);
    }
    cctx.stroke();
  }

  // is anything lighting traces this frame? Only the sheen sweep now (it spans the
  // field), so the per-segment overlay work runs only while a sweep is active.
  function litThisFrame() { return sheen.active; }

  // ---- the frame: draws the whole circuit into the offscreen canvas --------
  function render(tnow) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    updateSheen();
    const baseA = 0.05 + live.intensity * 0.10 + (live.surge ? 0.06 : 0);

    // blit the cached static base layer (substrate + dim traces). globalAlpha
    // scales the baked CACHE_BASE_A toward this frame's baseA so intensity/surge
    // still modulate brightness without re-stroking every trace.
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.lineWidth = 1;

    // permanent bioluminescent glow: a faint blurred halo under the wiring,
    // breathing slowly. Batched into a SINGLE path+stroke (one shadowBlur/frame).
    ctx.save();
    const breathe = 0.5 + 0.5 * Math.sin(tnow * 0.6);
    ctx.shadowColor = "rgba(60,255,150,0.9)";
    ctx.shadowBlur = 5 + 3 * breathe;
    ctx.strokeStyle = `rgba(40,220,130,${0.05 + 0.03 * breathe + live.intensity * 0.03})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const tr of traces) {
      ctx.moveTo(tr[0].x, tr[0].y);
      for (let i = 1; i < tr.length; i++) ctx.lineTo(tr[i].x, tr[i].y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1;

    // LIT OVERLAY: the per-segment iridescence only matters under an active sheen
    // sweep. When no sweep is running (most frames) skip the whole pass entirely.
    if (litThisFrame()) for (const tr of traces) {
      const STEP = 8;
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.round(segLen / STEP));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          const x0 = a.x + (b.x - a.x) * t0, y0 = a.y + (b.y - a.y) * t0;
          const x1 = a.x + (b.x - a.x) * t1, y1 = a.y + (b.y - a.y) * t1;
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const s = sheenAt(mx, my);
          if (s > 0.05) {
            const arc = (mx + my) * 0.0003 + tnow * 0.1 + s * 0.45;
            const hue = 0.33 + (arc % 0.45);
            const metal = Math.pow(0.5 + 0.5 * Math.sin((mx - my) * 0.03 + tnow * 1.8 + s * 4), 6);
            const sat = 0.6 * (1 - metal);
            const lum = 0.58 + metal * 0.32 * s;
            const col = hsl(hue, sat, lum);
            const glow = Math.max(0, (s - 0.6) / 0.4);
            if (glow > 0) {
              ctx.save();
              ctx.shadowColor = `rgba(${col},0.9)`;
              ctx.shadowBlur = 8 * glow;
              ctx.lineWidth = 1 + glow;
              ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
              ctx.strokeStyle = `rgba(${col},${(baseA + s * 0.78) * (0.4 + 0.6 * glow)})`;
              ctx.stroke(); ctx.restore(); ctx.lineWidth = 1;
            } else {
              ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
              ctx.strokeStyle = `rgba(${col},${baseA + s * 0.78})`; ctx.stroke();
            }
          }
        }
      }
    }

    const tt = performance.now() / 1000;
    for (const v of vias) {
      const idle = (0.2 + 0.5 * (0.5 + 0.5 * Math.sin(tt * 1.4 + v.ph))) * (0.4 + live.intensity);
      if (v.excite > 0) v.excite = Math.max(0, v.excite - 0.025);
      const e = v.excite, sh = sheenAt(v.x, v.y);
      const b = idle + e * 0.9 + sh * 0.7;
      const glow = Math.max(e, sh);
      if (glow > 0.02) {
        ctx.save();
        ctx.shadowColor = "rgba(120,255,120,0.9)";
        ctx.shadowBlur = 10 * glow;
        ctx.beginPath(); ctx.arc(v.x, v.y, 2.3 + 1.5 * glow, 0, 6.28);
        ctx.fillStyle = `rgba(160,255,160,${0.5 * glow})`; ctx.fill();
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(v.x, v.y, 2.3, 0, 6.28);
      ctx.fillStyle = `rgba(51,255,51,${b * 0.3 + (e + sh) * 0.5})`; ctx.fill();
      ctx.beginPath(); ctx.arc(v.x, v.y, 4.2, 0, 6.28);
      ctx.strokeStyle = `rgba(25,160,25,${b * 0.22 + (e + sh) * 0.3})`; ctx.stroke();
    }

    spawn();
    pulses = pulses.filter((p) => {
      p.t += live.surge ? 0.05 : 0.025;
      if (p.t >= 1) {
        p.seg++; p.t = 0;
        if (p.seg >= p.tr.length - 1) { return false; }
      }
      const a = p.tr[p.seg], b = p.tr[p.seg + 1];
      if (!a || !b) return false;
      const px = a.x + (b.x - a.x) * p.t, py = a.y + (b.y - a.y) * p.t;

      if (!p.hist) p.hist = [];
      p.hist.push({ x: px, y: py });
      if (p.hist.length > 14) p.hist.shift();
      const nh = p.hist.length;
      for (let i = 1; i < nh; i++) {
        const f = i / nh, h0 = p.hist[i - 1], h1 = p.hist[i];
        ctx.beginPath(); ctx.moveTo(h0.x, h0.y); ctx.lineTo(h1.x, h1.y);
        ctx.lineWidth = 0.5 + f * 2;
        ctx.strokeStyle = `rgba(120,255,140,${f * f * 0.5})`;
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      const hs = Math.max(sheenAt(px, py), rippleEnergyAt(px, py));
      const gl = Math.min(1, hs * 1.4);
      let headCol, haloCol;
      if (gl > 0.02) {
        const arc = (px + py) * 0.0003 + tnow * 0.1 + hs * 0.45;
        const hue = 0.33 + (arc % 0.45);
        const metal = Math.pow(0.5 + 0.5 * Math.sin((px - py) * 0.03 + tnow * 1.8 + hs * 4), 6);
        const sat = 0.6 * (1 - metal);
        const lum = 0.62 + metal * 0.3 * gl;
        const irid = hsl(hue, sat, lum);
        const L = (a0, b0) => Math.round(a0 + (b0 - a0) * gl);
        const [ir, ig, ib] = irid.split(",").map(Number);
        headCol = `${L(180, ir)},${L(255, ig)},${L(190, ib)}`;
        const halo = hsl(hue, Math.min(1, sat + 0.15), 0.55 + metal * 0.3 * gl);
        const [hr, hg, hb] = halo.split(",").map(Number);
        haloCol = `${L(120, hr)},${L(255, hg)},${L(140, hb)}`;
      } else { headCol = "180,255,190"; haloCol = "120,255,140"; }

      ctx.save();
      ctx.shadowColor = `rgba(${haloCol},0.9)`;
      ctx.shadowBlur = 8 + 10 * gl;
      ctx.beginPath(); ctx.arc(px, py, 2.4 + 1.2 * gl, 0, 6.28);
      ctx.fillStyle = `rgba(${headCol},0.95)`; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(px, py, 5 + 3 * gl, 0, 6.28);
      ctx.fillStyle = `rgba(${haloCol},${0.16 + 0.25 * gl})`; ctx.fill();

      if (gl > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = `rgba(${headCol},0.9)`;
        ctx.shadowBlur = 14 * gl;
        ctx.beginPath(); ctx.arc(px, py, 1.6 + 2.6 * gl, 0, 6.28);
        ctx.fillStyle = `rgba(245,250,255,${0.6 * gl})`; ctx.fill();
        ctx.restore();
      }
      return true;
    });

    // metallic koi swimming through the circuit-water, refracted with everything
    updateKoi(tnow);
    for (const f of koi) drawKoi(f);
  }

  // ---- metallic top-down koi (adapted from upload) ------------------------
  // Smoke-textured metallic body with a moving specular sweep + rim light, colored
  // fins. Live in circuit-pixel space, drawn into ctx, refracted by the water.
  // No pointer/sliders: count fixed, shine fixed; tail+spec animate on their own.
  const KOI = { TWO_PI: Math.PI * 2, SEG: 20, CRAWL: 7, DRIFT: 64, MAX_OFF: Math.PI / 18, TURN_OMEGA: 0.09, get COUNT() { return window.__IS_TOUCH ? 2 : 4; }, SHINE: 1.0 };
  const krand = (a, b) => a + Math.random() * (b - a);

  const KSCHEMES = [
    { base:[40,12,4],   mid:[180,80,12],   hot:[255,200,60]  },
    { base:[20,2,4],    mid:[160,8,12],    hot:[255,110,80]  },
    { base:[2,28,8],    mid:[12,170,40],   hot:[120,255,160] },
    { base:[2,4,38],    mid:[20,40,170],   hot:[120,160,255] },
    { base:[28,16,2],   mid:[180,120,20],  hot:[255,220,120] },
    { base:[24,4,28],   mid:[120,30,140],  hot:[230,140,255] },
    { base:[60,62,68],  mid:[170,174,180], hot:[255,255,255] },   // white/platinum
    { base:[4,5,7],     mid:[34,36,42],    hot:[150,160,175] },   // black/gunmetal
  ];
  const krgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  // weighted scheme pick (indices into KSCHEMES):
  // 0 sunset, 1 crimson, 2 jade, 3 sapphire, 4 amber, 5 plum, 6 white, 7 black
  const KWEIGHTS = [
    { i: 7, w: 20 },  // black
    { i: 6, w: 20 },  // white
    { i: 0, w: 20 },  // sunset
    { i: 4, w: 20 },  // amber
    { i: 5, w: 6 },   // plum
    { i: 3, w: 6 },   // sapphire
    { i: 2, w: 6 },   // jade
    { i: 1, w: 2 },   // crimson — rarest
  ];
  const KWEIGHT_TOTAL = KWEIGHTS.reduce((s, k) => s + k.w, 0);
  function pickScheme() {
    let r = Math.random() * KWEIGHT_TOTAL;
    for (const k of KWEIGHTS) { if (r < k.w) return ktextures[k.i]; r -= k.w; }
    return ktextures[KWEIGHTS[0].i];
  }
  function makeSmokeTexture(sc, size) {
    const off = document.createElement("canvas"); off.width = off.height = size;
    const c = off.getContext("2d");
    const img = c.createImageData(size, size);
    function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function noise(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const a = hash(xi, yi), b = hash(xi + 1, yi), cc = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      const u = smooth(xf), v = smooth(yf);
      return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v;
    }
    function fbm(x, y) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { v += noise(x * f, y * f) * a; a *= 0.55; f *= 2.1; } return v; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function mix3(c1, c2, c3, t) {
      if (t < 0.55) { const k = t / 0.55; return [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)]; }
      const k = (t - 0.55) / 0.45; return [lerp(c2[0], c3[0], k), lerp(c2[1], c3[1], k), lerp(c2[2], c3[2], k)];
    }
    const data = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const wx = fbm(x * 0.012 + 13.7, y * 0.012 + 9.1);
      const wy = fbm(x * 0.012 - 4.3, y * 0.012 + 22.5);
      const v = fbm(x * 0.018 + wx * 3.0, y * 0.018 + wy * 3.0);
      const t = Math.min(1, Math.max(0, (v - 0.30) / 0.55));
      const col = mix3(sc.base, sc.mid, sc.hot, t);
      const i = (y * size + x) * 4;
      data[i] = col[0] | 0; data[i + 1] = col[1] | 0; data[i + 2] = col[2] | 0; data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return off;
  }
  const KTEX_SIZE = 256;
  const ktextures = KSCHEMES.map(s => ({ scheme: s, tex: makeSmokeTexture(s, KTEX_SIZE) }));

  let koi = [], koiLast = -1;
  function koiSpawnPlacement(L) {
    // try a few placements and pick one that isn't right on top of another fish.
    // Distance check is in pixel space, using each fish's actual current pos +
    // length so a long fish reserves more space than a short one.
    const MIN_SEP = Math.max(L * 2.5, 180);
    let best = null, bestSep = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const M = L * krand(1.2, 4.5), side = Math.floor(krand(0, 4));
      const spread = krand(-1.2, 1.2);
      let x, y, heading;
      if (side === 0) { x = -M; y = krand(-0.1 * H, 1.1 * H); heading = spread; }
      else if (side === 1) { x = W + M; y = krand(-0.1 * H, 1.1 * H); heading = Math.PI + spread; }
      else if (side === 2) { y = -M; x = krand(-0.1 * W, 1.1 * W); heading = Math.PI / 2 + spread; }
      else { y = H + M; x = krand(-0.1 * W, 1.1 * W); heading = -Math.PI / 2 + spread; }
      // nearest existing koi to this candidate
      let nearest = Infinity;
      for (const other of koi) {
        const d = Math.hypot(x - other.x, y - other.y);
        if (d < nearest) nearest = d;
      }
      if (nearest >= MIN_SEP) return { x, y, heading };   // good enough, take it
      if (nearest > bestSep) { bestSep = nearest; best = { x, y, heading }; }
    }
    return best;                                            // best of 12 tries
  }
  function makeKoi() {
    const len = krand(110, 150), p = koiSpawnPlacement(len);
    const t = pickScheme();
    const f = { x: p.x, y: p.y, heading: p.heading, targetHeading: p.heading, speed: KOI.DRIFT, len,
      tailPhase: krand(0, KOI.TWO_PI), turnTimer: krand(2, 6), trail: [],
      tex: t.tex, scheme: t.scheme, texPhase: krand(0, KOI.TWO_PI), uvOff: krand(0, 1) };
    const need = len * 2.0;
    for (let d = 0; d < need; d += 3) f.trail.push({ x: f.x - Math.cos(f.heading) * d, y: f.y - Math.sin(f.heading) * d });
    return f;
  }
  function setKoiCount(n) { while (koi.length < n) koi.push(makeKoi()); if (koi.length > n) koi.length = n; }
  const kAngDiff = (a, b) => ((b - a + Math.PI) % KOI.TWO_PI) - Math.PI;
  function kTrailLength(tr) { let s = 0; for (let i = 1; i < tr.length; i++) s += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y); return s; }
  function kCapByLength(tr, keep) { let acc = 0, cut = tr.length; for (let i = 1; i < tr.length; i++) { acc += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y); if (acc > keep) { cut = i + 1; break; } } if (cut < tr.length) tr.length = cut; }
  function updateKoi(tnow) {
    if (koiLast < 0) koiLast = tnow;
    let dt = tnow - koiLast; koiLast = tnow;
    if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
    if (koi.length !== KOI.COUNT) setKoiCount(KOI.COUNT);
    for (const f of koi) {
      const onScreen = (f.x > 0 && f.x < W && f.y > 0 && f.y < H);
      f.turnTimer -= dt;
      if (f.turnTimer <= 0) { f.targetHeading = f.heading + krand(-KOI.MAX_OFF * 0.5, KOI.MAX_OFF * 0.5); f.turnTimer = krand(3, 7); }
      const dd0 = kAngDiff(f.heading, f.targetHeading);
      if (Math.abs(dd0) > KOI.MAX_OFF) f.targetHeading = f.heading + Math.sign(dd0) * KOI.MAX_OFF;
      const step = KOI.TURN_OMEGA * dt;
      f.heading += Math.max(-step, Math.min(step, kAngDiff(f.heading, f.targetHeading)));
      // deceleration zone: ramp from DRIFT (far off-screen) -> CRAWL (well inside)
      // so the slow-down begins before the fish becomes visible, not the moment
      // its head crosses the edge.
      const DECEL_OUTER = 400;   // px outside viewport where decel begins
      const DECEL_INNER = 60;    // px inside viewport where decel completes
      const distOutside = Math.max(0, -f.x, f.x - W, -f.y, f.y - H);
      const distInside = Math.max(0, Math.min(f.x, W - f.x, f.y, H - f.y));
      let zone;                  // 0 = outer (full drift), 1 = inner (full crawl)
      if (distOutside > 0) zone = 1 - Math.min(1, distOutside / DECEL_OUTER);
      else zone = Math.min(1, distInside / DECEL_INNER) * 0.5 + 0.5;
      const tgtSpeed = KOI.DRIFT + (KOI.CRAWL - KOI.DRIFT) * zone;
      f.speed += (tgtSpeed - f.speed) * Math.min(1, dt * 0.6);
      f.x += Math.cos(f.heading) * f.speed * dt;
      f.y += Math.sin(f.heading) * f.speed * dt;
      f.trail.unshift({ x: f.x, y: f.y });
      kCapByLength(f.trail, f.len * 2.0);
      let need = f.len * 1.8, have = kTrailLength(f.trail);
      if (have < need) {
        const tail = f.trail[f.trail.length - 1], prev = f.trail[f.trail.length - 2] || { x: tail.x - Math.cos(f.heading), y: tail.y - Math.sin(f.heading) };
        let ex = tail.x - prev.x, ey = tail.y - prev.y; const el = Math.hypot(ex, ey) || 1e-4; ex /= el; ey /= el;
        while (have < need) { f.trail.push({ x: f.trail[f.trail.length - 1].x + ex * 3, y: f.trail[f.trail.length - 1].y + ey * 3 }); have += 3; }
      }
      const M = f.len * 2.2;
      if (f.x < -M || f.x > W + M || f.y < -M || f.y > H + M) {
        const p = koiSpawnPlacement(f.len);
        f.x = p.x; f.y = p.y; f.heading = p.heading; f.targetHeading = p.heading; f.speed = KOI.DRIFT; f.turnTimer = krand(2, 5);
        const t = pickScheme();
        f.tex = t.tex; f.scheme = t.scheme; f.uvOff = krand(0, 1);
        f.trail = []; const n2 = f.len * 2.0; for (let d = 0; d < n2; d += 3) f.trail.push({ x: f.x - Math.cos(f.heading) * d, y: f.y - Math.sin(f.heading) * d });
      }
      f.tailPhase += 0.9 * dt * KOI.TWO_PI * 0.3;
      f.texPhase += 0.6 * dt;
    }
  }
  function kSampleTrail(tr, dist) { let acc = 0; for (let i = 1; i < tr.length; i++) { const a = tr[i - 1], b = tr[i]; const seg = Math.hypot(b.x - a.x, b.y - a.y); if (acc + seg >= dist) { const t = (dist - acc) / (seg || 1e-4); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; } acc += seg; } return { x: tr[tr.length - 1].x, y: tr[tr.length - 1].y }; }
  const PEC_U = 0.15, PELV_U = 0.40, DORSAL_U0 = 0.18, DORSAL_U1 = 0.62, WAIST = 0.55, TOE_U = 0.62, BODYSPAN = 1.7, WIDTH_MULT = 0.111, NOSE_FRAC = 0.45;
  function kProfileWidth(L, u) {
    let wBody; const HEAD_END = 0.08, PLATEAU_END = 0.14;
    if (u < HEAD_END) { const t = u / HEAD_END; wBody = NOSE_FRAC + (1.12 - NOSE_FRAC) * Math.pow(t, 0.5); }
    else if (u < PLATEAU_END) { wBody = 1.12; }
    else if (u < 0.50) { wBody = 1.12 * Math.pow(1 - (u - PLATEAU_END) / (0.50 - PLATEAU_END + 0.55), 0.85); }
    else if (u < 0.62) { const t = (u - 0.50) / 0.12; const trunkEnd = 1.12 * Math.pow(1 - (0.50 - PLATEAU_END) / (0.50 - PLATEAU_END + 0.55), 0.85); wBody = trunkEnd * (1 - t) + 0.30 * t; }
    else { const tv = (u - 0.62) / 0.38; const fan = Math.sin(Math.min(1, tv * 1.1) * Math.PI) * 0.62; wBody = 0.30 * (1 - tv * 0.6) + fan; }
    return Math.max(wBody, 0.04) * L * WIDTH_MULT;
  }
  function kSmoothClosed(P) { ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); const n = P.length; for (let i = 0; i < n; i++) { const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n]; ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y); } ctx.closePath(); }
  function kWaveFin(f, L, ox, oy, nx, ny, backx, backy, side, reach, wide, phaseOff) {
    const MM = 10, cl = [], half = [];
    for (let i = 0; i <= MM; i++) {
      const s = i / MM;
      const out = reach * Math.sin(s * Math.PI * 0.6), back = reach * 0.9 * Math.pow(s, 1.0);
      const billow = Math.sin(f.tailPhase - s * 3.0 + phaseOff) * Math.pow(s, 1.8) * L * 0.05;
      cl.push({ x: ox + nx * (out * side) + backx * back + nx * billow, y: oy + ny * (out * side) + backy * back + ny * billow });
      half.push(wide * Math.pow(1 - s, 1.1) * Math.min(1, s * 3) + 0.4);
    }
    kDrawRibbon(f, cl, half);
  }
  function kTailToe(f, L, ox, oy, axx, axy, splay, reach, wide) {
    const ca = Math.cos(splay), sa = Math.sin(splay), dx = axx * ca - axy * sa, dy = axx * sa + axy * ca;
    const MM = 10, cl = [], half = [];
    for (let i = 0; i <= MM; i++) { const s = i / MM, along = reach * s; cl.push({ x: ox + dx * along, y: oy + dy * along }); half.push(wide * Math.pow(1 - s, 1.15) * Math.min(1, s * 3) + 0.4); }
    kDrawRibbon(f, cl, half);
  }
  function kDrawRibbon(f, cl, half) {
    const hot = f.scheme.hot, mid = f.scheme.mid, MM = cl.length - 1, Lp = [], Rp = [];
    for (let i = 0; i <= MM; i++) {
      const a = cl[Math.max(0, i - 1)], b = cl[Math.min(MM, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1e-4, px = -dy / len, py = dx / len;
      Lp.push({ x: cl[i].x + px * half[i], y: cl[i].y + py * half[i] }); Rp.push({ x: cl[i].x - px * half[i], y: cl[i].y - py * half[i] });
    }
    const loop = []; for (let i = 0; i <= MM; i++) loop.push(Lp[i]); for (let i = MM; i >= 0; i--) loop.push(Rp[i]);
    ctx.save(); kSmoothClosed(loop); ctx.fillStyle = `rgba(${mid[0]},${mid[1]},${mid[2]},0.25)`; ctx.fill(); ctx.restore();
    ctx.shadowColor = `rgba(${hot[0]},${hot[1]},${hot[2]},0.8)`; ctx.shadowBlur = 6;
    ctx.strokeStyle = `rgba(${hot[0]},${hot[1]},${hot[2]},0.9)`; ctx.lineWidth = 1.1; kSmoothClosed(loop); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(${hot[0]},${hot[1]},${hot[2]},0.35)`; ctx.lineWidth = 0.6;
    for (const fr of [-0.5, 0, 0.5]) {
      const ln = []; for (let i = 0; i <= MM; i++) ln.push({ x: Lp[i].x * (0.5 + fr * 0.5) + Rp[i].x * (0.5 - fr * 0.5), y: Lp[i].y * (0.5 + fr * 0.5) + Rp[i].y * (0.5 - fr * 0.5) });
      ctx.beginPath(); ctx.moveTo(ln[0].x, ln[0].y); for (let i = 1; i < ln.length; i++) ctx.lineTo(ln[i].x, ln[i].y); ctx.stroke();
    }
  }
  function drawMetallicBody(f, centre, left, right) {
    const SEG = KOI.SEG, sh = KOI.SHINE, tex = f.tex;
    const hull = []; hull.push(left[0]); for (let i = 1; i < SEG; i++) hull.push(left[i]);
    hull.push({ x: centre[SEG].x, y: centre[SEG].y });
    for (let i = SEG - 1; i >= 1; i--) hull.push(right[i]);
    hull.push(right[0]);
    ctx.save(); kSmoothClosed(hull); ctx.clip();
    // body translucent so wires/electrons/vias glimmer through; highlights below
    // run at full alpha so the specular sweep and rim still pop.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = krgb(f.scheme.base, 1); ctx.fill();
    for (let i = 0; i < SEG; i++) {
      const c0 = centre[i], c1 = centre[i + 1];
      const dx = c1.x - c0.x, dy = c1.y - c0.y, len = Math.hypot(dx, dy) || 1e-4, ang = Math.atan2(dy, dx);
      const halfW = Math.max(c0.hw, c1.hw) * 1.05;
      const tu = (i / SEG + f.uvOff) * 1.4, su = KTEX_SIZE * 0.20, sv = KTEX_SIZE * 0.6;
      const sx = (tu * KTEX_SIZE) % (KTEX_SIZE - su), sy = (f.uvOff * KTEX_SIZE * 0.5) % (KTEX_SIZE - sv);
      ctx.save(); ctx.translate(c0.x, c0.y); ctx.rotate(ang); ctx.globalAlpha = 0.55 * 0.95;
      ctx.drawImage(tex, sx, sy, su, sv, 0, -halfW, len + 1, halfW * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < SEG; i++) {
      const u = i / SEG;
      const sweepU = (f.texPhase * 0.15 + 0.2) % 1.2 - 0.1;
      const distU = Math.abs(u - sweepU);
      const sweep = Math.exp(-distU * distU * 22);
      const ambient = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.05) / 0.85))) * 0.45;
      const intensity = (ambient + sweep * 0.9) * sh;
      if (intensity < 0.02) continue;
      const c0 = centre[i], c1 = centre[i + 1];
      const lw = Math.min(c0.hw, c1.hw) * 0.55;
      const hot = f.scheme.hot;
      ctx.strokeStyle = `rgba(${hot[0]},${hot[1]},${hot[2]},${Math.min(1, intensity)})`;
      ctx.lineWidth = lw; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.stroke();
    }
    ctx.lineWidth = 1.2;
    const hot = f.scheme.hot;
    ctx.strokeStyle = `rgba(${hot[0]},${hot[1]},${hot[2]},${0.4 * sh})`;
    kSmoothClosed(hull); ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
  function drawKoi(f) {
    const L = f.len, span = L * BODYSPAN, SEG = KOI.SEG;
    const spine = [];
    for (let i = 0; i <= SEG; i++) { const u = i / SEG, p = kSampleTrail(f.trail, u * span); spine.push({ x: p.x, y: p.y, u }); }
    function nodeNormal(i) { const a = spine[Math.max(0, i - 1)], b = spine[Math.min(SEG, i + 1)]; const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1e-4; return { nx: -dy / len, ny: dx / len, tx: dx / len, ty: dy / len }; }
    const left = [], right = [], centre = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, nrm = nodeNormal(i);
      let lat = 0;
      if (u > WAIST) { const tv = (u - WAIST) / (1 - WAIST); lat = Math.sin(f.tailPhase - tv * 3.0) * Math.pow(tv, 1.6) * L * 0.11; }
      const cx = spine[i].x + nrm.nx * lat, cy = spine[i].y + nrm.ny * lat, w = kProfileWidth(L, u);
      left.push({ x: cx + nrm.nx * w, y: cy + nrm.ny * w }); right.push({ x: cx - nrm.nx * w, y: cy - nrm.ny * w });
      centre.push({ x: cx, y: cy, hw: w, nx: nrm.nx, ny: nrm.ny, tx: nrm.tx, ty: nrm.ty, u });
    }
    const ti = Math.round(TOE_U * SEG), toeNode = centre[ti];
    const ta = centre[Math.max(0, ti - 1)], tb = centre[Math.min(SEG, ti + 1)];
    let wtx = tb.x - ta.x, wty = tb.y - ta.y; const wtl = Math.hypot(wtx, wty) || 1e-4; wtx /= wtl; wty /= wtl;
    const DEG30 = Math.PI / 6;
    kTailToe(f, L, toeNode.x, toeNode.y, wtx, wty, +DEG30, L * 0.55, L * 0.05);
    kTailToe(f, L, toeNode.x, toeNode.y, wtx, wty, -DEG30, L * 0.55, L * 0.05);
    drawMetallicBody(f, centre, left, right);
    ctx.save();
    const hull = []; hull.push(left[0]); for (let i = 1; i < SEG; i++) hull.push(left[i]);
    hull.push({ x: spine[SEG].x, y: spine[SEG].y });
    for (let i = SEG - 1; i >= 1; i--) hull.push(right[i]);
    hull.push(right[0]);
    kSmoothClosed(hull); ctx.clip();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 0.7;
    for (let i = 2; i < SEG - 1; i++) { ctx.beginPath(); ctx.moveTo(left[i].x, left[i].y); ctx.lineTo(right[i].x, right[i].y); ctx.stroke(); }
    ctx.restore();
    {
      const hot = f.scheme.hot, mid = f.scheme.mid;
      const i0 = Math.round(DORSAL_U0 * SEG), i1 = Math.round(DORSAL_U1 * SEG), dpts = [];
      for (let i = i0; i <= i1; i++) { const c = centre[i], t = (i - i0) / (i1 - i0); const envelope = Math.pow(Math.sin(t * Math.PI), 0.7), ripple = 0.85 + 0.15 * Math.sin(f.tailPhase * 1.3 - t * 6.0), h = envelope * ripple * L * 0.075; dpts.push({ x: c.x + c.nx * h, y: c.y + c.ny * h }); }
      const sail = []; for (let i = i0; i <= i1; i++) { const c = centre[i]; sail.push({ x: c.x, y: c.y }); }
      for (let k = dpts.length - 1; k >= 0; k--) sail.push(dpts[k]);
      ctx.fillStyle = `rgba(${mid[0]},${mid[1]},${mid[2]},0.4)`; kSmoothClosed(sail); ctx.fill();
      ctx.shadowColor = `rgba(${hot[0]},${hot[1]},${hot[2]},0.7)`; ctx.shadowBlur = 5;
      ctx.strokeStyle = `rgba(${hot[0]},${hot[1]},${hot[2]},0.9)`; ctx.lineWidth = 1.1; kSmoothClosed(sail); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    const an = centre[Math.round(PEC_U * SEG)];
    for (const s of [-1, 1]) { const ox = an.x + an.nx * an.hw * 0.9 * s, oy = an.y + an.ny * an.hw * 0.9 * s; kWaveFin(f, L, ox, oy, an.nx, an.ny, an.tx, an.ty, s, L * 0.26, L * 0.085, s > 0 ? 0 : 1.0); }
    const pn = centre[Math.round(PELV_U * SEG)];
    for (const s of [-1, 1]) { const ox = pn.x + pn.nx * pn.hw * 0.9 * s, oy = pn.y + pn.ny * pn.hw * 0.9 * s; kWaveFin(f, L, ox, oy, pn.nx, pn.ny, pn.tx, pn.ty, s, L * 0.18, L * 0.06, s > 0 ? 0.5 : 1.5); }
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1.2;
    const en = centre[Math.max(1, Math.round(0.07 * SEG))];
    for (const s of [-1, 1]) { const ex = en.x + en.nx * en.hw * 0.7 * s, ey = en.y + en.ny * en.hw * 0.7 * s; const ang = Math.atan2(en.ny * s, en.nx * s); ctx.beginPath(); ctx.arc(ex, ey, L * 0.022, ang - 1.0, ang + 1.0); ctx.stroke(); }
    ctx.shadowBlur = 0;
  }

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 1);
    W = innerWidth; H = innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    cache.width = W * DPR; cache.height = H * DPR;
    build();
    buildCache();
    startSheen();
  }

  // ripple energy pushed in from the water layer each frame: a flat array of
  // [px, py, energy] triples in circuit-pixel space (px,py = impact center,
  // energy = freshness 0..1). Electrons near a fresh ripple shine iridescently.
  let ripples = [];
  function setRipples(arr) { ripples = arr; }
  const RIPPLE_REACH = 220;            // px radius of influence
  function rippleEnergyAt(x, y) {
    let m = 0;
    for (let i = 0; i < ripples.length; i += 3) {
      const energy = ripples[i + 2];
      if (energy <= 0) continue;
      const dx = x - ripples[i], dy = y - ripples[i + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 > RIPPLE_REACH * RIPPLE_REACH) continue;
      const prox = 1 - Math.sqrt(d2) / RIPPLE_REACH;   // 1 at center -> 0 at reach
      const e = prox * energy;
      if (e > m) m = e;
    }
    return m;
  }

  resize();
  return { canvas, render, resize, live, setRipples };
})();

(function () {
  const cv = canvas;
  const IS_TOUCH = window.__IS_TOUCH;
  const live = { intensity: 0.15, surge: false };
  window.__board = live;
  const C2D = window.Circuit2D;

  // ---- MOBILE PATH: skip WebGL water entirely. Blit the 2D circuit direct to
  // the visible canvas. Traces/electrons/koi/sheen still animate; no refraction,
  // no rain ripples, no caustics — the water shader is the dominant mobile cost.
  if (IS_TOUCH) {
    // dial down: fewer electrons per frame, fewer koi (visual load is 2D-driven
    // now that WebGL isn't compressing pixel work).
    if (window.__mobile_tune) window.__mobile_tune();  // hook, no-op if unset
    const c2 = cv.getContext("2d");
    if (!c2 || !C2D) { if (c2) { c2.fillStyle = "#020507"; c2.fillRect(0, 0, cv.width, cv.height); } return; }
    function mResize() {
      cv.width = innerWidth;
      cv.height = innerHeight;
      C2D.resize();
    }
    window.addEventListener("resize", mResize);
    teardown.push(() => window.removeEventListener("resize", mResize));
    mResize();
    let last = performance.now();
    function mFrame(now) {
      if (stopped) return;
      const t = now / 1000;
      C2D.live.intensity = live.intensity;
      C2D.live.surge = live.surge;
      C2D.render(t);
      c2.drawImage(C2D.canvas, 0, 0, cv.width, cv.height);
      requestAnimationFrame(mFrame);
    }
    requestAnimationFrame(mFrame);
    return;
  }

  // ---- DESKTOP PATH: full WebGL water below ----
  const gl = cv.getContext("webgl", { premultipliedAlpha: false, antialias: true });
  teardown.push(() => { try { const e = gl && gl.getExtension && gl.getExtension("WEBGL_lose_context"); e && e.loseContext(); } catch (_e) {} });
  if (!gl || !C2D) {
    const c2 = cv.getContext("2d");
    if (c2) { c2.fillStyle = "#020507"; c2.fillRect(0, 0, cv.width, cv.height); }
    return;
  }

  const VERT = `
    attribute vec2 p;
    varying vec2 vUv;
    void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }
  `;

  // The floor is now the real 2D circuit, sampled as a texture and refracted by
  // the animated water surface. Caustics (from surface curvature) brighten it,
  // Fresnel adds a surface sheen, shallow teal tint for the water body.
  const FRAG = `
    precision highp float;
    uniform vec2  uRes;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uSurge;
    uniform sampler2D uFloor;     // the 2D circuit canvas
    uniform vec3  uDrops[20];      // xy = impact point (wave space), z = age (s); z<0 = inactive
    varying vec2 vUv;

    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
      vec2 u=f*f*(3.-2.*f);
      return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
    }
    float fbm(vec2 p){ float v=0.,a=0.5; for(int i=0;i<4;i++){v+=a*vnoise(p);p*=2.;a*=0.5;} return v; }

    // rain ripple: several trailing concentric wavefronts expanding from impact,
    // expressed purely as surface HEIGHT (so it shows through refraction of the
    // circuit, not as a drawn ring). Multiple crests + capillary detail read as
    // water rather than a single clean circle.
    float rainH(vec2 p){
      float h = 0.0;
      for(int i=0;i<20;i++){
        vec3 d = uDrops[i];
        if(d.z < 0.0) continue;
        float dist = distance(p, d.xy);
        float speed = 2.4;                       // expansion speed (slower = heavier water)
        float radius = d.z * speed;
        float ring = dist - radius;              // 0 on the leading front
        // train of crests TRAILING the front (only behind it, ring<=0), with
        // higher spatial frequency near the front and decaying inward
        float train = sin(ring * 7.0) * exp(ring * 1.2);   // exp(ring) decays for ring<0
        float front = smoothstep(0.5, -0.2, ring);          // gate to behind-the-front
        float life = exp(-d.z * 1.6);
        h += train * front * life * 0.22;        // lower amplitude (was 0.5); radius unchanged
      }
      return h;
    }

    float waterH(vec2 p, float t){
      float h = 0.0;
      // current flows left -> right: subtracting from x scrolls features in +x
      h += sin(p.x*0.7 - t*0.5)*0.32;                 // travelling wave moving right
      h += sin(p.y*0.8 - t*0.05 + 1.3)*0.22;          // gentle cross-chop, mostly static
      h += fbm(p*0.45 - vec2(t*0.18, t*0.01))*0.9;    // broad swell drifting right
      h += fbm(p*1.1  - vec2(t*0.26, -t*0.01))*0.26;  // ripples drifting right
      h += fbm(p*3.2  - vec2(t*0.34, 0.0))*0.10;      // fine capillary streaming right
      h += rainH(p);                                  // rain impact ripples
      return h;
    }

    void main(){
      vec2 px = gl_FragCoord.xy;
      vec2 uv = vUv;
      float t = uTime;
      float surge = uSurge;
      float flow = 1.0 + surge*0.5;                   // even a sync barely stirs it

      vec2 wp = uv * vec2(uRes.x/uRes.y, 1.0) * 5.0;   // larger, lazier features
      float e = 0.025;                                 // finer step -> captures ripple crests
      float h  = waterH(wp, t*flow);
      float hx = waterH(wp+vec2(e,0.), t*flow);
      float hy = waterH(wp+vec2(0.,e), t*flow);
      vec2 slope = vec2(hx-h, hy-h)/e;
      vec3 N = normalize(vec3(-slope*0.10, 1.0));

      // refraction: displace the texture lookup by the surface slope. Ripples
      // bend the circuit beneath — this is what reads as "through water".
      float depthPx = 14.0 + surge*4.0;
      vec2 disp = slope * depthPx / uRes;        // in uv space
      // flip Y: canvas texture origin is top-left, gl uv is bottom-left
      vec2 fuv = vec2(uv.x, 1.0 - uv.y) - vec2(disp.x, -disp.y);
      vec3 floorCol = texture2D(uFloor, fuv).rgb;

      // caustics from surface curvature (laplacian of height)
      float hxp=waterH(wp+vec2(e,0.),t*flow), hxm=waterH(wp-vec2(e,0.),t*flow);
      float hyp=waterH(wp+vec2(0.,e),t*flow), hym=waterH(wp-vec2(0.,e),t*flow);
      float lap = (hxp+hxm+hyp+hym - 4.0*h)/(e*e);
      float caustic = pow(max(0.0, -lap*0.02), 2.2);
      caustic *= (0.6 + 0.8*uIntensity) * (1.0 + surge*0.8);
      caustic = clamp(caustic, 0.0, 1.3);

      vec3 col = floorCol;
      col += floorCol * caustic * 0.8;                     // caustics brighten the circuit
      col += vec3(0.55,0.78,0.85) * caustic * 0.18;        // cooler, fainter light filaments

      // faint drifting murk so the water still reads as a medium (no light-gather)
      float murk = fbm(wp*0.5 + vec2(t*0.06, -t*0.04)) * fbm(wp*1.3 - vec2(t*0.03));
      col += vec3(0.02,0.06,0.05) * murk * 0.4;            // subtle particulate haze

      // plain dim Fresnel surface sheen
      float fres = pow(1.0 - N.z, 3.0);
      col += vec3(0.08,0.13,0.14) * fres * 0.5;

      // depth darkening toward black at the bottom of the frame
      col *= mix(1.0, 0.78, (1.0 - uv.y));

      float vig = smoothstep(1.3, 0.4, length(uv-0.5));
      col *= mix(0.62, 1.0, vig);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "uRes");
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uIntensity = gl.getUniformLocation(prog, "uIntensity");
  const uSurge = gl.getUniformLocation(prog, "uSurge");
  const uFloor = gl.getUniformLocation(prog, "uFloor");
  const uDrops = gl.getUniformLocation(prog, "uDrops");

  // --- rain: a pool of impact ripples. Each drop is [x, y, age]; age<0 = free.
  // Positions are in the shader's wave space (uv * vec2(aspect,1) * 5.0).
  const NDROPS = 20;
  const drops = new Float32Array(NDROPS * 3);
  for (let i = 0; i < NDROPS; i++) drops[i * 3 + 2] = -1; // all inactive
  let rainRate = 0.25;          // drops per second
  let rainAcc = 0;
  let lastT = 0;
  function aspect() { return cv.width / cv.height; }
  function spawnDrop() {
    for (let i = 0; i < NDROPS; i++) {
      if (drops[i * 3 + 2] < 0) {
        drops[i * 3 + 0] = Math.random() * 5 * aspect();
        drops[i * 3 + 1] = Math.random() * 5;
        drops[i * 3 + 2] = 0;
        return;
      }
    }
  }

  // texture backed by the 2D circuit canvas
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.uniform1i(uFloor, 0);

  let surgeSmooth = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
    gl.viewport(0, 0, cv.width, cv.height);
    C2D.resize();
  }
  resize();
  window.addEventListener("resize", resize);
  teardown.push(() => window.removeEventListener("resize", resize));

  const start = performance.now();
  function frame() {
    if (stopped) return;
    const t = (performance.now() - start) / 1000;
    const dt = Math.min(0.05, t - lastT); lastT = t;
    // drive the 2D circuit from the same live state, then render it offscreen
    C2D.live.intensity = live.intensity;
    C2D.live.surge = live.surge;

    surgeSmooth += ((live.surge ? 1 : 0) - surgeSmooth) * 0.05;

    // age drops; retire when fully faded (~2s); spawn new ones at the rain rate.
    // Done BEFORE C2D.render so the electrons read this frame's ripple energy.
    const rip = [];
    for (let i = 0; i < NDROPS; i++) {
      if (drops[i * 3 + 2] >= 0) {
        drops[i * 3 + 2] += dt;
        const age = drops[i * 3 + 2];
        if (age > 2.0) { drops[i * 3 + 2] = -1; continue; }
        // freshness: peaks just after impact, fades over ~1s — this is the
        // "ripple energy" pulse, derived from the SAME age the shader uses.
        const fresh = Math.max(0, 1 - age / 1.0);
        if (fresh > 0) {
          // wave-space -> uv -> circuit px (uv.y is gl bottom-origin; flip)
          const u = drops[i * 3 + 0] / (5 * aspect());
          const v = drops[i * 3 + 1] / 5;
          rip.push(u * innerWidth, (1 - v) * innerHeight, fresh);
        }
      }
    }
    C2D.setRipples(rip);
    rainAcc += dt * (rainRate * (1 + surgeSmooth * 1.5)); // rain harder on surge
    while (rainAcc >= 1) { spawnDrop(); rainAcc -= 1; }

    C2D.render(t);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, C2D.canvas);

    gl.uniform2f(uRes, cv.width, cv.height);
    gl.uniform1f(uTime, t);
    gl.uniform1f(uIntensity, live.intensity);
    gl.uniform1f(uSurge, surgeSmooth);
    gl.uniform3fv(uDrops, drops);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }
  frame();
})();

  return {
    setLive(intensity, surge) {
      if (win.__board) { win.__board.intensity = intensity; win.__board.surge = surge; }
    },
    destroy() {
      stopped = true;
      for (const fn of teardown) { try { fn(); } catch (_e) {} }
    },
  };
}
