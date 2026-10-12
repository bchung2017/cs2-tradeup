// The Lounge's scenery around the pond, in the background's phosphor style:
// dark, flat-shaded solids with glowing green edges.
//   rock face   behind the pond, about eye height, jagged low-poly blocks
//   waterfall   off the rock lip into the pond: streaming sheet, foam, mist
//   bonsai      a large twisting tree growing out of the side of the rock
//   patio       a brick terrace on the right with a bench facing the water
//   ramp        an S-curved stone ramp from the patio, across the pond between
//               the waterfall and the koi, up to the rock top; over the water
//               it stands on an aqueduct wall with a semicircular arch
// Everything is placed relative to the pond (x across, z front-to-back, y up,
// floor at y = 0) and rises into place as the camera tilts (`update(s)`).
import * as THREE from "three";

const GREEN = 0x33ff33;
const DIM_GREEN = 0x19a019;

export interface Scenery {
  group: THREE.Group;
  impact: THREE.Vector2; // where the waterfall meets the water (x, z)
  update(time: number, s: number): void;
  dispose(): void;
}

// deterministic jitter, so the scenery is the same on every visit
function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

export function buildScenery(W: number, D: number, rim: number, waterY: number): Scenery {
  const group = new THREE.Group();
  // side pieces (patio, bench, ramp offsets) shrink with a narrow pond: in
  // portrait the pond is about half as wide as it is deep
  const sc = Math.min(1, Math.max(0.5, W / 14));
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const rand = rng(9000);

  const stone = keep(new THREE.MeshLambertMaterial({ color: 0x0c1a12, flatShading: true }));
  const darkStone = keep(new THREE.MeshLambertMaterial({ color: 0x08120c, flatShading: true }));
  const leaf = keep(new THREE.MeshLambertMaterial({ color: 0x0d3a1c, flatShading: true, emissive: 0x041a08 }));
  const bark = keep(new THREE.MeshLambertMaterial({ color: 0x1a1408, flatShading: true }));
  const edge = keep(new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.85 }));
  const edgeDim = keep(new THREE.LineBasicMaterial({ color: DIM_GREEN, transparent: true, opacity: 0.6 }));
  const edgeMats = [edge, edgeDim];

  // a mesh plus its glowing outline, as one unit
  function solid(geo: THREE.BufferGeometry, mat: THREE.Material, lines = edge, angle = 24) {
    keep(geo);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    g.add(new THREE.LineSegments(keep(new THREE.EdgesGeometry(geo, angle)), lines));
    return g;
  }
  // roughen a box into a rock: jitter its vertices, keep faces flat-shaded
  function crag(w: number, h: number, d: number, amt: number) {
    const geo = new THREE.BoxGeometry(w, h, d, 3, 4, 2);
    const pos = geo.attributes.position;
    const shift = new Map<string, [number, number, number]>();
    for (let i = 0; i < pos.count; i++) {
      // vertices shared by faces must move together or the box cracks open
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!shift.has(k)) shift.set(k, [(rand() - 0.5) * amt, (rand() - 0.5) * amt * 0.7, (rand() - 0.5) * amt]);
      const [dx, dy, dz] = shift.get(k)!;
      pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // ── rock face ────────────────────────────────────────────────────────────
  const ROCK_H = 4.6; // about eye height for someone on the patio
  const back = -D / 2 - 0.35; // behind the pond's back wall
  const rock = new THREE.Group();
  let x = -W / 2 - 1.2;
  const rockEnd = W * 0.34;
  while (x < rockEnd) {
    const w = 1.6 + rand() * 1.6;
    const h = ROCK_H * (0.82 + rand() * 0.3);
    const d = 2.2 + rand() * 1.4;
    const block = solid(crag(w, h, d, 0.55), rand() > 0.5 ? stone : darkStone);
    block.position.set(x + w / 2, h / 2 - 0.3, back - d / 2 + 0.6);
    block.rotation.y = (rand() - 0.5) * 0.25;
    rock.add(block);
    x += w * 0.78;
  }
  // a flat-ish top for the ramp to land on, and ledges stepping down the face
  const cap = solid(crag(W * 0.5, 0.5, 3.2, 0.25), stone);
  cap.position.set(-W * 0.02, ROCK_H + 0.05, back - 1.2);
  rock.add(cap);
  for (let i = 0; i < 4; i++) {
    const ledge = solid(crag(1.4 + rand(), 0.5, 1.0, 0.3), darkStone, edgeDim);
    ledge.position.set(-W / 2 + rand() * W * 0.8, 1.2 + rand() * 2.2, back + 0.55);
    rock.add(ledge);
  }
  group.add(rock);

  // ── waterfall ────────────────────────────────────────────────────────────
  const fallX = -W * 0.2;
  const fallTop = ROCK_H + 0.1;
  const lipZ = back + 0.75;
  const impact = new THREE.Vector2(fallX, lipZ + 0.9);
  const fallGeo = keep(new THREE.PlaneGeometry(2.4, fallTop - waterY, 1, 24));
  {
    // bow the sheet outward: water leaves the lip forward and drops
    const p = fallGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = 1 - (p.getY(i) / (fallTop - waterY) + 0.5); // 0 at the lip, 1 at the water
      p.setZ(i, 0.9 * Math.sqrt(v));
    }
    fallGeo.computeVertexNormals();
  }
  const fallMat = keep(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime, uReveal;
      varying vec2 vUv;
      float hash(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        // vertical streaks falling at different speeds, brighter at the lip and the foot
        float col = floor(vUv.x * 46.0);
        float speed = 0.9 + hash(col) * 0.9;
        float s = fract(vUv.y * 3.0 + uTime * speed + hash(col + 7.0));
        float streak = smoothstep(0.0, 0.25, s) * smoothstep(1.0, 0.55, s);
        float edgeFade = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float glow = 0.35 + 0.65 * streak;
        float foot = smoothstep(0.25, 0.0, vUv.y);
        vec3 c = mix(vec3(0.25, 1.0, 0.55), vec3(0.85, 1.0, 0.9), streak * 0.6 + foot * 0.5);
        gl_FragColor = vec4(c, (0.18 + 0.45 * glow + foot * 0.3) * edgeFade * uReveal);
      }`,
  }));
  const fall = new THREE.Mesh(fallGeo, fallMat);
  fall.position.set(fallX, (fallTop + waterY) / 2, lipZ);
  group.add(fall);
  // foam ring where it lands
  const foamMat = keep(new THREE.MeshBasicMaterial({ color: 0xb8ffc8, transparent: true, opacity: 0.0, depthWrite: false }));
  const foam = new THREE.Mesh(keep(new THREE.RingGeometry(0.4, 1.5, 40)), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(impact.x, waterY + 0.02, impact.y);
  group.add(foam);
  // mist: points drifting up and out from the foot
  const MIST = 140;
  const mistGeo = keep(new THREE.BufferGeometry());
  const mistBase = new Float32Array(MIST * 4);
  for (let i = 0; i < MIST; i++) {
    mistBase[i * 4] = (rand() - 0.5) * 2.6;
    mistBase[i * 4 + 1] = (rand() - 0.5) * 1.2;
    mistBase[i * 4 + 2] = rand(); // phase
    mistBase[i * 4 + 3] = 0.5 + rand(); // speed
  }
  mistGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MIST * 3), 3));
  const mistMat = keep(new THREE.PointsMaterial({ color: 0xc8ffd4, size: 0.09, transparent: true, opacity: 0, depthWrite: false }));
  const mist = new THREE.Points(mistGeo, mistMat);
  group.add(mist);

  // ── bonsai, out of the side of the rock ──────────────────────────────────
  const tree = new THREE.Group();
  const root = new THREE.Vector3(W * 0.22, 2.9, back + 0.5);
  const trunkPath = new THREE.CatmullRomCurve3([
    root.clone(),
    root.clone().add(new THREE.Vector3(0.6, 0.9, 1.4)),
    root.clone().add(new THREE.Vector3(1.6, 2.7, 1.2)),
    root.clone().add(new THREE.Vector3(1.0, 4.3, 0.2)),
    root.clone().add(new THREE.Vector3(2.2, 5.4, -0.4)),
  ]);
  tree.add(solid(new THREE.TubeGeometry(trunkPath, 40, 0.42, 7, false), bark, edgeDim, 40));
  const branches = [
    [0.55, new THREE.Vector3(2.4, 0.2, 1.4)],
    [0.7, new THREE.Vector3(-2.2, 0.6, 1.0)],
    [0.9, new THREE.Vector3(1.4, 0.4, -1.2)],
  ] as const;
  const padAt: THREE.Vector3[] = [trunkPath.getPoint(1).add(new THREE.Vector3(0, 0.5, 0))];
  for (const [t, dir] of branches) {
    const from = trunkPath.getPoint(t);
    const to = from.clone().add(dir);
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.5, 0));
    const curve = new THREE.CatmullRomCurve3([from, mid, to]);
    tree.add(solid(new THREE.TubeGeometry(curve, 16, 0.18, 6, false), bark, edgeDim, 40));
    padAt.push(to.clone().add(new THREE.Vector3(0, 0.35, 0)));
  }
  // cloud pads: flattened clusters of faceted blobs, the bonsai silhouette
  for (const c of padAt) {
    const pad = new THREE.Group();
    const n = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const r = 0.55 + rand() * 0.55;
      const blob = solid(new THREE.IcosahedronGeometry(r, 0), leaf, edge, 30);
      blob.position.set((rand() - 0.5) * 2.4, (rand() - 0.5) * 0.4, (rand() - 0.5) * 1.6);
      blob.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      pad.add(blob);
    }
    pad.scale.y = 0.55;
    pad.position.copy(c);
    tree.add(pad);
  }
  group.add(tree);

  // ── patio, brick terrace and bench ───────────────────────────────────────
  const brickTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0a1a0e";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(51,255,51,0.55)";
    g.lineWidth = 2;
    const bh = 32, bw = 64;
    for (let row = 0; row < 256 / bh; row++) {
      g.beginPath(); g.moveTo(0, row * bh); g.lineTo(256, row * bh); g.stroke();
      const off = row % 2 ? bw / 2 : 0;
      for (let x = off; x < 256 + bw; x += bw) { g.beginPath(); g.moveTo(x, row * bh); g.lineTo(x, row * bh + bh); g.stroke(); }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  })();
  const patio = new THREE.Group();
  const px0 = W / 2 + 0.35, pw = 6.2 * sc, pz0 = -2.2, pd = D / 2 + 0.35 - pz0;
  const topTex = brickTex.clone(); topTex.repeat.set(pw / 1.2, pd / 1.2); topTex.needsUpdate = true; keep(topTex);
  const sideTex = brickTex.clone(); sideTex.repeat.set(pw / 1.2, 1); sideTex.needsUpdate = true; keep(sideTex);
  const terrace = solid(new THREE.BoxGeometry(pw, rim + 0.6, pd), [
    keep(new THREE.MeshLambertMaterial({ map: sideTex })),
    keep(new THREE.MeshLambertMaterial({ map: sideTex })),
    keep(new THREE.MeshLambertMaterial({ map: topTex })),
    darkStone,
    keep(new THREE.MeshLambertMaterial({ map: sideTex })),
    keep(new THREE.MeshLambertMaterial({ map: sideTex })),
  ] as unknown as THREE.Material);
  terrace.position.set(px0 + pw / 2, (rim - 0.6) / 2, pz0 + pd / 2);
  patio.add(terrace);
  // a low brick step down along the front
  const step = solid(new THREE.BoxGeometry(pw, 0.45, 0.8), keep(new THREE.MeshLambertMaterial({ map: sideTex })));
  step.position.set(px0 + pw / 2, 0.22 - 0.6 + 0.45, D / 2 + 0.35 + 0.4);
  patio.add(step);
  // bench facing the pond
  const bench = new THREE.Group();
  const seat = solid(new THREE.BoxGeometry(0.55, 0.12, 2.4), bark, edge);
  seat.position.y = 0.5;
  bench.add(seat);
  const backrest = solid(new THREE.BoxGeometry(0.1, 0.5, 2.4), bark, edge);
  backrest.position.set(0.3, 0.85, 0);
  backrest.rotation.z = -0.15;
  bench.add(backrest);
  for (const z of [-1.0, 1.0]) {
    const leg = solid(new THREE.BoxGeometry(0.5, 0.5, 0.12), darkStone, edgeDim);
    leg.position.set(0, 0.25, z);
    bench.add(leg);
  }
  bench.position.set(px0 + 1.0 * sc, rim, 3.2);
  bench.scale.setScalar(Math.max(0.7, sc));
  patio.add(bench);
  group.add(patio);

  // ── S-curved stone ramp with an aqueduct arch over the water ─────────────
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(px0 + 3.6 * sc, rim, 1.6),
    new THREE.Vector3(px0 + 1.4 * sc, rim + 0.15, -0.6),
    new THREE.Vector3(W * 0.22, rim + 1.0, 0.4), // swings out over the water…
    new THREE.Vector3(-W * 0.02, rim + 1.9, -1.0), // …between the waterfall and the koi…
    new THREE.Vector3(-W * 0.08, ROCK_H - 0.4, -3.6),
    new THREE.Vector3(-W * 0.02, ROCK_H + 0.3, back - 0.6), // …up onto the rock top
  ], false, "catmullrom", 0.4);
  const N = 120, RW = 1.5 * Math.max(0.75, sc), RT = 0.32;
  const rampMats: THREE.MeshLambertMaterial[] = []; // faded in as a unit
  const pts = path.getSpacedPoints(N);
  const up = new THREE.Vector3(0, 1, 0);
  const sideOf = (i: number) => {
    const t = pts[Math.min(N, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).setY(0).normalize();
    return new THREE.Vector3().crossVectors(t, up).normalize();
  };
  {
    // deck: a thick ribbon following the path
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const p = pts[i], sd = sideOf(i).multiplyScalar(RW / 2);
      const a = p.clone().add(sd), b = p.clone().sub(sd);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, a.x, a.y - RT, a.z, b.x, b.y - RT, b.z);
    }
    for (let i = 0; i < N; i++) {
      const o = i * 4, n = o + 4;
      // top, bottom, two sides
      idx.push(o, n, o + 1, o + 1, n, n + 1);
      idx.push(o + 2, o + 3, n + 2, o + 3, n + 3, n + 2);
      idx.push(o, o + 2, n, o + 2, n + 2, n);
      idx.push(o + 1, n + 1, o + 3, o + 3, n + 1, n + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const deckMat = keep(new THREE.MeshLambertMaterial({ color: 0x1a3524, side: THREE.DoubleSide }));
    rampMats.push(deckMat);
    const deck = new THREE.Mesh(keep(geo), deckMat);
    group.add(deck);
    // glowing parapet lines along both edges
    for (const sgn of [1, -1]) {
      const line = pts.map((p, i) => p.clone().add(sideOf(i).multiplyScalar((sgn * RW) / 2)).add(new THREE.Vector3(0, 0.06, 0)));
      group.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(line)), edge));
    }
    // step lines across the deck, like paving
    const steps: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i += 4) {
      const sd = sideOf(i).multiplyScalar(RW / 2);
      steps.push(pts[i].clone().add(sd).add(new THREE.Vector3(0, 0.03, 0)), pts[i].clone().sub(sd).add(new THREE.Vector3(0, 0.03, 0)));
    }
    group.add(new THREE.LineSegments(keep(new THREE.BufferGeometry().setFromPoints(steps)), edgeDim));
  }
  {
    // the aqueduct: a wall from the pond floor up to the deck wherever the ramp
    // is over the water, with a semicircular arch through its middle
    const inPond = (p: THREE.Vector3) => Math.abs(p.x) < W / 2 - 0.2 && Math.abs(p.z) < D / 2 - 0.2;
    const span = pts.map((p, i) => ({ p, i })).filter(({ p }) => inPond(p));
    if (span.length > 4) {
      const lens = [0];
      for (let k = 1; k < span.length; k++) lens.push(lens[k - 1] + span[k].p.distanceTo(span[k - 1].p));
      const L = lens[lens.length - 1];
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(L, 0);
      for (let k = span.length - 1; k >= 0; k--) shape.lineTo(lens[k], span[k].p.y - RT);
      shape.lineTo(0, 0);
      const r = Math.min(L * 0.22, 1.25);
      const spring = Math.max(0.2, Math.min(...span.map((s) => s.p.y)) - RT - r - 0.35);
      const hole = new THREE.Path();
      hole.moveTo(L / 2 - r, 0.02);
      hole.lineTo(L / 2 + r, 0.02);
      hole.lineTo(L / 2 + r, spring);
      hole.absarc(L / 2, spring, r, 0, Math.PI, false);
      hole.lineTo(L / 2 - r, 0.02);
      shape.holes.push(hole);
      // map the flat (along-path, height) shape onto the curved path, as two
      // faces a little apart so the wall has thickness
      const flat = new THREE.ShapeGeometry(shape, 24);
      const at = (s: number) => {
        let k = 1;
        while (k < lens.length - 1 && lens[k] < s) k++;
        const f = (s - lens[k - 1]) / Math.max(1e-6, lens[k] - lens[k - 1]);
        return { p: span[k - 1].p.clone().lerp(span[k].p, f), side: sideOf(span[k].i) };
      };
      for (const off of [-0.45, 0.45]) {
        const g = flat.clone();
        const pa = g.attributes.position;
        for (let v = 0; v < pa.count; v++) {
          const { p, side } = at(pa.getX(v));
          const w = p.clone().add(side.multiplyScalar(off));
          pa.setXYZ(v, w.x, pa.getY(v), w.z);
        }
        g.computeVertexNormals();
        const wallMat = keep(new THREE.MeshLambertMaterial({ color: 0x2f5c3e, side: THREE.DoubleSide }));
        rampMats.push(wallMat);
        const wall = solid(g, wallMat, edge, 60);
        group.add(wall);
      }
      flat.dispose();
    }
  }

  // lighting for the shaded solids: cool sky, green bounce off the water
  group.add(new THREE.HemisphereLight(0x9fffc0, 0x02140a, 1.6));
  const key = new THREE.DirectionalLight(0xd8ffe0, 1.4);
  key.position.set(-6, 14, 8);
  group.add(key);

  // ── reveal + animate ─────────────────────────────────────────────────────
  // pieces rise in order as the camera tilts: rock, patio, ramp, tree, water
  const rise: [THREE.Object3D, number][] = [[rock, 0], [patio, 0.15], [tree, 0.45]];
  const mistPos = mistGeo.attributes.position as THREE.BufferAttribute;
  return {
    group,
    impact,
    update(time, s) {
      group.visible = s > 0.002;
      for (const [o, delay] of rise) o.scale.y = Math.max(0.001, ease((s - delay) / (1 - delay)));
      // the ramp and aqueduct fade in rather than squash: they span heights
      const rampIn = ease((s - 0.3) / 0.7);
      for (const m of edgeMats) m.opacity = (m === edge ? 0.85 : 0.6) * ease(s / 0.6);
      for (const mat of rampMats) {
        mat.transparent = rampIn < 1;
        mat.opacity = rampIn;
      }
      const fallIn = ease((s - 0.55) / 0.45);
      fallMat.uniforms.uTime.value = time;
      fallMat.uniforms.uReveal.value = fallIn;
      foamMat.opacity = fallIn * (0.28 + 0.1 * Math.sin(time * 5));
      foam.scale.setScalar(1 + 0.08 * Math.sin(time * 3.1));
      mistMat.opacity = 0.55 * fallIn;
      for (let i = 0; i < MIST; i++) {
        const ph = (mistBase[i * 4 + 2] + time * 0.18 * mistBase[i * 4 + 3]) % 1;
        mistPos.setXYZ(i, impact.x + mistBase[i * 4] * (0.6 + ph), waterY + ph * 2.2, impact.y + mistBase[i * 4 + 1] * (0.6 + ph) + ph * 0.6);
      }
      mistPos.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
