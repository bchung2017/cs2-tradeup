// The campus around the Lounge's koi pond: a modern city plaza in the manner
// of New York's newer public spaces, with the pond as its centrepiece. Stone
// paving everywhere you walk, nature held in crisp planters (stone seat-walls
// with a light strip under the lip, or thin weathering-steel edges), sweeping
// walks, a water rill with a deck bridge, a lit grand stair, and a wall of
// glass and stone towers round the edge.
//
// Procedural and cheap: one seeded RNG (the seed is a timestamp, so each load
// lays out a new campus), an occupancy grid for placement, and about twenty
// draw calls. Lighting is baked into vertex colours and the ground texture.
//   layout     the plaza round the pond, 4–6 walks sweeping out from it to a
//              promenade along the towers, a rill out of the plaza
//   planters   curved (superellipse, bent into crescents), angular (skewed,
//              chamfered) and arc bands hugging the plaza, packed into the
//              space the walks leave, each aligned with the nearest walk;
//              planted as clipped hedge, perennials or a small grove, always
//              kept inside the curb
//   ground     one canvas: patterned pavers, cobbled walks with kerb lines,
//              inlaid sweeping arcs, slab promenade, tree grates, baked light
//              pools from lamps and light strips
//   towers     two rows on every side, glass curtain walls, stone with punched
//              windows, or glass with fins; one mesh, one shader
// Everything rises into place, nearest first, as the camera tilts in.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const GREEN = 0x33ff33;

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Campus {
  group: THREE.Group;
  update(time: number, s: number): void;
  dispose(): void;
}

type P = [number, number]; // (x, z)

function rng(seed: number) {
  let x = (seed >>> 0) || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const col = (h: number) => new THREE.Color(h);

// ── polygons ────────────────────────────────────────────────────────────────
function area(p: P[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}
// grow (d > 0) or shrink (d < 0) a polygon, mitred
function offset(p: P[], d: number): P[] {
  const s = area(p) > 0 ? 1 : -1, n = p.length;
  return p.map((q, i) => {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    const l1 = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1, l2 = Math.hypot(b[0] - q[0], b[1] - q[1]) || 1;
    const n1x = (s * (q[1] - a[1])) / l1, n1z = (-s * (q[0] - a[0])) / l1;
    const n2x = (s * (b[1] - q[1])) / l2, n2z = (-s * (b[0] - q[0])) / l2;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const k = d / Math.max(0.5, mx * n1x + mz * n1z);
    return [q[0] + mx * k, q[1] + mz * k];
  });
}
function inside(p: P[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
function edgeDist(p: P[], x: number, z: number) {
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1]));
  }
  return d;
}
// left and right edges of a polyline widened to half-width hw, mitred
const segNormal = (a: P, b: P): P => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
function strip(pts: P[], hw: number): [P[], P[]] {
  const L: P[] = [], R: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const n1 = i > 0 ? segNormal(pts[i - 1], pts[i]) : null;
    const n2 = i < pts.length - 1 ? segNormal(pts[i], pts[i + 1]) : null;
    let nx: number, nz: number, k = 1;
    if (n1 && n2) {
      nx = n1[0] + n2[0]; nz = n1[1] + n2[1];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      k = 1 / Math.max(0.5, nx * n1[0] + nz * n1[1]);
    } else {
      [nx, nz] = (n1 ?? n2)!;
    }
    L.push([pts[i][0] + nx * hw * k, pts[i][1] + nz * hw * k]);
    R.push([pts[i][0] - nx * hw * k, pts[i][1] - nz * hw * k]);
  }
  return [L, R];
}
const place = (pts: P[], x: number, z: number, a: number): P[] => {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
};
// a rounded slab, from pill to rounded rectangle (n), bent into a crescent
function superellipse(L: number, W: number, n: number, bend: number): P[] {
  const out: P[] = [];
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const u = (L / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const v = (W / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    out.push([u, v + bend * W * Math.pow(u / (L / 2), 2)]);
  }
  return out;
}
// a crisp slab: skewed, one corner cut
function angular(L: number, W: number, skew: number, cut: number): P[] {
  const pts: P[] = [[-L / 2, -W / 2], [L / 2, -W / 2]];
  if (cut > 0.2) pts.push([L / 2, W / 2 - cut], [L / 2 - cut, W / 2]);
  else pts.push([L / 2, W / 2]);
  pts.push([-L / 2, W / 2]);
  return pts.map(([u, v]) => [u + skew * v, v]);
}
// a band along an arc round (cx, cz), round-ended
function arcBand(cx: number, cz: number, r0: number, r1: number, a0: number, a1: number): P[] {
  const pts: P[] = [], rm = (r0 + r1) / 2, hw = (r1 - r0) / 2, N = Math.max(8, Math.ceil((a1 - a0) * rm / 1.2));
  for (let i = 0; i <= N; i++) { const a = a0 + ((a1 - a0) * i) / N; pts.push([cx + Math.cos(a) * r1, cz + Math.sin(a) * r1]); }
  for (let i = 1; i < 8; i++) { const t = (i / 8) * Math.PI; pts.push([cx + Math.cos(a1) * rm + hw * Math.cos(a1 + t), cz + Math.sin(a1) * rm + hw * Math.sin(a1 + t)]); }
  for (let i = N; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / N; pts.push([cx + Math.cos(a) * r0, cz + Math.sin(a) * r0]); }
  for (let i = 1; i < 8; i++) { const t = Math.PI + (i / 8) * Math.PI; pts.push([cx + Math.cos(a0) * rm + hw * Math.cos(a0 + t), cz + Math.sin(a0) * rm + hw * Math.sin(a0 + t)]); }
  return pts;
}

// ── geometry ────────────────────────────────────────────────────────────────
// Light baked into vertex colours (the scene has no lights): cool sky from
// above, a key light from the front left.
const KEY = new THREE.Vector3(-6, 14, 8).normalize();
function shade(geo: THREE.BufferGeometry, color: THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  const n = g.attributes.normal, c = new Float32Array(n.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    const k = 0.4 + 0.35 * (0.5 * v.y + 0.5) + 0.4 * Math.max(0, v.dot(KEY));
    c[i * 3] = color.r * k; c[i * 3 + 1] = color.g * k; c[i * 3 + 2] = color.b * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}
// a prism on a polygon (with an optional hole), from y0 up to y1
function prism(outer: P[], hole: P[] | null, y0: number, y1: number) {
  const sh = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  if (hole) sh.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}
function flat(p: P[], y: number) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x, -z))));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

const FOG_VERT = `#include <fog_pars_vertex>`;
const FOG_FRAG = `#include <fog_pars_fragment>`;

