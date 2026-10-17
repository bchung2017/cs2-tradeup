// The cave behind the waterfall, for the homepage intro: a low-poly cavern
// with still water, and across it a rock ledge where the week's three biggest
// knife jackpots stand in stones, tips down, hilts up, glowing in their
// finish's colour (Excalibur-style). Unlike the Lounge's baked scenery it is
// lit by real lights, which only these materials use.
//
// Each knife is made from its Steam picture: the outline traced from the
// alpha (marching squares), extruded into a thin slab with the picture on
// both faces. The tip and the point where blade meets handle are found from
// the paint: the finish is saturated colour, handles mostly aren't.
import * as THREE from "three";

export interface IntroKnife {
  name: string; // "★ Karambit | Doppler"
  phase: string | null;
  wear: string;
  value: number;
  probability: number;
  image: string; // same-origin URL (WebGL needs to read the pixels)
}

export interface Cave {
  group: THREE.Group;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  // where the camera is and looks, `t` seconds after entering the cave
  pose(t: number, aspect: number, fovDeg: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  readonly closeUpAt: number; // seconds after entering when the close-up settles
  update(time: number, camera: THREE.Vector3): void;
  dispose(): void;
}

const GLIDE = 4.5; // across the water
const CLOSE = 4.0; // into the close-up
const LEDGE_Z = -6; // the knives' row
const LEDGE_TOP = 1.0;
const STONE_TOP = 1.9;
const EMBED = 0.35; // share of each blade inside its stone

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

// one colour per facet, for the low-poly look
function facetColors(geo: THREE.BufferGeometry, colorAt: (x: number, y: number, z: number) => THREE.Color) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let f = 0; f < p.count; f += 3) {
    const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3, cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
    const c = colorAt(cx, cy, cz);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
}
// jitter a geometry's corners (shared corners move together, so no cracks)
function roughen(geo: THREE.BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]) {
  const p = geo.attributes.position, moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!moved.has(k)) moved.set(k, f(p.getX(i), p.getY(i), p.getZ(i)));
    const [x, y, z] = moved.get(k)!;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
}

// ── reading a knife picture ─────────────────────────────────────────────────
interface Reading {
  IW: number; IH: number; STEP: number; GW: number; GH: number;
  inside(x: number, y: number): boolean;
  tip: [number, number]; base: [number, number]; lenPx: number;
  paint: THREE.Color; // the finish's average colour
}
function read(img: HTMLImageElement): Reading {
  const IW = img.width, IH = img.height, STEP = 2, GW = Math.floor(IW / STEP), GH = Math.floor(IH / STEP);
  const cv = document.createElement("canvas");
  cv.width = IW; cv.height = IH;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, IW, IH).data;
  const op = new Uint8Array(GW * GH), sat = new Uint8Array(GW * GH);
  let pr = 0, pg = 0, pb = 0, pn = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const o = (y * STEP * IW + x * STEP) * 4;
    if (px[o + 3] <= 128) continue;
    op[y * GW + x] = 1;
    const mx = Math.max(px[o], px[o + 1], px[o + 2]), mn = Math.min(px[o], px[o + 1], px[o + 2]);
    if (mx - mn > 45 && mx > 60) { sat[y * GW + x] = 1; pr += px[o]; pg += px[o + 1]; pb += px[o + 2]; pn++; }
  }
  // the knife: the largest blob (one of a pair of daggers)
  const lab = new Int32Array(GW * GH);
  let best = 0, bestN = 0, id = 0;
  for (let i = 0; i < op.length; i++) {
    if (!op[i] || lab[i]) continue;
    id++;
    let n = 0;
    const stack = [i];
    lab[i] = id;
    while (stack.length) {
      const j = stack.pop()!, x = j % GW, y = (j - x) / GW;
      n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const k = ny * GW + nx;
        if (op[k] && !lab[k]) { lab[k] = id; stack.push(k); }
      }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < GW && y < GH && lab[y * GW + x] === best;
  // its long axis, from the blob's spread
  const pts: [number, number, number][] = [];
  let mx = 0, my = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (inside(x, y)) { pts.push([x, y, sat[y * GW + x]]); mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const [x, y] of pts) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ax = Math.cos(th), ay = Math.sin(th);
  let pmin = Infinity, pmax = -Infinity;
  for (const [x, y] of pts) { const p = x * ax + y * ay; pmin = Math.min(pmin, p); pmax = Math.max(pmax, p); }
  const NB = 50, cnt = new Array(NB).fill(0), sc = new Array(NB).fill(0), sx = new Array(NB).fill(0), sy = new Array(NB).fill(0);
  for (const [x, y, s] of pts) {
    const k = Math.min(NB - 1, Math.floor(((x * ax + y * ay - pmin) / (pmax - pmin || 1)) * NB));
    cnt[k]++; sc[k] += s; sx[k] += x; sy[k] += y;
  }
  const frac = (a: number, b: number) => { let n = 0, s = 0; for (let k = a; k < b; k++) { n += cnt[k]; s += sc[k]; } return n ? s / n : 0; };
  // the tip is the more painted end; the blade runs from it while the paint holds
  const tipAtMin = frac(0, 8) >= frac(NB - 8, NB);
  const order = [...Array(NB).keys()];
  if (!tipAtMin) order.reverse();
  let tip: [number, number] = [0, 0], ext = tipAtMin ? Infinity : -Infinity;
  for (const [x, y] of pts) { const p = x * ax + y * ay; if (tipAtMin ? p < ext : p > ext) { ext = p; tip = [x, y]; } }
  let j = Math.round(NB * 0.65);
  for (let k = Math.round(NB * 0.2); k < Math.round(NB * 0.65); k++) {
    const b = order[k];
    if (cnt[b] && sc[b] / cnt[b] < 0.3) { j = k; break; }
  }
  const jb = order[Math.max(0, j - 1)];
  const paint = pn ? new THREE.Color().setRGB(pr / pn / 255, pg / pn / 255, pb / pn / 255, THREE.SRGBColorSpace) : new THREE.Color(0x3a64ff);
  return {
    IW, IH, STEP, GW, GH, inside,
    tip: [tip[0] * STEP, tip[1] * STEP],
    base: [(sx[jb] / (cnt[jb] || 1)) * STEP, (sy[jb] / (cnt[jb] || 1)) * STEP],
    lenPx: (pmax - pmin) * STEP,
    paint,
  };
}

