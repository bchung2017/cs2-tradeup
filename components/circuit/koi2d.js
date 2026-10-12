// Metallic top-down koi, shared by the circuit background (circuitKoi.js) and
// the Lounge's 3D pond (lounge3d.ts). Moved out of circuitKoi.js unchanged:
// the school swims in pixel space over a W x H field and draws into whatever
// 2D context it's handed each frame.

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
// A scheme's smoke texture, filled band by band: `bands` yields after each
// band of rows (the async maker waits a frame there), the plain call runs it
// straight through.
function makeSmokeTexture(sc, size) {
  const it = smokeBands(sc, size, 1);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
function* smokeBands(sc, size, bands) {
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
  const per = Math.ceil(size / bands);
  for (let y = 0; y < size; y++) {
    if (y > 0 && y % per === 0) yield;
    for (let x = 0; x < size; x++) {
    const wx = fbm(x * 0.012 + 13.7, y * 0.012 + 9.1);
    const wy = fbm(x * 0.012 - 4.3, y * 0.012 + 22.5);
    const v = fbm(x * 0.018 + wx * 3.0, y * 0.018 + wy * 3.0);
    const t = Math.min(1, Math.max(0, (v - 0.30) / 0.55));
    const col = mix3(sc.base, sc.mid, sc.hot, t);
    const i = (y * size + x) * 4;
    data[i] = col[0] | 0; data[i + 1] = col[1] | 0; data[i + 2] = col[2] | 0; data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return off;
}
const KTEX_SIZE = 256;

// Every scheme's smoke texture, one per call to `step` (pass a function that
// waits, e.g. for the next frame), so making them never blocks for long.
export async function makeKoiTexturesAsync(step) {
  const out = [];
  const BANDS = 4;
  for (const s of KSCHEMES) {
    const it = smokeBands(s, KTEX_SIZE, BANDS);
    let r = it.next(), band = 0;
    while (!r.done) {
      band++;
      await step((out.length + band / BANDS) / KSCHEMES.length);
      r = it.next();
    }
    out.push({ scheme: s, tex: r.value });
  }
  await step(1);
  return out;
}

export function createKoiSchool(textures) {
  let ctx = null;
  let W = 0, H = 0;

  // ---- metallic top-down koi (adapted from upload) ------------------------
  // Smoke-textured metallic body with a moving specular sweep + rim light, colored
  // fins. Live in circuit-pixel space, drawn into ctx, refracted by the water.
  // No pointer/sliders: count fixed, shine fixed; tail+spec animate on their own.
  const KOI = { TWO_PI: Math.PI * 2, SEG: 20, CRAWL: 7, DRIFT: 64, MAX_OFF: Math.PI / 18, TURN_OMEGA: 0.09, get COUNT() { return window.__IS_TOUCH ? 2 : 4; }, SHINE: 1.0 };
  const krand = (a, b) => a + Math.random() * (b - a);

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
  // the smoke textures are the costly part; a caller can make them ahead of
  // time, a step at a time (makeKoiTexturesAsync), and hand them in
  const ktextures = textures ?? KSCHEMES.map(s => ({ scheme: s, tex: makeSmokeTexture(s, KTEX_SIZE) }));

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

  return {
    // the field the fish swim in, in pixels
    setSize(w, h) { W = w; H = h; },
    // advance the school to time `tnow` (seconds) without drawing, e.g. to have
    // the fish already in the water when a scene first appears
    advance(tnow) { updateKoi(tnow); },
    // advance the school to time `tnow` (seconds) and draw it into `c`
    frame(c, tnow) {
      ctx = c;
      updateKoi(tnow);
      for (const f of koi) drawKoi(f);
    },
  };
}
