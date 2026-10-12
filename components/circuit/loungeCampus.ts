// The campus around the Lounge's koi pond: a big, clean, modern corporate
// open space with the pond as its centrepiece. Procedural and cheap: one
// seeded RNG (the seed is a timestamp, so each load lays out a new campus),
// a handful of draw calls, nothing animated per object.
//   ground      one plane with a hole for the pond, painted once on a canvas:
//               lawns, a paved plaza round the pond, walkways out from it,
//               diagonal paths and two ring promenades, edges glowing faintly
//   buildings   minimal blocks, some stepped, on lots clear of every path;
//               merged into one mesh whose shader draws the window bands,
//               plus one set of glowing edges
//   nature      trees in rows along the walkways and small groves on the
//               lawns, clipped round crowns, not overgrown (instanced)
//   furniture   benches between the trees, lamp posts round the inner ring
//   colonnade   a covered walkway: pillars and a roof over one path
// Everything sits on the plaza level (`rim`) and rises into place, nearest
// first, as the camera tilts into the Lounge.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const GREEN = 0x33ff33;

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Campus {
  group: THREE.Group;
  update(time: number, s: number): void;
  dispose(): void;
}

function rng(seed: number) {
  let x = (seed >>> 0) || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

// Light baked into vertex colours (the scene has no lights): cool sky from
// above, a key light from the front left, in linear colour.
const KEY = new THREE.Vector3(-6, 14, 8).normalize();
function shade(geo: THREE.BufferGeometry, color: THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const n = g.attributes.normal, col = new Float32Array(n.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    const k = 0.35 + 0.35 * (0.5 * v.y + 0.5) + 0.45 * Math.max(0, v.dot(KEY));
    col[i * 3] = color.r * k; col[i * 3 + 1] = color.g * k; col[i * 3 + 2] = color.b * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

// `diorama`: the pond with its rock and patio, which the plaza surrounds;
// `basin`: the pond's outer walls, cut out of the ground.
export function buildCampus(diorama: Bounds, basin: Bounds, rim: number, seed: number): Campus {
  const rand = rng(seed);
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const Y = rim; // plaza level: the top of the pond's walls

  // ── layout: the paths, as shapes the placement tests against ─────────────
  const EXT = 95; // the ground runs this far each way; fog swallows the edge
  const margin = 4.5;
  const plaza = { minX: diorama.minX - margin, maxX: diorama.maxX + margin, minZ: diorama.minZ - margin, maxZ: diorama.maxZ + margin };
  const cx = (plaza.minX + plaza.maxX) / 2, cz = (plaza.minZ + plaza.maxZ) / 2;
  const AXIS_W = 3.4, DIAG_W = 2.4;
  const R1 = Math.max(plaza.maxX - cx, plaza.maxZ - cz) + 6 + rand() * 3; // inner promenade
  const R2 = R1 + 24 + rand() * 8; // outer promenade
  const RING_W = 2.8;
  const diagAngles = [45, 135, 225, 315].map((d) => ((d + (rand() - 0.5) * 20) * Math.PI) / 180);
  const inPlaza = (x: number, z: number, m = 0) => x > plaza.minX - m && x < plaza.maxX + m && z > plaza.minZ - m && z < plaza.maxZ + m;
  // distance from (x, z) to the nearest path centreline, minus its half-width
  function pathGap(x: number, z: number) {
    const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz);
    let g = Math.min(Math.abs(dz) - AXIS_W / 2, Math.abs(dx) - AXIS_W / 2);
    for (const a of diagAngles) {
      // only the part of each diagonal beyond the plaza, out to the outer ring
      const along = dx * Math.cos(a) + dz * Math.sin(a);
      if (along > 0 && along < R2 + 4) g = Math.min(g, Math.abs(-dx * Math.sin(a) + dz * Math.cos(a)) - DIAG_W / 2);
    }
    g = Math.min(g, Math.abs(r - R1) - RING_W / 2, Math.abs(r - R2) - RING_W / 2);
    return g;
  }
  const clearOfPaths = (x: number, z: number, m: number) => pathGap(x, z) > m && !inPlaza(x, z, m);

  // ── ground: one textured plane with the pond cut out ─────────────────────
  {
    const S = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const px = (x: number) => ((x + EXT) / (2 * EXT)) * S;
    const k = S / (2 * EXT); // pixels per world unit
    // lawn, with faint mowing stripes
    g.fillStyle = "#07170c";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "rgba(20, 60, 30, 0.35)";
    for (let i = 0; i < S; i += 12) g.fillRect(i, 0, 6, S);
    const pave = "#1a2a20", edge = "rgba(51,255,51,0.5)";
    // a band of walkway along a segment, with glowing borders
    function band(x0: number, z0: number, x1: number, z1: number, w: number) {
      g.lineCap = "butt";
      g.strokeStyle = edge; g.lineWidth = (w + 0.25) * k;
      g.beginPath(); g.moveTo(px(x0), px(z0)); g.lineTo(px(x1), px(z1)); g.stroke();
      g.strokeStyle = pave; g.lineWidth = (w - 0.1) * k;
      g.beginPath(); g.moveTo(px(x0), px(z0)); g.lineTo(px(x1), px(z1)); g.stroke();
    }
    function ring(r: number, w: number) {
      g.strokeStyle = edge; g.lineWidth = (w + 0.25) * k;
      g.beginPath(); g.arc(px(cx), px(cz), r * k, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = pave; g.lineWidth = (w - 0.1) * k;
      g.beginPath(); g.arc(px(cx), px(cz), r * k, 0, Math.PI * 2); g.stroke();
    }
    band(-EXT, cz, EXT, cz, AXIS_W);
    band(cx, -EXT, cx, EXT, AXIS_W);
    for (const a of diagAngles) band(cx, cz, cx + Math.cos(a) * (R2 + 4), cz + Math.sin(a) * (R2 + 4), DIAG_W);
    ring(R1, RING_W);
    ring(R2, RING_W);
    // the plaza: paving in a fine grid, a glowing border
    g.fillStyle = edge;
    g.fillRect(px(plaza.minX) - 2, px(plaza.minZ) - 2, (plaza.maxX - plaza.minX) * k + 4, (plaza.maxZ - plaza.minZ) * k + 4);
    g.fillStyle = "#1e3025";
    g.fillRect(px(plaza.minX), px(plaza.minZ), (plaza.maxX - plaza.minX) * k, (plaza.maxZ - plaza.minZ) * k);
    g.strokeStyle = "rgba(51,255,51,0.12)";
    g.lineWidth = 1;
    for (let x = Math.ceil(plaza.minX); x < plaza.maxX; x += 1.5) { g.beginPath(); g.moveTo(px(x), px(plaza.minZ)); g.lineTo(px(x), px(plaza.maxZ)); g.stroke(); }
    for (let z = Math.ceil(plaza.minZ); z < plaza.maxZ; z += 1.5) { g.beginPath(); g.moveTo(px(plaza.minX), px(z)); g.lineTo(px(plaza.maxX), px(z)); g.stroke(); }
    const tex = keep(new THREE.CanvasTexture(c));
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    // the plane, with a hole where the pond's basin is
    const shape = new THREE.Shape();
    shape.moveTo(-EXT, -EXT); shape.lineTo(EXT, -EXT); shape.lineTo(EXT, EXT); shape.lineTo(-EXT, EXT); shape.lineTo(-EXT, -EXT);
    const hole = new THREE.Path();
    hole.moveTo(basin.minX, basin.minZ); hole.lineTo(basin.minX, basin.maxZ); hole.lineTo(basin.maxX, basin.maxZ); hole.lineTo(basin.maxX, basin.minZ); hole.lineTo(basin.minX, basin.minZ);
    shape.holes.push(hole);
    const geo = keep(new THREE.ShapeGeometry(shape));
    // shape (x, y) → ground (x, z = y), uv from world position
    const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getY(i);
      p.setXYZ(i, x, Y - 0.01, z);
      uv[i * 2] = (x + EXT) / (2 * EXT);
      uv[i * 2 + 1] = (z + EXT) / (2 * EXT);
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, keep(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
    group.add(ground);
  }

  // things that rise into place: [object, its distance from the centre]
  const risers: [THREE.Object3D, number][] = [];

  // ── buildings ────────────────────────────────────────────────────────────
  const lots: { x: number; z: number; w: number; d: number }[] = [];
  const inLot = (x: number, z: number, m: number) => lots.some((l) => Math.abs(x - l.x) < l.w / 2 + m && Math.abs(z - l.z) < l.d / 2 + m);
  {
    const overlaps = (a: { x: number; z: number; w: number; d: number }) =>
      lots.some((b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 3 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + 3);
    const parts: THREE.BufferGeometry[] = [];
    const bid: number[] = [];
    let tries = 0;
    while (lots.length < 26 && tries++ < 900) {
      // nearer lots first, so the ring of buildings round the open centre fills
      const r = R1 + 4 + Math.pow(rand(), 1.6) * (EXT - R1 - 12), a = rand() * Math.PI * 2;
      const lot = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, w: 8 + rand() * 12, d: 8 + rand() * 12 };
      // every corner and the middle clear of the paths, and of other lots
      const pts = [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, -0.5], [0, 0.5], [-0.5, 0], [0.5, 0]];
      if (!pts.every(([u, v]) => clearOfPaths(lot.x + u * lot.w, lot.z + v * lot.d, 4))) continue;
      if (overlaps(lot)) continue;
      lots.push(lot);
      // a block, sometimes stepped back in tiers, sometimes on a lifted podium
      const tiers = rand() < 0.45 ? 1 + Math.floor(rand() * 2) : 0;
      let h0 = 6 + rand() * 14, w = lot.w, d = lot.d, y = Y;
      for (let t = 0; t <= tiers; t++) {
        const b = new THREE.BoxGeometry(w, h0, d).toNonIndexed();
        b.translate(lot.x, y + h0 / 2, lot.z);
        parts.push(b);
        bid.push(lots.length + t * 0.37);
        y += h0;
        h0 *= 0.55 + rand() * 0.3;
        w *= 0.6 + rand() * 0.2;
        d *= 0.6 + rand() * 0.2;
      }
    }
    if (parts.length) {
      // per-building id, so each lights its own windows
      for (let i = 0; i < parts.length; i++) {
        const n = parts[i].attributes.position.count;
        parts[i].setAttribute("aId", new THREE.BufferAttribute(new Float32Array(n).fill(bid[i]), 1));
      }
      const geo = keep(mergeGeometries(parts)!);
      for (const p of parts) p.dispose();
      const mat = keep(new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          attribute float aId;
          varying vec3 vW; varying vec3 vN; varying float vId;
          void main(){
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz; vN = normal; vId = aId;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: `
          uniform float uTime;
          varying vec3 vW; varying vec3 vN; varying float vId;
          float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          void main(){
            vec3 key = normalize(vec3(-6.0, 14.0, 8.0));
            float light = 0.35 + 0.3 * (0.5 * vN.y + 0.5) + 0.35 * max(0.0, dot(vN, key));
            vec3 base = vec3(0.07, 0.12, 0.095) * light;
            if (abs(vN.y) < 0.5) {
              // facades: floor bands and window columns, some windows lit
              float along = abs(vN.x) > 0.5 ? vW.z : vW.x;
              vec2 cell = vec2(floor(along / 1.3), floor(vW.y / 1.15));
              vec2 f = vec2(fract(along / 1.3), fract(vW.y / 1.15));
              float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
              float lit = step(0.62, hash(vec3(cell, vId)));
              vec3 glass = mix(vec3(0.02, 0.07, 0.05), vec3(0.45, 1.0, 0.6), lit * 0.55);
              base = mix(base, glass, win * 0.9);
              // a bright floor line every level
              base += vec3(0.05, 0.25, 0.08) * (1.0 - smoothstep(0.0, 0.05, f.y));
            } else if (vN.y > 0.5) {
              base = vec3(0.07, 0.12, 0.09); // roofs
            }
            gl_FragColor = vec4(base, 1.0);
          }`,
      }));
      const mesh = new THREE.Mesh(geo, mat);
      const lines = new THREE.LineSegments(keep(new THREE.EdgesGeometry(geo, 30)), keep(new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.55 })));
      const bGroup = new THREE.Group();
      bGroup.add(mesh, lines);
      group.add(bGroup);
      risers.push([bGroup, R1 + 4]);
      (group.userData as { buildingMat?: THREE.ShaderMaterial }).buildingMat = mat;
    }
  }

  // ── trees, benches, lamps: instanced ─────────────────────────────────────
  const trees: { x: number; z: number; s: number; tone: number }[] = [];
  const benches: { x: number; z: number; rot: number }[] = [];
  const lamps: { x: number; z: number }[] = [];
  const free = (x: number, z: number, m: number) => !inPlaza(x, z, m) && !inLot(x, z, m + 1) && Math.abs(x) < EXT - 4 && Math.abs(z) < EXT - 4;
  const notOnPath = (x: number, z: number, m: number) => pathGap(x, z) > m;
  // rows along the two axes, both sides, out from the plaza
  for (const [dirX, dirZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const start = dirX ? (dirX > 0 ? plaza.maxX - cx : cx - plaza.minX) + 3 : (dirZ > 0 ? plaza.maxZ - cz : cz - plaza.minZ) + 3;
    for (let t = start; t < EXT - 6; t += 6.5) {
      for (const side of [-1, 1]) {
        const off = AXIS_W / 2 + 1.7;
        const x = cx + dirX * t + (dirX ? 0 : side * off), z = cz + dirZ * t + (dirZ ? 0 : side * off);
        if (!free(x, z, 1) || Math.abs(Math.hypot(x - cx, z - cz) - R1) < RING_W / 2 + 1.5 || Math.abs(Math.hypot(x - cx, z - cz) - R2) < RING_W / 2 + 1.5) continue;
        trees.push({ x, z, s: 0.9 + rand() * 0.25, tone: rand() });
        // a bench in every other gap, facing the walkway
        if (Math.floor(t / 6.5) % 2 === 0) {
          const bx = cx + dirX * (t + 3.25) + (dirX ? 0 : side * (AXIS_W / 2 + 0.9));
          const bz = cz + dirZ * (t + 3.25) + (dirZ ? 0 : side * (AXIS_W / 2 + 0.9));
          if (free(bx, bz, 0.5)) benches.push({ x: bx, z: bz, rot: dirX ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
        }
      }
    }
  }
  // lamps and trees round the inner promenade
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const x = cx + Math.cos(a) * (R1 + RING_W / 2 + 1), z = cz + Math.sin(a) * (R1 + RING_W / 2 + 1);
    if (!notOnPath(x, z, 0.6) || !free(x, z, 0)) continue;
    if (i % 2) lamps.push({ x, z });
    else trees.push({ x, z, s: 0.85 + rand() * 0.3, tone: rand() });
  }
  // groves on the lawns between the rings: small clusters, clear of paths
  for (let gi = 0; gi < 22; gi++) {
    const a = rand() * Math.PI * 2, r = R1 + 5 + rand() * (R2 - R1 - 8);
    const gx = cx + Math.cos(a) * r, gz = cz + Math.sin(a) * r;
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const x = gx + (rand() - 0.5) * 6, z = gz + (rand() - 0.5) * 6;
      if (notOnPath(x, z, 1.4) && free(x, z, 2)) trees.push({ x, z, s: 0.8 + rand() * 0.5, tone: rand() });
    }
  }

  const dummy = new THREE.Object3D();
  function instanced(geo: THREE.BufferGeometry, color: THREE.Color, items: { x: number; z: number }[], place: (i: number, o: THREE.Object3D) => void, opts: { tint?: (i: number) => THREE.Color; wire?: number } = {}) {
    const g = keep(shade(geo, color));
    const mesh = new THREE.InstancedMesh(g, keep(new THREE.MeshBasicMaterial({ vertexColors: true })), items.length);
    const wire = opts.wire ? new THREE.InstancedMesh(g, keep(new THREE.MeshBasicMaterial({ color: GREEN, wireframe: true, transparent: true, opacity: opts.wire })), items.length) : null;
    for (let i = 0; i < items.length; i++) {
      dummy.position.set(items[i].x, Y, items[i].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      place(i, dummy);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      wire?.setMatrixAt(i, dummy.matrix);
      if (opts.tint) mesh.setColorAt(i, opts.tint(i));
    }
    const out = new THREE.Group();
    out.add(mesh);
    if (wire) out.add(wire);
    return out;
  }
  const leafTones = [new THREE.Color(0x10401f), new THREE.Color(0x154a26), new THREE.Color(0x0e3a1c), new THREE.Color(0x1a5230)];
  if (trees.length) {
    const treeGroup = new THREE.Group();
    treeGroup.add(instanced(new THREE.CylinderGeometry(0.12, 0.16, 1.6, 6).translate(0, 0.8, 0), new THREE.Color(0x3a2e1a), trees, (i, o) => o.scale.setScalar(trees[i].s)));
    // a clipped, slightly flattened round crown
    treeGroup.add(instanced(new THREE.IcosahedronGeometry(1.15, 1).scale(1, 0.85, 1).translate(0, 2.4, 0), new THREE.Color(1, 1, 1), trees,
      (i, o) => o.scale.setScalar(trees[i].s),
      { tint: (i) => leafTones[Math.floor(trees[i].tone * leafTones.length)], wire: 0.12 }));
    group.add(treeGroup);
    risers.push([treeGroup, 0]);
  }
  if (benches.length) {
    const seat = new THREE.BoxGeometry(1.8, 0.1, 0.45).translate(0, 0.45, 0);
    const back = new THREE.BoxGeometry(1.8, 0.45, 0.08).translate(0, 0.72, -0.2);
    const legs = new THREE.BoxGeometry(1.6, 0.4, 0.35).translate(0, 0.2, 0);
    const bench = mergeGeometries([seat.toNonIndexed(), back.toNonIndexed(), legs.toNonIndexed()])!;
    const bg = instanced(bench, new THREE.Color(0x5a4a2e), benches, (i, o) => { o.rotation.y = benches[i].rot; });
    group.add(bg);
    risers.push([bg, 0]);
  }
  if (lamps.length) {
    const post = new THREE.CylinderGeometry(0.05, 0.07, 3, 6).translate(0, 1.5, 0);
    const lampGroup = instanced(post, new THREE.Color(0x30403a), lamps, () => {});
    const glow = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.18, 8, 6).translate(0, 3.05, 0)), keep(new THREE.MeshBasicMaterial({ color: 0xc8ffd0 })), lamps.length);
    lamps.forEach((l, i) => { dummy.position.set(l.x, Y, l.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); glow.setMatrixAt(i, dummy.matrix); });
    lampGroup.add(glow);
    group.add(lampGroup);
    risers.push([lampGroup, R1]);
  }

  // ── colonnade: a covered walkway over one axis, out from the plaza ───────
  {
    const dir = Math.floor(rand() * 4);
    const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
    const start = dx ? (dx > 0 ? plaza.maxX - cx : cx - plaza.minX) + 1 : (dz > 0 ? plaza.maxZ - cz : cz - plaza.minZ) + 1;
    const len = Math.min(R1 - start - 2, 26);
    if (len > 6) {
      const parts: THREE.BufferGeometry[] = [];
      const half = AXIS_W / 2 + 0.5;
      for (let t = 0; t <= len; t += 4) {
        for (const side of [-1, 1]) {
          const x = cx + dx * (start + t) + (dx ? 0 : side * half), z = cz + dz * (start + t) + (dz ? 0 : side * half);
          parts.push(new THREE.BoxGeometry(0.3, 3.4, 0.3).toNonIndexed().translate(x, Y + 1.7, z));
        }
      }
      const mid = start + len / 2;
      const roof = new THREE.BoxGeometry(dx ? len + 1 : 2 * half + 1.2, 0.25, dz ? len + 1 : 2 * half + 1.2).toNonIndexed();
      roof.translate(cx + dx * mid, Y + 3.5, cz + dz * mid);
      parts.push(roof);
      const geo = keep(shade(mergeGeometries(parts)!, new THREE.Color(0x2a4034)));
      for (const p of parts) p.dispose();
      const colonnade = new THREE.Group();
      colonnade.add(new THREE.Mesh(geo, keep(new THREE.MeshBasicMaterial({ vertexColors: true }))));
      colonnade.add(new THREE.LineSegments(keep(new THREE.EdgesGeometry(geo, 30)), keep(new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.6 }))));
      group.add(colonnade);
      risers.push([colonnade, 0]);
    }
  }

  const buildingMat = (group.userData as { buildingMat?: THREE.ShaderMaterial }).buildingMat;
  return {
    group,
    update(time, s) {
      group.visible = s > 0.002;
      // rise into place: the near pieces first, the outer buildings last
      for (const [o, r] of risers) o.scale.y = Math.max(0.001, ease((s - 0.15 - Math.min(0.35, r / 200)) / 0.5));
      if (buildingMat) buildingMat.uniforms.uTime.value = time;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