// the outline as polygons (grid units): the outer edge and any holes
function outline(r: Reading) {
  type V = [number, number];
  const segs: [V, V][] = [];
  for (let y = -1; y < r.GH; y++) for (let x = -1; x < r.GW; x++) {
    const c = (r.inside(x, y) ? 1 : 0) | (r.inside(x + 1, y) ? 2 : 0) | (r.inside(x + 1, y + 1) ? 4 : 0) | (r.inside(x, y + 1) ? 8 : 0);
    const T: V = [x + 0.5, y], R: V = [x + 1, y + 0.5], B: V = [x + 0.5, y + 1], L: V = [x, y + 0.5];
    const table: Record<number, [V, V][]> = { 1: [[L, T]], 2: [[T, R]], 3: [[L, R]], 4: [[R, B]], 5: [[L, T], [R, B]], 6: [[T, B]], 7: [[L, B]],
      8: [[B, L]], 9: [[T, B]], 10: [[T, R], [B, L]], 11: [[R, B]], 12: [[R, L]], 13: [[T, R]], 14: [[L, T]] };
    for (const s of table[c] ?? []) segs.push(s);
  }
  const keyOf = (p: V) => `${p[0]},${p[1]}`;
  const adj = new Map<string, number[]>();
  segs.forEach((s, i) => { for (const p of s) { const k = keyOf(p); if (!adj.has(k)) adj.set(k, []); adj.get(k)!.push(i); } });
  const used = new Uint8Array(segs.length), loops: V[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop: V[] = [segs[i][0]];
    let cur = segs[i][1];
    while (keyOf(cur) !== keyOf(loop[0])) {
      loop.push(cur);
      const next = (adj.get(keyOf(cur)) ?? []).find((n) => !used[n]);
      if (next === undefined) break;
      used[next] = 1;
      cur = keyOf(segs[next][0]) === keyOf(cur) ? segs[next][1] : segs[next][0];
    }
    if (loop.length > 8) loops.push(loop);
  }
  const simplify = (pts: V[], eps: number): V[] => {
    if (pts.length < 3) return pts;
    let idx = 0, dmax = 0;
    const p = pts[0], q = pts[pts.length - 1];
    for (let i = 1; i < pts.length - 1; i++) {
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + q[0] * p[1] - q[1] * p[0]) / l;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax <= eps) return [p, q];
    return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
  };
  const areaOf = (p: V[]) => p.reduce((s, q, i) => { const n = p[(i + 1) % p.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0) / 2;
  const pip = (p: V[], x: number, y: number) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  };
  const simple = loops.map((l) => { const mid = Math.floor(l.length / 2); return [...simplify(l.slice(0, mid + 1), 0.6).slice(0, -1), ...simplify(l.slice(mid), 0.6).slice(0, -1)]; });
  simple.sort((a, b) => Math.abs(areaOf(b)) - Math.abs(areaOf(a)));
  const outer = simple[0];
  return { outer, holes: simple.slice(1).filter((h) => Math.abs(areaOf(h)) > 12 && pip(outer, h[0][0], h[0][1])) };
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image();
  i.crossOrigin = "anonymous";
  i.onload = () => res(i);
  i.onerror = () => rej(new Error(`image failed: ${src}`));
  i.src = src;
});