// `diorama`: the pond with its rock and patio, which the plaza surrounds;
// `basin`: the pond's outer walls, cut out of the ground.
export function buildCampus(diorama: Bounds, basin: Bounds, rim: number, seed: number): Campus {
  const rand = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const Y = rim; // plaza level: the top of the pond's walls
  const risers: [THREE.Object3D, number][] = []; // [object, delay distance]

  // ── layout ───────────────────────────────────────────────────────────────
  const margin = 3;
  const plaza = { minX: diorama.minX - margin, maxX: diorama.maxX + margin, minZ: diorama.minZ - margin, maxZ: diorama.maxZ + margin };
  const cx = (plaza.minX + plaza.maxX) / 2, cz = (plaza.minZ + plaza.maxZ) / 2;
  const hx = (plaza.maxX - plaza.minX) / 2, hz = (plaza.maxZ - plaza.minZ) / 2;
  const HC = Math.max(hx, hz) + 24 + rand() * 6; // the court: a square this far out each way
  const PROM = 5; // promenade along the towers
  const EXT = HC + 62; // the ground runs this far each way; fog takes the edge
  const swirl = rand() < 0.5 ? -1 : 1; // which way everything sweeps

  // occupancy grid
  const CELL = 0.5, GN = Math.ceil((2 * EXT) / CELL);
  const grid = new Uint8Array(GN * GN);
  const HARD = 1, BUF = 2, PATH = 4, SPINE = 8;
  const ci = (v: number) => Math.min(GN - 1, Math.max(0, Math.floor((v + EXT) / CELL)));
  const at = (x: number, z: number) => grid[ci(z) * GN + ci(x)];
  function scan(p: P[], fn: (idx: number) => boolean | void) {
    let z0 = Infinity, z1 = -Infinity;
    for (const q of p) { z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const xs: number[] = [];
    for (let j = ci(z0); j <= ci(z1); j++) {
      const z = (j + 0.5) * CELL - EXT;
      xs.length = 0;
      for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
        const [xa, za] = p[a], [xb, zb] = p[b];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] + EXT) / CELL - 0.5)), i1 = Math.min(GN - 1, Math.floor((xs[k + 1] + EXT) / CELL - 0.5));
        for (let i = i0; i <= i1; i++) if (fn(j * GN + i) === false) return false;
      }
    }
    return true;
  }
  const isFree = (p: P[], mask: number) => scan(p, (i) => (grid[i] & mask) === 0);
  const mark = (p: P[], bits: number) => scan(p, (i) => { grid[i] |= bits; });
  function markSeg(a: P, b: P, r: number, bits: number) {
    for (let j = ci(Math.min(a[1], b[1]) - r); j <= ci(Math.max(a[1], b[1]) + r); j++) {
      for (let i = ci(Math.min(a[0], b[0]) - r); i <= ci(Math.max(a[0], b[0]) + r); i++) {
        if (segDist((i + 0.5) * CELL - EXT, (j + 0.5) * CELL - EXT, a[0], a[1], b[0], b[1]) < r) grid[j * GN + i] |= bits;
      }
    }
  }
  function areaClear(x: number, z: number, r: number, mask: number) {
    for (let j = ci(z - r); j <= ci(z + r); j++) for (let i = ci(x - r); i <= ci(x + r); i++) if (grid[j * GN + i] & mask) return false;
    return true;
  }
  const rect = (x0: number, z0: number, x1: number, z1: number): P[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

  // the court's edge, the promenade inside it, the plaza
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const m = Math.max(Math.abs((i + 0.5) * CELL - EXT - cx), Math.abs((j + 0.5) * CELL - EXT - cz));
      if (m > HC) grid[j * GN + i] = HARD;
      else if (m > HC - PROM) grid[j * GN + i] = PATH;
    }
  }
  mark(rect(plaza.minX - 1, plaza.minZ - 1, plaza.maxX + 1, plaza.maxZ + 1), PATH);
  mark(rect(diorama.minX, diorama.minZ, diorama.maxX, diorama.maxZ), HARD);

  // where a ray from the centre at angle a leaves a centred box
  const boxHit = (a: number, ex: number, ez: number): P => {
    const c = Math.cos(a), s = Math.sin(a);
    const t = Math.min(ex / Math.max(1e-6, Math.abs(c)), ez / Math.max(1e-6, Math.abs(s)));
    return [cx + c * t, cz + s * t];
  };

  // the walks: cubic sweeps from the plaza out to the promenade, meeting it
  // square on, all bending the same way
  const spines: { pts: P[]; tan: P[]; w: number; end: P; side: number }[] = [];
  {
    const K = 4 + Math.floor(rand() * 3), a0 = rand() * Math.PI * 2;
    for (let k = 0; k < K; k++) {
      const a = a0 + (k * Math.PI * 2) / K + (rand() - 0.5) * 0.45;
      const p0 = boxHit(a, hx + 1, hz + 1);
      const ae = a + swirl * (0.35 + rand() * 0.5);
      const p3 = boxHit(ae, HC - 0.5, HC - 0.5);
      const onX = Math.abs(p3[0] - cx) >= Math.abs(p3[1] - cz);
      const nE: P = onX ? [Math.sign(p3[0] - cx), 0] : [0, Math.sign(p3[1] - cz)];
      const side = onX ? (nE[0] > 0 ? 1 : 3) : (nE[1] > 0 ? 2 : 0);
      const L = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
      const p1: P = [p0[0] + Math.cos(a) * L * 0.4, p0[1] + Math.sin(a) * L * 0.4];
      const p2: P = [p3[0] - nE[0] * L * 0.4, p3[1] - nE[1] * L * 0.4];
      const n = Math.ceil(L / 1.2), pts: P[] = [], tan: P[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
        pts.push([b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0], b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1]]);
        const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
        const tx = d0 * (p1[0] - p0[0]) + d1 * (p2[0] - p1[0]) + d2 * (p3[0] - p2[0]);
        const tz = d0 * (p1[1] - p0[1]) + d1 * (p2[1] - p1[1]) + d2 * (p3[1] - p2[1]);
        const tl = Math.hypot(tx, tz) || 1;
        tan.push([tx / tl, tz / tl]);
      }
      const w = 2.6 + rand() * 1.6;
      for (let i = 0; i < n; i++) {
        markSeg(pts[i], pts[i + 1], w / 2 + 0.9, PATH);
        markSeg(pts[i], pts[i + 1], w / 2, SPINE);
      }
      spines.push({ pts, tan, w, end: p3, side });
    }
  }
  // the direction things line up with near (x, z): the nearest walk, or a
  // sweep round the pond
  function flowAt(x: number, z: number) {
    let best = 10, ang: number | null = null;
    for (const sp of spines) {
      for (let i = 0; i < sp.pts.length; i++) {
        const d = Math.hypot(sp.pts[i][0] - x, sp.pts[i][1] - z);
        if (d < best) { best = d; ang = Math.atan2(sp.tan[i][1], sp.tan[i][0]); }
      }
    }
    return ang ?? Math.atan2(z - cz, x - cx) + swirl * (Math.PI / 2 + 0.25);
  }

  // ── the grand stair: a raised terrace on the far side, lit treads ────────
  const ledLines: number[] = []; // light strips, as line segments
  const pots: { x: number; y: number; z: number }[] = [];
  const seats: { x: number; y: number; z: number; r: number }[] = [];
  const terraceParts: THREE.BufferGeometry[] = [];
  const brass: number[] = [];
  let kiosk: THREE.Group | null = null;
  {
    const exit = spines.find((s) => s.side === 0);
    const TW = 18 + rand() * 6, SW = Math.min(12, TW - 6), TD = 5.5, TH = 2.2, STEPS = 8, RISE = TH / STEPS, RUN = 0.45;
    const tx = Math.min(cx + HC - TW / 2 - 1, Math.max(cx - HC + TW / 2 + 1, exit ? exit.end[0] : cx + (rand() - 0.5) * HC));
    const z0 = cz - HC, zf = z0 + TD;
    const stone = col(0x56625c), tread = col(0x75817a);
    terraceParts.push(shade(new THREE.BoxGeometry(TW, TH, TD).translate(tx, Y + TH / 2, z0 + TD / 2), stone));
    for (let i = 0; i < STEPS; i++) {
      const top = (i + 1) * RISE, front = zf + (STEPS - i) * RUN;
      terraceParts.push(shade(new THREE.BoxGeometry(SW, top, front - zf).translate(tx, Y + top / 2, (zf + front) / 2), tread));
      ledLines.push(tx - SW / 2, Y + top - 0.05, front + 0.01, tx + SW / 2, Y + top - 0.05, front + 0.01);
    }
    // the wall either side of the stair: a strip under the parapet
    for (const [a, b] of [[tx - TW / 2, tx - SW / 2], [tx + SW / 2, tx + TW / 2]]) ledLines.push(a, Y + TH - 0.1, zf + 0.01, b, Y + TH - 0.1, zf + 0.01);
    // handrails up the stair, a glass parapet along the top
    for (const x of [tx - SW / 2 + 0.3, tx - SW / 6, tx + SW / 6, tx + SW / 2 - 0.3]) brass.push(x, Y + 0.95, zf + STEPS * RUN, x, Y + TH + 0.95, zf);
    for (const [a, b] of [[tx - TW / 2, tx - SW / 2], [tx + SW / 2, tx + TW / 2]]) brass.push(a, Y + TH + 1.0, zf - 0.1, b, Y + TH + 1.0, zf - 0.1);
    // on top: a glass lift kiosk, pots, round seats
    const kx = tx + (rand() < 0.5 ? -1 : 1) * (SW / 2 + 1.5 + rand() * Math.max(0, TW / 2 - SW / 2 - 4));
    const kg = keep(new THREE.BoxGeometry(2.4, 3.2, 2.4).translate(kx, Y + TH + 1.6, z0 + TD * 0.5));
    kiosk = new THREE.Group();
    kiosk.add(new THREE.Mesh(kg, keep(new THREE.MeshBasicMaterial({ color: 0x8fdca0, transparent: true, opacity: 0.32 }))));
    kiosk.add(new THREE.LineSegments(keep(new THREE.EdgesGeometry(kg)), keep(new THREE.LineBasicMaterial({ color: 0xd8ffd0 }))));
    for (let i = 0; i < 7; i++) {
      const x = tx + (rand() - 0.5) * (TW - 2), z = z0 + 0.8 + rand() * (TD - 1.6);
      if (Math.abs(x - kx) < 2.2) continue;
      if (rand() < 0.55) pots.push({ x, y: TH, z }); else seats.push({ x, y: TH, z, r: 0.6 + rand() * 0.4 });
    }
    mark(rect(tx - TW / 2 - 1.5, z0, tx + TW / 2 + 1.5, zf + STEPS * RUN + 1.5), BUF);
    mark(rect(tx - TW / 2, z0, tx + TW / 2, zf + STEPS * RUN), HARD);
  }

  // ── the rill: a stone channel out of the plaza, zig-zagging, with decks ──
  let rillPts: P[] = [];
  const decks: { x: number; z: number; a: number }[] = [];
  const RW = 1.3, RT = 0.22, RH = 0.45;
  {
    // away from where the walks leave the plaza
    const starts = spines.map((s) => Math.atan2(s.pts[0][1] - cz, s.pts[0][0] - cx));
    let ar = 0, bestGap = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const gap = Math.min(...starts.map((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s)))));
      if (gap > bestGap) { bestGap = gap; ar = a; }
    }
    let p = boxHit(ar, hx - 0.5, hz - 0.5), a = ar;
    rillPts = [p];
    const lens = [8 + rand() * 6, 6 + rand() * 7, rand() < 0.6 ? 4 + rand() * 5 : 0];
    for (let s = 0; s < lens.length && lens[s] > 0; s++) {
      if (s > 0) a += (s % 2 ? swirl : -swirl) * (0.45 + rand() * 0.35);
      let L = lens[s];
      // stop short of the promenade
      while (L > 2 && Math.max(Math.abs(p[0] + Math.cos(a) * L - cx), Math.abs(p[1] + Math.sin(a) * L - cz)) > HC - PROM - 3) L -= 1;
      if (L <= 2) break;
      p = [p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L];
      rillPts.push(p);
    }
    // deck bridges where walks cross it
    let last = -10, run = 0;
    for (let s = 0; s + 1 < rillPts.length; s++) {
      const [a0, a1] = [rillPts[s], rillPts[s + 1]];
      const L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
      for (let d = 0; d < L; d += 0.5, run += 0.5) {
        const x = a0[0] + Math.cos(ang) * d, z = a0[1] + Math.sin(ang) * d;
        if (run - last > 6 && run > 3 && at(x, z) & SPINE) { decks.push({ x, z, a: ang }); last = run; }
      }
    }
    if (!decks.length && rillPts.length > 1) {
      const [a0, a1] = rillPts;
      decks.push({ x: (a0[0] + a1[0]) / 2 + (a1[0] - a0[0]) * 0.15, z: (a0[1] + a1[1]) / 2 + (a1[1] - a0[1]) * 0.15, a: Math.atan2(a1[1] - a0[1], a1[0] - a0[0]) });
    }
    const [L, R] = strip(rillPts, RW / 2 + RT + 1.2);
    mark([...L, ...R.reverse()], BUF);
    const [L2, R2] = strip(rillPts, RW / 2 + RT);
    mark([...L2, ...R2.reverse()], HARD);
  }

  // ── planters ─────────────────────────────────────────────────────────────
  interface Planter { p: P[]; inner: P[]; h: number; corten: boolean; led: boolean; mode: number }
  const planters: Planter[] = [];
  const curvy = 0.4 + rand() * 0.45; // this campus's mix of curved and angular
  function tryPlanter(p: P[]) {
    if (!isFree(p, HARD | BUF | PATH)) return false;
    mark(offset(p, 1.5 + rand() * 1.3), BUF);
    mark(p, HARD);
    const corten = rand() < 0.25;
    const t = corten ? 0.09 : 0.24;
    const inner = offset(p, -t);
    if (Math.sign(area(inner)) !== Math.sign(area(p)) || Math.abs(area(inner)) < 0.6) return true; // too small to plant: still a block
    const h = corten ? 0.32 + rand() * 0.15 : rand() < 0.15 ? 0.85 : 0.45 + rand() * 0.12;
    const r = rand();
    planters.push({ p, inner, h, corten, led: !corten && rand() < 0.7, mode: r < 0.15 ? 0 : r < 0.6 ? 1 : 2 });
    return true;
  }
  // arc bands hugging the plaza
  {
    const r0 = Math.hypot(hx, hz) + 1.8 + rand() * 2;
    let placed = 0;
    for (let k = 0; k < 10 && placed < 4; k++) {
      const a0 = rand() * Math.PI * 2, w = 1.6 + rand() * 1.0;
      for (let span = 0.5 + rand() * 0.7; span > 0.18; span *= 0.7) {
        if (tryPlanter(arcBand(cx, cz, r0, r0 + w, a0, a0 + span))) { placed++; break; }
      }
    }
  }
  // long beds sweeping along the walks, tapering at each end
  for (const sp of spines) {
    for (const side of [-1, 1]) {
      for (let k = 0, run = 1 + Math.floor(rand() * 4); k < 3 && run < sp.pts.length - 4; k++) {
        const n = Math.min(sp.pts.length - 1 - run, 6 + Math.floor(rand() * 12));
        const W = 1.8 + rand() * 1.8, d0 = sp.w / 2 + 1.15;
        for (let len = n; len >= 4; len = Math.floor(len * 0.7)) {
          const inner: P[] = [], outer: P[] = [];
          for (let i = 0; i <= len; i++) {
            const q = sp.pts[run + i], t = sp.tan[run + i], f = i / len;
            const nx = -t[1] * side, nz = t[0] * side, w = 0.9 + (W - 0.9) * Math.pow(Math.sin(Math.PI * f), 0.5);
            inner.push([q[0] + nx * d0, q[1] + nz * d0]);
            outer.push([q[0] + nx * (d0 + w), q[1] + nz * (d0 + w)]);
          }
          if (tryPlanter([...inner, ...outer.reverse()])) { run += len; break; }
        }
        run += 3 + Math.floor(rand() * 4); // a gap to walk through
      }
    }
  }
  // the rest, fewer and larger, in the space left
  for (let tries = 0; tries < 700 && planters.length < 48; tries++) {
    const x = cx + (rand() * 2 - 1) * (HC - PROM), z = cz + (rand() * 2 - 1) * (HC - PROM);
    if (at(x, z) & (HARD | BUF | PATH)) continue;
    const flow = flowAt(x, z);
    const isCurvy = rand() < curvy;
    const L0 = 6 + rand() * rand() * 13, W0 = Math.min(2.4 + rand() * 2.8, L0 * 0.6);
    for (const sc of [1, 0.75]) {
      const L = Math.max(2.2, L0 * sc), W = Math.max(1.4, W0 * Math.sqrt(sc));
      const shape = isCurvy
        ? superellipse(L, W, 2.2 + rand() * 2.5, L > 6 ? (rand() - 0.5) * 0.9 : 0)
        : angular(L, W, (rand() - 0.5) * 0.8, rand() < 0.6 ? Math.min(L, W) * 0.5 * rand() : 0);
      const a = isCurvy ? flow : Math.round(flow / (Math.PI / 8)) * (Math.PI / 8);
      if (tryPlanter(place(shape, x, z, a))) break;
    }
  }

  // curbs, soil, hedges; plants; benches along them
  const curbParts: THREE.BufferGeometry[] = [], greenParts: THREE.BufferGeometry[] = [];
  type Plant = { x: number; y: number; z: number; s: number; sy: number; c: THREE.Color };
  const shrubs: Plant[] = [], grasses: Plant[] = [];
  const trees: (Plant & { kind: number })[] = [];
  const benches: { x: number; z: number; rot: number }[] = [];
  const glowRings: P[][] = [];
  const STONE = col(0x68756e), COPING = col(0x87948c), CORTEN = col(0x7a3f20), SOIL = col(0x0d2012), HEDGE = [col(0x1a4a22), col(0x1f5226)];
  const shrubTones = [0x1f5a2a, 0x2a6c32, 0x184a24, 0x356f2c, 0x24603a].map(col);
  const flowerTones = [0xb86a8a, 0xd8e8c0, 0xc89a5a, 0xa8c8e8].map(col);
  const grassTones = [0x6a8a34, 0x58782c, 0x7a9440].map(col);
  const leafTones = [0x2e7a36, 0x3a8a3c, 0x266a30, 0x44903e].map(col);
  const pineTones = [0x1a4a28, 0x20552c].map(col);
  for (const pl of planters) {
    const { p, inner, h } = pl;
    if (pl.corten) {
      curbParts.push(shade(prism(p, inner, Y, Y + h), CORTEN));
    } else {
      curbParts.push(shade(prism(p, inner, Y, Y + h - 0.07), STONE));
      curbParts.push(shade(prism(offset(p, 0.05), inner, Y + h - 0.07, Y + h), COPING));
    }
    const soilY = Y + h - 0.06;
    greenParts.push(shade(flat(inner, soilY), SOIL));
    if (pl.led) {
      const ring = offset(p, 0.012);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        ledLines.push(a[0], Y + h - 0.12, a[1], b[0], Y + h - 0.12, b[1]);
      }
      glowRings.push(p);
    }
    // planting, kept inside the curb
    const A = Math.abs(area(inner));
    let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const [x, z] of inner) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const spot = (minEdge: number): [number, number, number] | null => {
      for (let k = 0; k < 14; k++) {
        const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
        if (!inside(inner, x, z)) continue;
        const d = edgeDist(inner, x, z);
        if (d >= minEdge) return [x, z, d];
      }
      return null;
    };
    const addTrees = (n: number) => {
      for (let i = 0; i < n && trees.length < 260; i++) {
        const s = spot(0.7);
        if (!s) continue;
        const kind = rand() < 0.25 ? 1 : 0;
        trees.push({ x: s[0], y: soilY - Y, z: s[1], s: 0.75 + rand() * 0.45, sy: 1, c: pick(kind ? pineTones : leafTones), kind });
      }
    };
    if (pl.mode === 0) {
      // a clipped hedge filling the bed, a tree or two standing out of it
      const hedge = offset(p, -(pl.corten ? 0.09 : 0.24) - 0.12);
      if (Math.sign(area(hedge)) === Math.sign(area(p)) && Math.abs(area(hedge)) > 0.4) {
        greenParts.push(shade(prism(hedge, null, soilY, soilY + 0.35 + rand() * 0.3), pick(HEDGE)));
      }
      addTrees(A > 8 ? 1 + Math.floor(A / 30) : 0);
    } else if (pl.mode === 1) {
      // perennials: shrubs and grasses, a few in flower, a tree in the bigger beds
      for (let i = 0; i < A * 0.45 && shrubs.length < 2200; i++) {
        const s = spot(0.15);
        if (!s) continue;
        const r = Math.min(0.3 + rand() * 0.45, s[2] * 0.95);
        shrubs.push({ x: s[0], y: soilY - Y + r * 0.3, z: s[1], s: r, sy: 0.75, c: rand() < 0.12 ? pick(flowerTones) : pick(shrubTones) });
      }
      for (let i = 0; i < A * 0.7 && grasses.length < 3000; i++) {
        const s = spot(0.18);
        if (s) grasses.push({ x: s[0], y: soilY - Y, z: s[1], s: 0.6 + rand() * 0.5, sy: 0.7 + rand() * 0.6, c: pick(grassTones) });
      }
      if (A > 6 && rand() < 0.8) addTrees(1 + Math.floor(A / 22));
    } else {
      // a small grove over low groundcover
      for (let i = 0; i < A * 0.9 && shrubs.length < 2200; i++) {
        const s = spot(0.12);
        if (!s) continue;
        const r = Math.min(0.18 + rand() * 0.15, s[2]);
        shrubs.push({ x: s[0], y: soilY - Y + r * 0.2, z: s[1], s: r, sy: 0.55, c: pick(shrubTones) });
      }
      addTrees(1 + Math.floor(A / 9));
    }
    // benches facing out along the planter, where there's room
    if (rand() < 0.55) {
      const s = area(p) > 0 ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        const i = Math.floor(rand() * p.length);
        const a = p[(i - 1 + p.length) % p.length], b = p[(i + 1) % p.length];
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / tl, tz = (b[1] - a[1]) / tl;
        const nx = s * tz, nz = -s * tx;
        const x = p[i][0] + nx * 0.85, z = p[i][1] + nz * 0.85;
        if (![-1.1, 0, 1.1].every((u) => !(at(x + tx * u, z + tz * u) & (HARD | SPINE)))) continue;
        benches.push({ x, z, rot: Math.atan2(-tz, tx) });
        markSeg([x - tx * 1.2, z - tz * 1.2], [x + tx * 1.2, z + tz * 1.2], 0.6, HARD);
        break;
      }
    }
  }

  // ── street furniture ─────────────────────────────────────────────────────
  const lamps: { x: number; z: number; rot: number }[] = [];
  const grates: P[] = [];
  // lamps along the walks, alternating sides
  for (const sp of spines) {
    let side = 1, run = 3;
    for (let i = 1; i < sp.pts.length; i++) {
      run += Math.hypot(sp.pts[i][0] - sp.pts[i - 1][0], sp.pts[i][1] - sp.pts[i - 1][1]);
      if (run < 9) continue;
      const n: P = [-sp.tan[i][1] * side, sp.tan[i][0] * side];
      const x = sp.pts[i][0] + n[0] * (sp.w / 2 + 0.45), z = sp.pts[i][1] + n[1] * (sp.w / 2 + 0.45);
      if (!(at(x, z) & HARD) && Math.max(Math.abs(x - cx), Math.abs(z - cz)) < HC - PROM) {
        lamps.push({ x, z, rot: Math.atan2(n[1], -n[0]) });
        markSeg([x, z], [x, z], 0.5, HARD);
        run = 0; side = -side;
      }
    }
  }
  // the promenade: trees in grates, lamps between them
  for (const [nx, nz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const tx = -nz, tz = nx, d = HC - 2.6;
    for (let u = -HC + 4, k = 0; u < HC - 4; u += 3.75, k++) {
      const x = cx + nx * d + tx * u, z = cz + nz * d + tz * u;
      if (!areaClear(x, z, 0.9, HARD | SPINE)) continue;
      if (k % 2 === 0) {
        trees.push({ x, y: 0, z, s: 0.95 + rand() * 0.25, sy: 1, c: pick(leafTones), kind: 0 });
        grates.push([x, z]);
      } else {
        lamps.push({ x, z, rot: Math.atan2(nz, -nx) }); // arm reaching over the promenade
      }
      markSeg([x, z], [x, z], 0.8, HARD);
    }
  }
  // round seats and pots in clusters in the open
  for (let c = 0, tries = 0; c < 6 && tries < 80; tries++) {
    const x = cx + (rand() * 2 - 1) * (HC - PROM - 3), z = cz + (rand() * 2 - 1) * (HC - PROM - 3);
    if (!areaClear(x, z, 3, HARD | SPINE)) continue;
    c++;
    const n = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const px = x + (rand() - 0.5) * 5, pz = z + (rand() - 0.5) * 5;
      if (!areaClear(px, pz, 0.8, HARD | SPINE)) continue;
      if (rand() < 0.5) seats.push({ x: px, y: 0, z: pz, r: 0.7 + rand() * 0.6 });
      else pots.push({ x: px, y: 0, z: pz });
      markSeg([px, pz], [px, pz], 1.0, HARD);
    }
  }
  // pots get a shrub or grasses each
  for (const p of pots) {
    if (rand() < 0.5) shrubs.push({ x: p.x, y: p.y + 0.8, z: p.z, s: 0.45, sy: 0.85, c: pick(shrubTones) });
    else for (let i = 0; i < 3; i++) grasses.push({ x: p.x + (rand() - 0.5) * 0.4, y: p.y + 0.72, z: p.z + (rand() - 0.5) * 0.4, s: 0.7, sy: 0.9 + rand() * 0.5, c: pick(grassTones) });
  }

  // ── towers ───────────────────────────────────────────────────────────────
  const towerParts: THREE.BufferGeometry[] = [];
  {
    const exits: number[][] = [[], [], [], []];
    const SIDES: [P, P][] = [[[0, -1], [1, 0]], [[1, 0], [0, 1]], [[0, 1], [1, 0]], [[-1, 0], [0, 1]]];
    for (const sp of spines) exits[sp.side].push(SIDES[sp.side][1][0] * (sp.end[0] - cx) + SIDES[sp.side][1][1] * (sp.end[1] - cz));
    // the camera looks from +z, a little -x: towers on that side stay low
    const cam: P = [-0.42, 0.9];
    let id = 0;
    const part = (poly: P[], y0: number, y1: number, type: number) => {
      const g = prism(poly, null, y0, y1);
      g.deleteAttribute("uv");
      const n = g.attributes.position.count;
      g.setAttribute("aId", new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
      g.setAttribute("aType", new THREE.BufferAttribute(new Float32Array(n).fill(type), 1));
      towerParts.push(g);
    };
    const foot = (mx: number, mz: number, t: P, n: P, w: number, d: number, cut: number): P[] => {
      const local: P[] = cut > 0
        ? [[-w / 2 + cut, -d / 2], [w / 2 - cut, -d / 2], [w / 2, -d / 2 + cut], [w / 2, d / 2 - cut], [w / 2 - cut, d / 2], [-w / 2 + cut, d / 2], [-w / 2, d / 2 - cut], [-w / 2, -d / 2 + cut]]
        : [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
      return local.map(([u, v]) => [mx + t[0] * u + n[0] * v, mz + t[1] * u + n[1] * v]);
    };
    for (let s = 0; s < 4; s++) {
      const [n, t] = SIDES[s];
      const facing = n[0] * cam[0] + n[1] * cam[1];
      const cap = facing > 0.6 ? 7 : facing > 0.3 ? 24 : 999;
      for (let row = 0; row < 2; row++) {
        const front = HC + 2.5 + row * 30;
        const span = s % 2 === 0 ? (row ? HC + 46 : HC + 17) : (row ? HC + 31 : HC + 1.5);
        for (let u = -span; u < span - 5; ) {
          let w = 9 + rand() * 13;
          if (u + w > span) w = span - u;
          const ex = row === 0 ? exits[s].find((e) => e > u - 4 && e < u + w + 4) : undefined;
          if (ex !== undefined) { u = ex + 4.5; continue; }
          const d = row ? 14 + rand() * 14 : 10 + rand() * 12;
          const mx = cx + n[0] * (front + d / 2) + t[0] * (u + w / 2), mz = cz + n[1] * (front + d / 2) + t[1] * (u + w / 2);
          const h = Math.min(cap, row ? 30 + rand() * 55 : 16 + rand() * 36);
          const type = rand() < 0.5 ? 0 : rand() < 0.5 ? 1 : 2;
          const cut = rand() < 0.3 ? Math.min(w, d) * 0.18 : 0;
          id++;
          if (h > 20 && rand() < 0.4) {
            // a stone podium with a glass tower set back on it
            const ph = 5 + rand() * 3, inset = 1.5 + rand();
            part(foot(mx, mz, t, n, w, d, 0), Y, Y + ph, 1);
            part(foot(mx, mz, t, n, w - 2 * inset, d - 2 * inset, cut), Y + ph, Y + h, type === 1 ? 0 : type);
          } else if (h > 24 && rand() < 0.35) {
            // stepped back near the top
            const h1 = h * (0.7 + rand() * 0.12);
            part(foot(mx, mz, t, n, w, d, cut), Y, Y + h1, type);
            part(foot(mx, mz, t, n, w * 0.7, d * 0.7, cut * 0.7), Y + h1, Y + h, type);
          } else {
            part(foot(mx, mz, t, n, w, d, cut), Y, Y + h, type);
          }
          u += w + 1.5 + rand() * 3;
        }
      }
    }
  }

  // ── the ground: one textured plane with the pond cut out ─────────────────
  {
    const small = typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 600;
    const S = small ? 1024 : 2048;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const k = S / (2 * EXT); // pixels per world unit
    const px = (v: number) => (v + EXT) * k;
    const tile = (T: number, draw: (p: CanvasRenderingContext2D) => void) => {
      const t = document.createElement("canvas");
      t.width = t.height = T;
      draw(t.getContext("2d")!);
      return g.createPattern(t, "repeat")!;
    };
    const line = (pts: P[]) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z)))); };
    const poly = (pts: P[]) => { line(pts); g.closePath(); };

    // streets, then the sidewalk round the court
    g.fillStyle = "#0b120f";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#18201c";
    g.fillRect(px(cx - HC - 2.5), px(cz - HC - 2.5), (2 * HC + 5) * k, (2 * HC + 5) * k);
    g.strokeStyle = "rgba(255,255,255,0.05)";
    g.lineWidth = 1;
    for (let r = HC + 33; r < EXT; r += 30) g.strokeRect(px(cx - r), px(cz - r), 2 * r * k, 2 * r * k);
    // the court: small dashed pavers laid on a diagonal
    const pavers = tile(64, (p) => {
      p.fillStyle = "#1b2520";
      p.fillRect(0, 0, 64, 64);
      const tones = ["#25312b", "#2c3a33", "#202b25", "#34433a"];
      for (let i = 0; i < 80; i++) {
        const x = rand() * 64, y = rand() * 64, w = 4 + rand() * 7;
        p.fillStyle = tones[Math.floor(rand() * tones.length)];
        for (const ox of [-64, 0, 64]) for (const oy of [-64, 0, 64]) {
          p.beginPath();
          p.moveTo(x + ox, y + oy); p.lineTo(x + ox + w, y + oy); p.lineTo(x + ox + w + 1.5, y + oy + 1.8); p.lineTo(x + ox + 1.5, y + oy + 1.8);
          p.fill();
        }
      }
    });
    pavers.setTransform(new DOMMatrix().rotateSelf(0, 0, pick([0, 45, -30, 60])));
    g.fillStyle = pavers;
    g.fillRect(px(cx - HC), px(cz - HC), 2 * HC * k, 2 * HC * k);
    // the promenade: big slabs
    g.save();
    g.beginPath();
    g.rect(px(cx - HC), px(cz - HC), 2 * HC * k, 2 * HC * k);
    g.rect(px(cx - HC + PROM), px(cz - HC + PROM), 2 * (HC - PROM) * k, 2 * (HC - PROM) * k);
    g.clip("evenodd");
    g.fillStyle = "#222c27";
    g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(0,0,0,0.35)";
    for (let v = -EXT; v < EXT; v += 1.2) {
      g.beginPath(); g.moveTo(px(v), 0); g.lineTo(px(v), S); g.stroke();
      g.beginPath(); g.moveTo(0, px(v * 2)); g.lineTo(S, px(v * 2)); g.stroke();
    }
    g.restore();
    g.strokeStyle = "#3a4842";
    g.lineWidth = 0.15 * k;
    g.strokeRect(px(cx - HC + PROM), px(cz - HC + PROM), 2 * (HC - PROM) * k, 2 * (HC - PROM) * k);
    // sweeping inlaid arcs across the court
    g.save();
    g.beginPath();
    g.rect(px(cx - HC + PROM), px(cz - HC + PROM), 2 * (HC - PROM) * k, 2 * (HC - PROM) * k);
    g.clip();
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2, far = 50 + rand() * 70;
      const ox = cx + Math.cos(a) * far, oz = cz + Math.sin(a) * far, r = far + (rand() - 0.5) * HC;
      for (const [dr, w, s] of [[0, 0.32, "#34433b"], [0.9, 0.12, "#2c3a33"]] as const) {
        g.strokeStyle = s;
        g.lineWidth = w * k;
        g.beginPath(); g.arc(px(ox), px(oz), (r + dr) * k, 0, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
    // the plaza: pale slabs with joints radiating from the pond
    g.fillStyle = "#2a3630";
    g.fillRect(px(plaza.minX), px(plaza.minZ), 2 * hx * k, 2 * hz * k);
    g.save();
    g.beginPath(); g.rect(px(plaza.minX), px(plaza.minZ), 2 * hx * k, 2 * hz * k); g.clip();
    g.strokeStyle = "rgba(0,0,0,0.3)";
    g.lineWidth = 1;
    for (let a = rand(); a < Math.PI * 2; a += 0.12 + rand() * 0.1) {
      g.beginPath(); g.moveTo(px(cx), px(cz)); g.lineTo(px(cx + Math.cos(a) * 60), px(cz + Math.sin(a) * 60)); g.stroke();
    }
    for (let r = 2; r < 40; r += 1.6) { g.beginPath(); g.arc(px(cx), px(cz), r * k, 0, Math.PI * 2); g.stroke(); }
    g.restore();
    g.strokeStyle = "#4a5a52";
    g.lineWidth = 0.2 * k;
    g.strokeRect(px(plaza.minX), px(plaza.minZ), 2 * hx * k, 2 * hz * k);
    // the walks: dark setts between pale kerb lines, a faint glow at the edge
    const setts = tile(16, (p) => {
      p.fillStyle = "#121915";
      p.fillRect(0, 0, 16, 16);
      p.fillStyle = "#1a231e";
      for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) p.fillRect(x + ((y / 4) % 2) * 2, y, 3, 3);
    });
    g.lineJoin = "round";
    for (const sp of spines) {
      g.strokeStyle = setts;
      g.lineWidth = sp.w * k;
      line(sp.pts); g.stroke();
      const [L, R] = strip(sp.pts, sp.w / 2);
      for (const edge of [L, R]) {
        g.strokeStyle = "rgba(80,255,130,0.16)"; g.lineWidth = 0.6 * k; line(edge); g.stroke();
        g.strokeStyle = "#45544c"; g.lineWidth = 0.16 * k; line(edge); g.stroke();
      }
      // a slot drain along one side
      g.setLineDash([0.5 * k, 0.25 * k]);
      g.strokeStyle = "#070b09"; g.lineWidth = 0.1 * k;
      line(strip(sp.pts, sp.w / 2 - 0.45)[swirl > 0 ? 0 : 1]); g.stroke();
      g.setLineDash([]);
    }
    // tree grates
    for (const [x, z] of grates) {
      g.fillStyle = "#4a2c1a";
      g.fillRect(px(x - 0.8), px(z - 0.8), 1.6 * k, 1.6 * k);
      g.fillStyle = "#1e120a";
      for (let a = -0.6; a <= 0.6; a += 0.3) for (let b = -0.6; b <= 0.6; b += 0.3) g.fillRect(px(x + a) - 1, px(z + b) - 1, 2, 2);
    }
    // the rill's deck run-outs
    for (const d of decks) {
      g.save();
      g.translate(px(d.x), px(d.z));
      g.rotate(d.a + Math.PI / 2);
      g.fillStyle = "#3a2a1a";
      g.fillRect(-2.6 * k, -1.5 * k, 5.2 * k, 3 * k);
      g.strokeStyle = "rgba(0,0,0,0.4)";
      for (let v = -2.6; v < 2.6; v += 0.25) { g.beginPath(); g.moveTo(v * k, -1.5 * k); g.lineTo(v * k, 1.5 * k); g.stroke(); }
      g.restore();
    }
    // light baked onto the paving: pools under lamps, spill from light strips
    g.globalCompositeOperation = "lighter";
    for (const l of lamps) {
      const r = 3.2 * k, grd = g.createRadialGradient(px(l.x), px(l.z), 0, px(l.x), px(l.z), r);
      grd.addColorStop(0, "rgba(150,200,150,0.22)");
      grd.addColorStop(1, "rgba(150,200,150,0)");
      g.fillStyle = grd;
      g.fillRect(px(l.x) - r, px(l.z) - r, 2 * r, 2 * r);
    }
    for (const p of glowRings) {
      poly(offset(p, 0.35)); g.strokeStyle = "rgba(170,230,160,0.10)"; g.lineWidth = 0.7 * k; g.stroke();
      poly(offset(p, 0.12)); g.strokeStyle = "rgba(190,240,180,0.14)"; g.lineWidth = 0.25 * k; g.stroke();
    }
    g.globalCompositeOperation = "source-over";

    const tex = keep(new THREE.CanvasTexture(c));
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const shape = new THREE.Shape();
    shape.moveTo(-EXT, -EXT); shape.lineTo(EXT, -EXT); shape.lineTo(EXT, EXT); shape.lineTo(-EXT, EXT); shape.lineTo(-EXT, -EXT);
    const hole = new THREE.Path();
    hole.moveTo(basin.minX, basin.minZ); hole.lineTo(basin.minX, basin.maxZ); hole.lineTo(basin.maxX, basin.maxZ); hole.lineTo(basin.maxX, basin.minZ); hole.lineTo(basin.minX, basin.minZ);
    shape.holes.push(hole);
    const geo = keep(new THREE.ShapeGeometry(shape));
    const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getY(i);
      p.setXYZ(i, x, Y - 0.01, z);
      uv[i * 2] = (x + EXT) / (2 * EXT);
      uv[i * 2 + 1] = (z + EXT) / (2 * EXT);
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, keep(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))));
  }

  // ── meshes ───────────────────────────────────────────────────────────────
  function merged(parts: THREE.BufferGeometry[], edges = 0, edgeColor = GREEN) {
    const out = new THREE.Group();
    if (!parts.length) return out;
    const geo = keep(mergeGeometries(parts)!);
    for (const p of parts) p.dispose();
    out.add(new THREE.Mesh(geo, keep(new THREE.MeshBasicMaterial({ vertexColors: true }))));
    if (edges) out.add(new THREE.LineSegments(keep(new THREE.EdgesGeometry(geo, 30)), keep(new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edges }))));
    return out;
  }
  function lines(pos: number[], color: number, opacity = 1) {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })));
  }
  const dummy = new THREE.Object3D();
  const WHITE = new THREE.Color(1, 1, 1);
  type Item = { x: number; y?: number; z: number; s?: number; sy?: number; rot?: number; c?: THREE.Color };
  function instanced(geo: THREE.BufferGeometry, items: Item[], color: THREE.Color | null, wire = 0) {
    const g = keep(shade(geo, WHITE));
    const out = new THREE.Group();
    if (!items.length) return out;
    const mesh = new THREE.InstancedMesh(g, keep(new THREE.MeshBasicMaterial({ vertexColors: true, color: color ?? WHITE })), items.length);
    const w = wire ? new THREE.InstancedMesh(g, keep(new THREE.MeshBasicMaterial({ color: GREEN, wireframe: true, transparent: true, opacity: wire })), items.length) : null;
    items.forEach((it, i) => {
      dummy.position.set(it.x, Y + (it.y ?? 0), it.z);
      dummy.rotation.set(0, it.rot ?? 0, 0);
      const s = it.s ?? 1;
      dummy.scale.set(s, s * (it.sy ?? 1), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      w?.setMatrixAt(i, dummy.matrix);
      if (it.c) mesh.setColorAt(i, it.c);
    });
    out.add(mesh);
    if (w) out.add(w);
    return out;
  }

  const near = new THREE.Group(); // everything on the court
  near.add(merged(curbParts, 0.22));
  near.add(merged(greenParts));
  if (ledLines.length) near.add(lines(ledLines, 0xe0ffd4, 0.9));
  if (brass.length) near.add(lines(brass, 0xc8a860, 0.8));
  near.add(instanced(new THREE.IcosahedronGeometry(1, 1), shrubs, null));
  near.add(instanced(new THREE.ConeGeometry(0.2, 0.9, 4).translate(0, 0.45, 0), grasses, null));
  {
    // trees: slim trunks, airy three-lobed crowns or narrow conifers
    near.add(instanced(new THREE.CylinderGeometry(0.07, 0.11, 2.4, 5).translate(0, 1.2, 0), trees.map(({ x, y, z, s }) => ({ x, y, z, s })), col(0x4a3a24)));
    const lobes = mergeGeometries([
      new THREE.IcosahedronGeometry(0.85, 1).translate(0, 3.0, 0),
      new THREE.IcosahedronGeometry(0.7, 1).translate(0.5, 2.55, 0.2),
      new THREE.IcosahedronGeometry(0.65, 1).translate(-0.45, 2.6, -0.25),
    ])!;
    const pine = mergeGeometries([
      new THREE.ConeGeometry(0.75, 2.4, 7).translate(0, 2.2, 0).toNonIndexed(),
      new THREE.ConeGeometry(0.5, 1.5, 7).translate(0, 3.4, 0).toNonIndexed(),
    ])!;
    near.add(instanced(lobes, trees.filter((t) => t.kind === 0).map((t) => ({ ...t, rot: t.x * 7 })), null, 0.1));
    near.add(instanced(pine, trees.filter((t) => t.kind === 1), null, 0.1));
  }
  {
    // benches: a timber slab on two stone blocks
    const bench = mergeGeometries([
      new THREE.BoxGeometry(2.2, 0.12, 0.6).translate(0, 0.44, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.2, 0.38, 0.5).translate(-0.8, 0.19, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.2, 0.38, 0.5).translate(0.8, 0.19, 0).toNonIndexed(),
    ])!;
    near.add(instanced(bench, benches, col(0x7a5530)));
    near.add(instanced(new THREE.CylinderGeometry(1, 1, 0.45, 20).translate(0, 0.225, 0), seats.map((s) => ({ ...s, s: s.r, sy: 1 / s.r })), col(0x7a5530)));
    near.add(instanced(new THREE.CylinderGeometry(0.5, 0.42, 0.75, 12).translate(0, 0.375, 0), pots, col(0x1e2622)));
    // lamps: a slim pole with a small arm, the head glowing
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.05, 0.065, 4.6, 6).translate(0, 2.3, 0).toNonIndexed(),
      new THREE.BoxGeometry(0.55, 0.06, 0.08).translate(0.25, 4.55, 0).toNonIndexed(),
    ])!;
    near.add(instanced(pole, lamps, col(0x3a4842)));
    const head = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.34, 0.07, 0.16).translate(0.4, 4.5, 0)), keep(new THREE.MeshBasicMaterial({ color: 0xeaffdc })), Math.max(1, lamps.length));
    head.count = lamps.length;
    lamps.forEach((l, i) => { dummy.position.set(l.x, Y, l.z); dummy.rotation.set(0, l.rot, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); head.setMatrixAt(i, dummy.matrix); });
    near.add(head);
  }
  // the terrace and its kiosk
  near.add(merged(terraceParts, 0.3));
  if (kiosk) near.add(kiosk);

  // the rill: walls, decks, and the water in it
  let waterMat: THREE.ShaderMaterial | null = null;
  if (rillPts.length > 1) {
    const [Lo, Ro] = strip(rillPts, RW / 2 + RT);
    // the inner channel stops short of each end, so the ends are walled
    const pts = rillPts.map((q) => [...q] as P);
    const n = pts.length - 1;
    const d0 = segNormal(pts[0], pts[1]), d1 = segNormal(pts[n - 1], pts[n]);
    pts[0] = [pts[0][0] + d0[1] * RT, pts[0][1] - d0[0] * RT];
    pts[n] = [pts[n][0] - d1[1] * RT, pts[n][1] + d1[0] * RT];
    const [Li, Ri] = strip(pts, RW / 2);
    const parts = [
      shade(prism([...Lo, ...[...Ro].reverse()], [...Li, ...[...Ri].reverse()], Y, Y + RH), col(0x68756e)),
      shade(flat([...Li, ...[...Ri].reverse()], Y + 0.05), col(0x0a1210)),
    ];
    for (const d of decks) {
      const deck = new THREE.BoxGeometry(3, 0.14, RW + 2 * RT + 1.6).toNonIndexed();
      deck.rotateY(-d.a);
      deck.translate(d.x, Y + RH + 0.07, d.z);
      parts.push(shade(deck, col(0x7a5530)));
    }
    near.add(merged(parts, 0.25));
    // water: a strip along the channel, uv.x = distance along, uv.y = across
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      pos.push(Li[i][0], Y + RH - 0.09, Li[i][1], Ri[i][0], Y + RH - 0.09, Ri[i][1]);
      uv.push(run, 0, run, 1);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    const wg = keep(new THREE.BufferGeometry());
    wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    wg.setIndex(idx);
    waterMat = keep(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      fog: true,
      side: THREE.DoubleSide,
      vertexShader: `
        ${FOG_VERT}
        varying vec2 vUv;
        void main(){
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        ${FOG_FRAG}
        uniform float uTime; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          float flow = vUv.x * 1.3 - uTime * 0.9;
          float rip = sin(flow * 6.0 + sin(vUv.y * 7.0 + flow) * 1.5) * 0.5 + 0.5;
          vec2 cell = floor(vec2(vUv.x * 4.0 - uTime * 2.4, vUv.y * 6.0));
          float glint = step(0.93, hash(cell)) * (1.0 - abs(vUv.y - 0.5) * 1.6);
          vec3 c = mix(vec3(0.02, 0.07, 0.07), vec3(0.06, 0.2, 0.17), rip * 0.6);
          c += vec3(0.5, 1.0, 0.7) * glint * 0.55;
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`,
    }));
    near.add(new THREE.Mesh(wg, waterMat));
  }
  group.add(near);
  risers.push([near, 0]);

  // towers: one mesh; the shader draws curtain walls, punched windows or fins
  if (towerParts.length) {
    const geo = keep(mergeGeometries(towerParts)!);
    for (const p of towerParts) p.dispose();
    const mat = keep(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uY: { value: Y } }]),
      fog: true,
      vertexShader: `
        ${FOG_VERT}
        attribute float aId; attribute float aType;
        varying vec3 vW; varying vec3 vN; varying float vId; varying float vT;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normal; vId = aId; vT = aType;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        ${FOG_FRAG}
        uniform float uY;
        varying vec3 vW; varying vec3 vN; varying float vId; varying float vT;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main(){
          vec3 key = normalize(vec3(-6.0, 14.0, 8.0));
          float light = 0.55 + 0.25 * (0.5 * vN.y + 0.5) + 0.3 * max(0.0, dot(vN, key));
          vec3 c;
          if (vN.y > 0.5) {
            c = vec3(0.06, 0.09, 0.08) * light; // roofs
          } else {
            vec2 t2 = normalize(vec2(-vN.z, vN.x));
            float along = dot(vW.xz, t2), h = vW.y - uY;
            float sky = clamp(h / 70.0, 0.0, 1.0);
            if (vT < 0.5) {
              // glass curtain wall: thin mullions, spandrels, reflections, some lit offices
              vec2 cell = vec2(floor(along / 1.5), floor(h / 3.6)), f = vec2(fract(along / 1.5), fract(h / 3.6));
              vec3 glass = mix(vec3(0.03, 0.08, 0.075), vec3(0.11, 0.25, 0.22), sky);
              glass *= 0.75 + 0.5 * hash(vec3(cell.x, floor(h / 13.0), vId));
              glass = mix(glass, vec3(0.75, 0.95, 0.62), step(0.84, hash(vec3(cell, vId))) * 0.55);
              float frame = max(step(f.x, 0.06), step(f.y, 0.08));
              c = mix(glass * light, vec3(0.02, 0.04, 0.035), frame);
            } else if (vT < 1.5) {
              // stone with punched windows, many lit warm
              vec2 cell = vec2(floor(along / 1.6), floor(h / 3.4)), f = vec2(fract(along / 1.6), fract(h / 3.4));
              float win = step(0.26, f.x) * step(f.x, 0.74) * step(0.22, f.y) * step(f.y, 0.78);
              vec3 lit = mix(vec3(0.03, 0.05, 0.045), vec3(0.95, 0.9, 0.55), step(0.5, hash(vec3(cell, vId))) * 0.8);
              c = mix(vec3(0.17, 0.21, 0.19) * light, lit, win);
            } else {
              // glass between dark vertical fins
              float fa = fract(along / 3.0);
              vec2 cell = vec2(floor(along / 1.0), floor(h / 3.6));
              vec3 glass = mix(vec3(0.04, 0.1, 0.09), vec3(0.14, 0.3, 0.26), sky) * (0.8 + 0.4 * hash(vec3(floor(along / 3.0), 0.0, vId)));
              glass = mix(glass, vec3(0.7, 0.95, 0.65), step(0.88, hash(vec3(cell, vId))) * 0.5);
              c = mix(glass * light, vec3(0.015, 0.025, 0.02), step(fa, 0.14));
            }
            // lit lobbies along the street
            c = mix(c, vec3(0.45, 0.75, 0.5), step(h, 4.0) * step(0.1, fract(along / 3.0)) * 0.7);
          }
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`,
    }));
    const towers = new THREE.Group();
    towers.add(new THREE.Mesh(geo, mat));
    towers.add(new THREE.LineSegments(keep(new THREE.EdgesGeometry(geo, 30)), keep(new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.28 }))));
    group.add(towers);
    risers.push([towers, HC]);
  }

  return {
    group,
    update(time, s) {
      group.visible = s > 0.002;
      // rise into place: the court first, the towers last
      for (const [o, r] of risers) o.scale.y = Math.max(0.001, ease((s - 0.15 - Math.min(0.35, r / 200)) / 0.5));
      if (waterMat) waterMat.uniforms.uTime.value = time;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
