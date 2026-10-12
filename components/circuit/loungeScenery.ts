// The Lounge's scenery around the pond, in the background's phosphor style:
// dark, flat-shaded solids with glowing green edges.
//   rock face   behind the pond, about eye height, jagged low-poly blocks
//   waterfall   off the rock lip into the pond: streaming sheet, foam, mist
//   bonsai      a large twisting tree growing out of the side of the rock
//   patio       a flagstone terrace on the right with a bench facing the water
//   ramp        an S-curved stone ramp from the patio, across the pond between
//               the waterfall and the koi, up to the rock top; over the water
//               it stands on an aqueduct wall with a semicircular arch
// Everything is placed relative to the pond (x across, z front-to-back, y up,
// floor at y = 0) and rises into place as the camera tilts (`update(s)`).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

  // The ramp's course comes first: the waterfall is sized to keep clear of it.
  const px0 = W / 2 + 0.35; // the patio's edge
  const RW = 1.5 * Math.max(0.75, sc); // ramp width
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(px0 + 3.6 * sc, rim, 1.6),
    new THREE.Vector3(px0 + 1.4 * sc, rim + 0.15, -0.6),
    new THREE.Vector3(W * 0.22, rim + 1.0, 0.4), // swings out over the water…
    new THREE.Vector3(-W * 0.02, rim + 1.9, -1.0), // …between the waterfall and the koi…
    new THREE.Vector3(-W * 0.08, ROCK_H - 0.4, -3.6),
    new THREE.Vector3(-W * 0.02, ROCK_H + 0.3, back - 0.6), // …up onto the rock top
  ], false, "catmullrom", 0.4);
  // the ramp's left edge where it climbs past the rock face
  const rampLeft = Math.min(...path.getSpacedPoints(80).filter((p) => p.z < back + 3).map((p) => p.x)) - RW / 2;

  // The waterfall: its left edge where it always was, its right edge pulled in
  // to stop short of the ramp. The spring and its stream sit at SPRING_Y.
  const SPRING_Y = ROCK_H + 0.55;
  const fallLeft = Math.max(-W / 2 + 0.3, -W * 0.2 - 1.2);
  const fallRight = Math.min(-W * 0.2 + 1.2, rampLeft - 0.35);
  const fallW = Math.max(0.5, fallRight - fallLeft);
  const fallX = fallLeft + fallW / 2;
  const fallTop = SPRING_Y - 0.05;
  const rock = new THREE.Group();
  let x = -W / 2 - 1.2;
  const rockEnd = W * 0.34;
  while (x < rockEnd) {
    const w = 1.6 + rand() * 1.6;
    let h = ROCK_H * (0.82 + rand() * 0.3);
    // blocks under the falling water stop below the stream: a notch it pours through
    if (x + w > fallLeft - 0.3 && x < fallRight + 0.3) h = Math.min(h, fallTop - 0.2 + 0.3);
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
  const lipZ = back + 0.75;
  const impact = new THREE.Vector2(fallX, lipZ + 0.9);
  const fallGeo = keep(new THREE.PlaneGeometry(fallW, fallTop - waterY, 1, 24));
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
  const foam = new THREE.Mesh(keep(new THREE.RingGeometry(0.25 * fallW, 0.65 * fallW + 0.3, 40)), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(impact.x, waterY + 0.02, impact.y);
  group.add(foam);
  // mist: points drifting up and out from the foot. The motion is a function
  // of time in the vertex shader, so nothing is moved on the CPU per frame.
  const MIST = 140;
  const mistGeo = keep(new THREE.BufferGeometry());
  const mistBase = new Float32Array(MIST * 4);
  for (let i = 0; i < MIST; i++) {
    mistBase[i * 4] = (rand() - 0.5) * (fallW * 1.1);
    mistBase[i * 4 + 1] = (rand() - 0.5) * 1.2;
    mistBase[i * 4 + 2] = rand(); // phase
    mistBase[i * 4 + 3] = 0.5 + rand(); // speed
  }
  mistGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MIST * 3), 3));
  mistGeo.setAttribute("aBase", new THREE.BufferAttribute(mistBase, 4));
  const mistMat = keep(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uOrigin: { value: new THREE.Vector3(impact.x, waterY, impact.y) } },
    vertexShader: `
      attribute vec4 aBase;
      uniform float uTime;
      uniform vec3 uOrigin;
      varying float vPh;
      void main(){
        float ph = fract(aBase.z + uTime * 0.18 * aBase.w);
        vPh = ph;
        vec3 p = uOrigin + vec3(aBase.x * (0.6 + ph), ph * 2.2, aBase.y * (0.6 + ph) + ph * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 90.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying float vPh;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(0.78, 1.0, 0.83, smoothstep(0.5, 0.1, d) * (1.0 - vPh) * uOpacity);
      }`,
  }));
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.frustumCulled = false; // positions come from the shader
  group.add(mist);

  // ── the spring feeding it ────────────────────────────────────────────────
  // a rock-ringed pool on the rock top, bubbling, and a short stream from it
  // to the lip, so the water has somewhere to come from
  const springZ = back - 0.95;
  const springR = Math.max(0.55, fallW * 0.5);
  const springStones = new THREE.Group();
  const plinth = solid(crag(springR * 2 + 1.1, 0.7, springR * 2 + 1.0, 0.2), stone);
  plinth.position.set(fallX, SPRING_Y - 0.42, springZ);
  springStones.add(plinth);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    if (Math.sin(a) > 0.75) continue; // a gap on the lip side, where the stream leaves
    const st = solid(crag(0.55, 0.38, 0.42, 0.14), darkStone, edgeDim);
    st.position.set(fallX + Math.cos(a) * (springR + 0.2), SPRING_Y + 0.05, springZ + Math.sin(a) * (springR + 0.2));
    st.rotation.y = -a;
    springStones.add(st);
  }
  rock.add(springStones);
  const springMat = keep(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime, uReveal;
      varying vec2 vUv;
      void main(){
        // rings welling up from the centre, brightest where the water rises
        float d = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.75, 1.0, sin(d * 18.0 - uTime * 4.0) * 0.5 + 0.5) * (1.0 - d);
        float core = smoothstep(0.35, 0.0, d);
        vec3 c = mix(vec3(0.05, 0.35, 0.18), vec3(0.8, 1.0, 0.85), ring * 0.8 + core * 0.6);
        gl_FragColor = vec4(c, (0.55 + 0.35 * ring + 0.3 * core) * smoothstep(1.0, 0.92, d) * uReveal);
      }`,
  }));
  const pool = new THREE.Mesh(keep(new THREE.CircleGeometry(springR, 40)), springMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(fallX, SPRING_Y, springZ);
  group.add(pool);
  // the stream: a flat run from the pool's edge to the lip, sloping down slightly
  const streamGeo = keep(new THREE.BufferGeometry());
  {
    const z0 = springZ + springR * 0.8, z1 = lipZ, hw = fallW * 0.48;
    streamGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      fallX - hw, SPRING_Y - 0.01, z0, fallX + hw, SPRING_Y - 0.01, z0,
      fallX - hw, fallTop, z1, fallX + hw, fallTop, z1,
    ], 3));
    streamGeo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    streamGeo.setIndex([0, 2, 1, 1, 2, 3]);
  }
  const stream = new THREE.Mesh(streamGeo, fallMat); // the same streaming water as the fall
  group.add(stream);
  // bubbles rising out of the spring, moved in the shader like the mist
  const BUB = 40;
  const bubGeo = keep(new THREE.BufferGeometry());
  const bubBase = new Float32Array(BUB * 4);
  for (let i = 0; i < BUB; i++) {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * springR * 0.6;
    bubBase[i * 4] = Math.cos(a) * rr;
    bubBase[i * 4 + 1] = Math.sin(a) * rr;
    bubBase[i * 4 + 2] = rand();
    bubBase[i * 4 + 3] = 0.6 + rand();
  }
  bubGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BUB * 3), 3));
  bubGeo.setAttribute("aBase", new THREE.BufferAttribute(bubBase, 4));
  const bubMat = keep(mistMat.clone());
  bubMat.uniforms.uOrigin.value.set(fallX, SPRING_Y, springZ);
  bubMat.vertexShader = mistMat.vertexShader.replace(
    "vec3(aBase.x * (0.6 + ph), ph * 2.2, aBase.y * (0.6 + ph) + ph * 0.6)",
    "vec3(aBase.x, ph * 0.9, aBase.y)",
  ).replace("90.0 / -mv.z", "60.0 / -mv.z");
  const bubbles = new THREE.Points(bubGeo, bubMat);
  bubbles.frustumCulled = false;
  group.add(bubbles);

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

  // ── patio, flagstone terrace and bench ───────────────────────────────────────
  // Paving like an old quay: the top is crazy paving (irregular flagstones of
  // mixed tones in grout), the sides and step are big cut slabs, and a coping
  // of long slabs runs along the waterside edge. Textures are canvas-drawn
  // and tile seamlessly; each face sets its repeat from its size.
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return keep(t);
  };
  // stone tones in the scene's palette: greyed greens, a few warmer, a few pale
  const STONES = ["#3a5240", "#4a6450", "#56725a", "#3f5a46", "#62806a", "#4d6a48", "#6c8a70", "#445e52", "#587456", "#4f6b5c"];
  // flagstones: a seamless Voronoi tiling (distances wrap around the edges),
  // each cell a stone with its own tone and a little grain, grout between
  const flagTex = canvasTex(256, 256, (g) => {
    const S = 256, N = 22;
    const seeds: [number, number, number][] = [];
    for (let i = 0; i < N; i++) seeds.push([rand() * S, rand() * S, Math.floor(rand() * STONES.length)]);
    const tones = STONES.map((h) => new THREE.Color(h));
    const img = g.createImageData(S, S);
    const wrap = (d: number) => { const a = Math.abs(d) % S; return Math.min(a, S - a); };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, k = 0;
      for (let i = 0; i < N; i++) {
        const dx = wrap(x - seeds[i][0]), dy = wrap(y - seeds[i][1]);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d;
      }
      const gap = d2 - d1; // distance to the nearest cell border
      const o = (y * S + x) * 4;
      if (gap < 6) {
        // dark grout with a glowing thread down its middle, so each stone's
        // outline still reads from across the pond
        const glow = Math.max(0, 1 - gap / 1.5);
        img.data[o] = 5 + 40 * glow; img.data[o + 1] = 12 + 200 * glow; img.data[o + 2] = 8 + 60 * glow;
      } else {
        const c = tones[seeds[k][2]];
        // grain, and a slightly darker rim just inside each stone's edge
        const grain = 0.85 + 0.3 * (Math.sin(x * 0.9 + k) * Math.sin(y * 1.3 - k) * 0.5 + 0.5) * rand();
        const rim = gap < 9 ? 0.82 : 1;
        img.data[o] = Math.min(255, c.r * 255 * grain * rim * 1.0);
        img.data[o + 1] = Math.min(255, c.g * 255 * grain * rim * 1.0);
        img.data[o + 2] = Math.min(255, c.b * 255 * grain * rim * 1.0);
      }
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  const FLAG_W = 2.6; // world units per flagstone repeat
  // cut slabs: long rectangles, each a little different in tone
  const slabTex = (pale: boolean) => canvasTex(256, 64, (g) => {
    const tones = pale ? ["#3a4d3c", "#405440", "#36483a", "#3d5040"] : ["#1d2f22", "#22362a", "#1a2b20", "#26392b"];
    const lens = [96, 64, 96];
    let x = 0, i = 0;
    for (const L of lens) {
      g.fillStyle = tones[i++ % tones.length];
      g.fillRect(x, 0, L, 64);
      x += L;
    }
    g.strokeStyle = "rgba(51,255,51,0.45)";
    g.lineWidth = 2;
    x = 0;
    for (const L of lens) { g.strokeRect(x + 1, 1, L - 2, 62); x += L; }
  });
  const slabSide = slabTex(false);
  const slabPale = slabTex(true);
  const SLAB_W = 2.4, SLAB_H = 0.6; // world units per slab repeat (256 x 64 px)
  const paved = (base: THREE.Texture, across: number, high: number, perW: number, perH: number) => {
    const t = keep(base.clone());
    t.repeat.set(across / perW, high / perH);
    t.needsUpdate = true;
    return t;
  };
  const patio = new THREE.Group();
  const pw = 6.2 * sc, pz0 = -2.2, pd = D / 2 + 0.35 - pz0;
  const faceH = rim + 0.6;
  const topTex = paved(flagTex, pw, pd, FLAG_W, FLAG_W);
  const sideTex = paved(slabSide, pw, faceH, SLAB_W, SLAB_H); // front and back faces
  const endTex = paved(slabSide, pd, faceH, SLAB_W, SLAB_H); // the narrow ends
  const terrace = solid(new THREE.BoxGeometry(pw, rim + 0.6, pd), [
    keep(new THREE.MeshLambertMaterial({ map: endTex })),
    keep(new THREE.MeshLambertMaterial({ map: endTex })),
    keep(new THREE.MeshLambertMaterial({ map: topTex })),
    darkStone,
    keep(new THREE.MeshLambertMaterial({ map: sideTex })),
    keep(new THREE.MeshLambertMaterial({ map: sideTex })),
  ] as unknown as THREE.Material);
  terrace.position.set(px0 + pw / 2, (rim - 0.6) / 2, pz0 + pd / 2);
  patio.add(terrace);
  // a low slab step down along the front
  const step = solid(new THREE.BoxGeometry(pw, 0.45, 0.8), keep(new THREE.MeshLambertMaterial({ map: paved(slabSide, pw, 0.45, SLAB_W, SLAB_H) })));
  step.position.set(px0 + pw / 2, 0.22 - 0.6 + 0.45, D / 2 + 0.35 + 0.4);
  patio.add(step);
  // coping: a band of long pale slabs along the waterside edge, slightly proud
  const copeW = 0.55 * Math.max(0.7, sc);
  const coping = solid(new THREE.BoxGeometry(copeW, 0.1, pd), keep(new THREE.MeshLambertMaterial({ map: paved(slabPale, copeW, pd, SLAB_H, SLAB_W) })));
  coping.position.set(px0 + copeW / 2, rim + 0.05, pz0 + pd / 2);
  patio.add(coping);
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
  const N = 120, RT = 0.32;
  let rampMats: THREE.Material[] = []; // faded in as a unit
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

  // ── bake ─────────────────────────────────────────────────────────────────
  // Lighting is computed once into vertex colours (no lights in the scene, so
  // every solid draws with the cheapest material), and each rising piece's
  // meshes and outlines are merged: about 15 draw calls instead of ~150.
  for (const g of [rock, patio, tree]) bake(g, keep);
  const swap = new Map<THREE.Material, THREE.Material>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material instanceof THREE.MeshLambertMaterial) {
      const baked = bakedMaterial(m, m.material, keep);
      swap.set(m.material, baked);
      m.material = baked;
    }
  });
  rampMats = rampMats.map((m) => swap.get(m) ?? m);

  // ── reveal + animate ─────────────────────────────────────────────────────
  // pieces rise in order as the camera tilts: rock, patio, ramp, tree, water
  const rise: [THREE.Object3D, number][] = [[rock, 0], [patio, 0.15], [tree, 0.45]];
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
      mistMat.uniforms.uTime.value = time;
      mistMat.uniforms.uOpacity.value = 0.55 * fallIn;
      springMat.uniforms.uTime.value = time;
      springMat.uniforms.uReveal.value = fallIn;
      bubMat.uniforms.uTime.value = time;
      bubMat.uniforms.uOpacity.value = 0.7 * fallIn;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// ── baking helpers ─────────────────────────────────────────────────────────
// The light the scene used to have, evaluated once per vertex: a hemisphere
// (cool sky above, dark green below) plus one key light, with three's Lambert
// scaling (1/π), in linear colour.
const SKY = new THREE.Color(0x9fffc0), GROUND = new THREE.Color(0x02140a), KEY = new THREE.Color(0xd8ffe0);
const KEY_DIR = new THREE.Vector3(-6, 14, 8).normalize();
const lightAt = (n: THREE.Vector3, out: THREE.Color) =>
  out.copy(GROUND).lerp(SKY, 0.5 * n.y + 0.5).multiplyScalar(1.6)
    .add(KEY.clone().multiplyScalar(1.4 * Math.max(0, n.dot(KEY_DIR))))
    .multiplyScalar(1 / Math.PI);

// Write lit vertex colours into a (non-indexed, flat-normal) geometry whose
// positions are already in the space the light is defined in.
function paint(geo: THREE.BufferGeometry, base: (vertex: number) => THREE.Color, emissive?: THREE.Color) {
  geo.computeVertexNormals();
  const n = geo.attributes.normal, col = new Float32Array(n.count * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    lightAt(v.fromBufferAttribute(n, i).normalize(), c).multiply(base(i));
    if (emissive) c.add(emissive);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

// One Lambert mesh → the same look as an unlit, vertex-coloured material.
function bakedMaterial(mesh: THREE.Mesh, mat: THREE.MeshLambertMaterial, keep: <T extends { dispose(): void }>(x: T) => T) {
  mesh.updateMatrixWorld(true);
  const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone());
  // light in world orientation, then keep the mesh's own transform
  const world = geo.clone().applyMatrix4(new THREE.Matrix4().extractRotation(mesh.matrixWorld));
  paint(world, () => mat.color, mat.emissive);
  geo.setAttribute("color", world.getAttribute("color"));
  world.dispose();
  mesh.geometry = keep(geo);
  return keep(new THREE.MeshBasicMaterial({ vertexColors: true, map: mat.map, side: mat.side, transparent: mat.transparent, opacity: mat.opacity }));
}

// Merge everything under `root` into one lit mesh (plain Lambert solids, by
// vertex colour), a mesh per textured material, and one line set per line
// material. Positions end up in `root`'s space, so it can still be animated.
function bake(root: THREE.Object3D, keep: <T extends { dispose(): void }>(x: T) => T) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rot = new THREE.Matrix4().extractRotation(root.matrixWorld);
  const lit: THREE.BufferGeometry[] = [];
  const lines = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keepMeshes: THREE.Object3D[] = [];
  root.traverse((o) => {
    const rel = new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld);
    const mesh = o as THREE.Mesh, seg = o as THREE.LineSegments;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const plain = mats.length === 1 && mats[0] instanceof THREE.MeshLambertMaterial && !mats[0].map;
      if (!plain) { keepMeshes.push(mesh); return; }
      const mat = mats[0] as THREE.MeshLambertMaterial;
      const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(rel);
      const lightSpace = g.clone().applyMatrix4(rot);
      paint(lightSpace, () => mat.color, mat.emissive);
      g.setAttribute("color", lightSpace.getAttribute("color"));
      g.deleteAttribute("normal");
      g.deleteAttribute("uv");
      lightSpace.dispose();
      lit.push(g);
    } else if (seg.isLineSegments) {
      const g = seg.geometry.clone().applyMatrix4(rel);
      const m = seg.material as THREE.Material;
      lines.set(m, [...(lines.get(m) ?? []), g]);
    }
  });
  // textured meshes (the paved terrace) stay as they are, lit per vertex
  for (const m of keepMeshes) {
    const mesh = m as THREE.Mesh;
    m.updateMatrixWorld(true);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const world = geo.clone().applyMatrix4(new THREE.Matrix4().extractRotation(mesh.matrixWorld));
    const groupOf = (i: number) => geo.groups.find((g) => i >= g.start && i < g.start + g.count)?.materialIndex ?? 0;
    // a box keeps six face groups even with one material: index only into
    // the materials there are
    const matAt = (i: number) => mats.length === 1 ? mats[0] : mats[Math.min(groupOf(i), mats.length - 1)];
    paint(world, (i) => (matAt(i) as THREE.MeshLambertMaterial).color ?? new THREE.Color(1, 1, 1));
    geo.setAttribute("color", world.getAttribute("color"));
    world.dispose();
    mesh.geometry = keep(geo);
    mesh.material = mats.map((mm) => keep(new THREE.MeshBasicMaterial({ vertexColors: true, map: (mm as THREE.MeshLambertMaterial).map ?? null })));
    if (!Array.isArray(mesh.material) || mesh.material.length === 1) mesh.material = (mesh.material as THREE.Material[])[0];
  }
  // rebuild root: the kept textured meshes (re-parented in place), the merged
  // solid and the merged outlines
  const kept = keepMeshes.map((m) => {
    const rel = new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld);
    m.removeFromParent();
    rel.decompose(m.position, m.quaternion, m.scale);
    return m;
  });
  for (const c of [...root.children]) root.remove(c);
  for (const m of kept) root.add(m);
  if (lit.length) {
    const merged = keep(mergeGeometries(lit)!);
    for (const g of lit) g.dispose();
    root.add(new THREE.Mesh(merged, keep(new THREE.MeshBasicMaterial({ vertexColors: true }))));
  }
  for (const [m, gs] of lines) {
    const merged = keep(mergeGeometries(gs)!);
    for (const g of gs) g.dispose();
    root.add(new THREE.LineSegments(merged, m));
  }
}