export async function buildCave(knives: IntroKnife[], aspect: number, onProgress: (done: number) => void): Promise<Cave> {
  const group = new THREE.Group();
  group.visible = false;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // ── light: a cool wash from the mouth, a glow at each knife ─────────────
  group.add(new THREE.HemisphereLight(0x7fa898, 0x050a08, 1.1));
  const mouth = new THREE.DirectionalLight(0xcfffe6, 1.2);
  mouth.position.set(-2, 6, 14);
  group.add(mouth);

  // ── the cavern ────────────────────────────────────────────────────────────
  const rockMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.BackSide }));
  const dome = keep(new THREE.SphereGeometry(1, 44, 18, 0, Math.PI * 2, 0, Math.PI * 0.6).toNonIndexed());
  roughen(dome, (x, y, z) => {
    const n = 1 + (fbm(x * 3 + 5, z * 3 + y * 2) - 0.5) * 0.22;
    return [x * 17 * n, y * 9.5 * n - 1.2, z * 19 * n];
  });
  const strata = [0x2c3532, 0x3a4440, 0x333b37, 0x46504b, 0x2a312e].map((c) => new THREE.Color(c));
  facetColors(dome, (x, y, z) => {
    const band = Math.floor((y + (fbm(x * 0.2, z * 0.2) - 0.5) * 2.4) / 1.3);
    const c = strata[((band % strata.length) + strata.length) % strata.length].clone().multiplyScalar(0.8 + hash(x, z) * 0.35);
    return c;
  });
  group.add(new THREE.Mesh(dome, rockMat));

  // stalactites from the roof, stalagmites along the edges
  const spikeMat = keep(new THREE.MeshStandardMaterial({ color: 0x48524d, flatShading: true, roughness: 0.9 }));
  const spike = keep(new THREE.ConeGeometry(1, 1, 6, 1));
  for (let i = 0; i < 46; i++) {
    const a = hash(i, 1) * Math.PI * 2, r = 3 + hash(i, 2) * 12;
    const x = Math.cos(a) * r * 0.9, z = Math.sin(a) * r - 2;
    const roof = 8.2 * Math.sqrt(Math.max(0.05, 1 - (x / 17) ** 2 - (z / 19) ** 2)) - 1.4;
    const len = 0.8 + hash(i, 3) * 2.6, rad = 0.15 + hash(i, 4) * 0.35;
    const m = new THREE.Mesh(spike, spikeMat);
    m.scale.set(rad, len, rad);
    m.rotation.x = Math.PI;
    m.position.set(x, roof - len / 2 + 0.3, z);
    group.add(m);
  }
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1, x = side * (7 + hash(i, 5) * 6), z = -12 + hash(i, 6) * 18;
    const len = 0.6 + hash(i, 7) * 1.8, rad = 0.2 + hash(i, 8) * 0.4;
    const m = new THREE.Mesh(spike, spikeMat);
    m.scale.set(rad, len, rad);
    m.position.set(x, len / 2 - 0.2, z);
    group.add(m);
  }

  // the ledge across the back: a flat-topped rock shelf with a wavy shore
  {
    const shape = new THREE.Shape();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = -13 + t * 26;
      const z = LEDGE_Z + 2.6 + Math.sin(t * Math.PI * 3 + 1) * 0.6 + (hash(i, 9) - 0.5) * 0.5 + Math.abs(x) * 0.12;
      if (i === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z);
    }
    shape.lineTo(13, 16); shape.lineTo(-13, 16);
    const geo = keep(new THREE.ExtrudeGeometry(shape, { depth: LEDGE_TOP + 1.5, bevelEnabled: false }).toNonIndexed());
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -1.5, 0);
    roughen(geo, (x, y, z) => y > LEDGE_TOP - 0.05 ? [x, y + (hash(x, z) - 0.5) * 0.06, z] : [x + (hash(x * 2, y) - 0.5) * 0.4, y, z + (hash(z, y * 3) - 0.5) * 0.4]);
    facetColors(geo, (x, y, z) => new THREE.Color(y > LEDGE_TOP - 0.1 ? 0x56605a : 0x404a45).multiplyScalar(0.85 + hash(x * 3, z * 3) * 0.3));
    group.add(new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }))));
  }

  // ── the knives, each in its stone ─────────────────────────────────────────
  const spacing = Math.min(3.3, Math.max(1.7, aspect * 2.1));
  const seats: [number, number][] = [[0, LEDGE_Z - 0.6], [-spacing, LEDGE_Z + 0.3], [spacing, LEDGE_Z + 0.3]]; // #1 centre, #2 left, #3 right
  const stoneMat = keep(new THREE.MeshStandardMaterial({ color: 0x6e746c, flatShading: true, roughness: 0.9 }));
  const edgeMat = keep(new THREE.MeshStandardMaterial({ color: 0x2b3238, metalness: 0.7, roughness: 0.35 }));
  const cut = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(STONE_TOP - 0.03)); // the stone hides what's inside
  edgeMat.clippingPlanes = [cut];
  const chipMat = keep(new THREE.MeshStandardMaterial({ color: 0x5b605a, flatShading: true, roughness: 0.9 }));
  const glowTex = keep(new THREE.CanvasTexture((() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,0.8)"); r.addColorStop(0.35, "rgba(255,255,255,0.28)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return c;
  })()));
  const glows: { light: THREE.PointLight; sprite: THREE.Sprite; base: number }[] = [];
  const glowPos: THREE.Vector3[] = [], glowCol: THREE.Color[] = [];
  const crackPos: number[] = [], crackCol: number[] = [], sparkPos: number[] = [];
  for (let n = 0; n < Math.min(3, knives.length); n++) {
    const img = await loadImage(knives[n].image);
    onProgress((n + 0.5) / 3.5);
    const r = read(img);
    const [x, z] = seats[n];
    // the stone
    const sg = keep(new THREE.IcosahedronGeometry(1, 2));
    const sx = 1.05 + hash(n, 1) * 0.3, sz = 0.95 + hash(n, 2) * 0.25;
    roughen(sg, (px, py, pz) => {
      const j = 0.82 + hash(px * 13 + n * 7, py * 7 + pz * 5) * 0.3;
      return [px * sx * j, Math.min(py * 0.9 * j, 0.45), pz * sz * j];
    });
    const stone = new THREE.Mesh(sg, stoneMat);
    stone.position.set(x, STONE_TOP - 0.45, z);
    stone.rotation.y = hash(n, 3) * 6;
    group.add(stone);
    // the knife: traced, extruded, the picture on both faces
    const LENGTH = n === 0 ? 3.3 : 2.9;
    const K = LENGTH / r.lenPx;
    const { outer, holes } = outline(r);
    const toV = ([gx, gy]: [number, number]) => new THREE.Vector2(gx * r.STEP * K, -gy * r.STEP * K);
    const shape = new THREE.Shape(outer.map(toV));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(toV)));
    const D = 0.06;
    const geo = keep(new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 1, curveSegments: 1 }));
    geo.translate(0, 0, -D / 2);
    const pa = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pa.count; i++) uv.setXY(i, pa.getX(i) / (r.IW * K), 1 + pa.getY(i) / (r.IH * K));
    const tex = keep(new THREE.Texture(img));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const face = keep(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.45, 0.45, 0.45), metalness: 0.35, roughness: 0.3, clippingPlanes: [cut] }));
    const mesh = new THREE.Mesh(geo, [face, edgeMat]);
    const tip = new THREE.Vector2(r.tip[0] * K, -r.tip[1] * K), base = new THREE.Vector2(r.base[0] * K, -r.base[1] * K);
    mesh.position.set(-tip.x, -tip.y, 0);
    const inner = new THREE.Group();
    inner.add(mesh);
    inner.rotation.z = -Math.atan2(base.y - tip.y, base.x - tip.x) + Math.PI / 2; // blade up from the tip
    const pivot = new THREE.Group();
    pivot.add(inner);
    const bladeLen = tip.distanceTo(base);
    pivot.position.set(x, STONE_TOP - bladeLen * EMBED, z);
    pivot.rotation.set(0, (n === 1 ? 0.35 : n === 2 ? -0.35 : 0) + (hash(n, 6) - 0.5) * 0.2, (hash(n, 8) - 0.5) * 0.08, "YXZ");
    group.add(pivot);
    // the finish's colour: the glow, the light, the cracks
    const gem = r.paint.clone();
    const hsl = { h: 0, s: 0, l: 0 };
    gem.getHSL(hsl);
    gem.setHSL(hsl.h, Math.min(1, hsl.s * 1.3 + 0.2), 0.55);
    const light = new THREE.PointLight(gem, 9, 6, 1.6);
    light.position.set(x, STONE_TOP + 1.3, z + 1.1);
    group.add(light);
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glowTex, color: gem, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 })));
    sprite.position.set(x, STONE_TOP + 0.35, z + 0.05);
    sprite.scale.setScalar(1.7);
    group.add(sprite);
    glows.push({ light, sprite, base: 9 });
    glowPos.push(new THREE.Vector3(x, STONE_TOP, z));
    glowCol.push(gem);
    // rubble and cracks where the blade went in
    const entryY = STONE_TOP + 0.03;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + hash(i + n, 11), rr = 0.18 + hash(i, 12 + n) * 0.25;
      const chip = new THREE.Mesh(keep(new THREE.DodecahedronGeometry(0.04 + hash(i, 13 + n) * 0.07, 0)), chipMat);
      chip.position.set(x + Math.cos(a) * rr, entryY, z + Math.sin(a) * rr * 0.8);
      chip.rotation.set(hash(i, 14) * 6, hash(i, 15) * 6, 0);
      chip.scale.y = 0.6;
      group.add(chip);
    }
    for (let i = 0; i < 5; i++) {
      let a = (i / 5) * Math.PI * 2 + hash(i + n, 41), cx = x, cz = z;
      for (let k = 0; k < 4; k++) {
        a += (hash(i + n, k + 50) - 0.5) * 0.9;
        const nx = cx + Math.cos(a) * 0.15, nz = cz + Math.sin(a) * 0.15;
        crackPos.push(cx, STONE_TOP + 0.012, cz, nx, STONE_TOP + 0.012, nz);
        crackCol.push(gem.r, gem.g, gem.b, gem.r, gem.g, gem.b);
        cx = nx; cz = nz;
      }
    }
    for (let i = 0; i < 14; i++) sparkPos.push(x - 0.8 + hash(i, 31 + n) * 1.6, STONE_TOP + 0.2 + hash(i, 32 + n) * 2.6, z - 0.5 + hash(i, 33 + n) * 1.2);
    // crystals of the same colour along the ledge near it
    for (let i = 0; i < 4; i++) {
      const cx = x + (hash(i, 61 + n) - 0.5) * 2.6, cz = z - 0.6 - hash(i, 62 + n) * 1.2;
      const c = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.08 + hash(i, 63 + n) * 0.1, 0)),
        keep(new THREE.MeshStandardMaterial({ color: gem, emissive: gem.clone().multiplyScalar(0.45), flatShading: true, roughness: 0.2 })));
      c.scale.y = 2.2;
      c.position.set(cx, LEDGE_TOP + 0.15, cz);
      c.rotation.set((hash(i, 64) - 0.5) * 0.7, 0, (hash(i, 65) - 0.5) * 0.7);
      group.add(c);
    }
    onProgress((n + 1) / 3.5);
  }
  {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(crackPos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(crackCol, 3));
    group.add(new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ vertexColors: true }))));
  }
  const sparkMat = keep(new THREE.PointsMaterial({ color: 0xdfe8ff, size: 0.045, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(sparkPos, 3));
    group.add(new THREE.Points(g, sparkMat));
  }

  // ── the water: dark, rippling, the knives' glow laid across it ───────────
  while (glowPos.length < 3) { glowPos.push(new THREE.Vector3(0, -50, 0)); glowCol.push(new THREE.Color(0, 0, 0)); }
  const waterMat = keep(new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uGlowPos: { value: glowPos },
      uGlowCol: { value: glowCol },
    }]),
    fog: true,
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime; uniform vec3 uCam; uniform vec3 uGlowPos[3]; uniform vec3 uGlowCol[3];
      varying vec3 vW;
      void main(){
        vec2 p = vW.xz;
        float rip = sin(p.x * 1.7 + uTime * 0.6) * 0.5 + sin(p.y * 2.3 - uTime * 0.45 + p.x * 0.6) * 0.35 + sin((p.x - p.y) * 4.1 + uTime * 1.1) * 0.15;
        vec3 c = vec3(0.012, 0.03, 0.032) + vec3(0.02, 0.06, 0.055) * (0.5 + 0.5 * rip);
        // each glow reflected as a streak toward the viewer, broken by the ripples
        for (int i = 0; i < 3; i++) {
          vec3 g = uGlowPos[i];
          float dx = p.x - g.x - (p.y - g.z) * (uCam.x - g.x) / max(0.5, uCam.z - g.z);
          float along = p.y - g.z;
          float streak = exp(-dx * dx * 3.0) * smoothstep(-0.5, 0.8, along) * exp(-max(0.0, along) * 0.14);
          c += uGlowCol[i] * streak * (0.35 + 0.35 * (0.5 + 0.5 * sin(along * 9.0 - uTime * 2.0 + rip * 2.0)));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  }));
  const water = new THREE.Mesh(keep(new THREE.PlaneGeometry(44, 44)), waterMat);
  water.rotation.x = -Math.PI / 2;
  group.add(water);

  // ── the camera's route ───────────────────────────────────────────────────
  const P0 = new THREE.Vector3(0, 2.0, 15.5), L0 = new THREE.Vector3(0, 1.8, 0);
  const L1 = new THREE.Vector3(0, 2.4, LEDGE_Z), L2 = new THREE.Vector3(0, 2.9, LEDGE_Z - 0.2);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function closeDist(a: number, fovDeg: number) {
    // fit the three knives (about ±(spacing + 1.3) across, 3.6 tall) in view
    const v = Math.tan(((fovDeg / 2) * Math.PI) / 180), h = v * a;
    return Math.min(18, Math.max(4.5, Math.max((spacing + 1.4) / h, 2.4 / v)));
  }
  return {
    group,
    fogColor: new THREE.Color(0x030807),
    fogNear: 9,
    fogFar: 34,
    closeUpAt: GLIDE + CLOSE,
    pose(t, a, fovDeg, pos, look) {
      const d = closeDist(a, fovDeg);
      const P2 = tmpA.set(0, 2.9, LEDGE_Z - 0.2 + d);
      const P1 = tmpB.set(0.6, 3.1, Math.max(P2.z + 3.5, 6));
      if (t < GLIDE) {
        const e = ease(t / GLIDE);
        pos.copy(P0).lerp(P1, e);
        look.copy(L0).lerp(L1, e);
      } else if (t < GLIDE + CLOSE) {
        const e = ease((t - GLIDE) / CLOSE);
        pos.copy(P1).lerp(P2, e);
        look.copy(L1).lerp(L2, e);
      } else {
        const h = t - GLIDE - CLOSE;
        pos.copy(P2).add(new THREE.Vector3(Math.sin(h * 0.22) * 0.5, Math.sin(h * 0.15) * 0.12, 0));
        look.copy(L2);
      }
    },
    update(time, camera) {
      waterMat.uniforms.uTime.value = time;
      waterMat.uniforms.uCam.value.copy(camera);
      glows.forEach((g, i) => {
        const f = 0.85 + 0.15 * Math.sin(time * 2.1 + i * 2.3);
        g.light.intensity = g.base * f;
        g.sprite.material.opacity = 0.7 * f;
      });
      sparkMat.size = 0.035 + 0.015 * Math.sin(time * 3.1);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
