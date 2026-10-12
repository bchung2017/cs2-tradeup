// The Lounge: the circuit pond as a 3D diorama. Entering the Lounge, the
// camera eases from straight down (the flat background, unchanged) to a
// raised three-quarter view and drifts around the pond; leaving, it eases
// back. Same pieces as the flat background, now at depth:
//   floor   the circuit, drawn live by circuitLite into an off-screen canvas
//   koi     the same school (koi2d.js) on their own layer above the floor
//   water   a rippling surface above the koi, phosphor sheen at grazing angles
//   basin   the pond's walls, edged in glowing green, rising as the camera tilts
// Stage 1 of the Lounge; the rock face, waterfall, bonsai, patio and ramp come
// next and attach to `scenery`.
import * as THREE from "three";
import { initCircuitLite } from "./circuitLite";
import { createKoiSchool } from "./koi2d";
import { buildScenery, type Scenery } from "./loungeScenery";

const BG = 0x020507;
const GREEN = 0x33ff33;
const FOV = 35; // degrees, vertical
const DEPTH = 10; // the floor's extent front-to-back, in world units
const WATER_Y = 1.1; // water surface height above the floor
const KOI_Y = 0.55; // the koi swim between the floor and the surface
const RIM = 1.6; // basin wall height
const TRANSITION_S = 1.8; // seconds, top-down ↔ three-quarter

export interface Lounge {
  setInLounge(on: boolean): void;
  destroy(): void;
}

const smooth = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function initLounge(canvas: HTMLCanvasElement, onIdle: (idle: boolean) => void): Lounge {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 18, 42);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  // ── floor: the live circuit ──────────────────────────────────────────────
  const floorCanvas = document.createElement("canvas");
  const floorRenderer = initCircuitLite(floorCanvas);
  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ── koi: the same school, on a transparent layer at depth ────────────────
  const koiCanvas = document.createElement("canvas");
  const koiCtx = koiCanvas.getContext("2d")!;
  const school = createKoiSchool();
  const koiTex = new THREE.CanvasTexture(koiCanvas);
  koiTex.colorSpace = THREE.SRGBColorSpace;
  const koi = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: koiTex, transparent: true, depthWrite: false }));
  koi.rotation.x = -Math.PI / 2;
  koi.position.y = KOI_Y;
  scene.add(koi);

  // ── water: a rippling surface, see-through from above, sheen at an angle ─
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 }, // 0 top-down (invisible, so the flat view is unchanged) → 1
      uCam: { value: new THREE.Vector3() },
      uImpact: { value: new THREE.Vector2(9999, 9999) }, // where the waterfall lands
      uGreen: { value: new THREE.Color(GREEN) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uReveal;
      uniform vec3 uCam, uGreen;
      uniform vec2 uImpact;
      varying vec3 vWorld;
      float h(vec2 p) {
        // layered travelling waves, drifting left to right like the flat water,
        // plus rings spreading from where the waterfall lands
        float d = distance(p, uImpact);
        return sin(p.x * 1.3 - uTime * 0.8) * 0.5
             + sin(p.y * 1.7 + p.x * 0.4 - uTime * 0.6) * 0.35
             + sin((p.x + p.y) * 3.1 - uTime * 1.4) * 0.15
             + sin(d * 5.0 - uTime * 5.0) * 0.9 * exp(-d * 0.45);
      }
      void main() {
        vec2 p = vWorld.xz;
        float e = 0.05;
        vec2 slope = vec2(h(p + vec2(e, 0.0)) - h(p), h(p + vec2(0.0, e)) - h(p)) / e;
        vec3 n = normalize(vec3(-slope.x * 0.12, 1.0, -slope.y * 0.12));
        vec3 v = normalize(uCam - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        // fine phosphor contour lines riding the swell
        float band = smoothstep(0.92, 1.0, abs(sin(h(p) * 6.0)));
        vec3 col = mix(vec3(0.02, 0.10, 0.08), uGreen, 0.35 * fres) + uGreen * band * 0.10;
        float a = (0.10 + 0.55 * fres + band * 0.12) * uReveal;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);

  // ── basin: walls with glowing edges, rising with the tilt ────────────────
  const basin = new THREE.Group();
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x050d08 });
  const edgeMat = new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.9 });
  scene.add(basin);
  // the rock face, waterfall, bonsai, patio and ramp (loungeScenery.ts),
  // rebuilt when the screen's shape changes the pond's width
  let scenery: Scenery | null = null;

  let W = DEPTH; // floor width in world units, set from the screen's aspect
  let warmed = false;
  function buildBasin() {
    for (const c of [...basin.children]) {
      basin.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const t = 0.35; // wall thickness
    const walls: [number, number, number, number][] = [
      // x, z, width, depth
      [0, -DEPTH / 2 - t / 2, W + 2 * t, t],
      [0, DEPTH / 2 + t / 2, W + 2 * t, t],
      [-W / 2 - t / 2, 0, t, DEPTH],
      [W / 2 + t / 2, 0, t, DEPTH],
    ];
    for (const [x, z, w, d] of walls) {
      const g = new THREE.BoxGeometry(w, RIM, d);
      const m = new THREE.Mesh(g, wallMat);
      m.position.set(x, RIM / 2, z);
      basin.add(m);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
      lines.position.copy(m.position);
      basin.add(lines);
    }
    // the slab the pond is cut into
    const slab = new THREE.BoxGeometry(W + 2 * t, 0.6, DEPTH + 2 * t);
    const slabMesh = new THREE.Mesh(slab, wallMat);
    slabMesh.position.y = -0.31;
    basin.add(slabMesh);
    const slabEdges = new THREE.LineSegments(new THREE.EdgesGeometry(slab), edgeMat);
    slabEdges.position.copy(slabMesh.position);
    basin.add(slabEdges);
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    W = DEPTH * (w / h);
    for (const m of [floor, koi, water]) m.scale.set(W, DEPTH, 1);
    koiCanvas.width = w;
    koiCanvas.height = h;
    school.setSize(w, h);
    // the fish enter from off-screen: swim them ~20 s ahead so the pond isn't
    // empty on arrival (no drawing, just the motion)
    if (!warmed) { for (let i = 0; i <= 400; i++) school.advance(i * 0.05); warmed = true; }
    buildBasin();
    if (scenery) { scene.remove(scenery.group); scenery.dispose(); }
    scenery = buildScenery(W, DEPTH, RIM, WATER_Y);
    scene.add(scenery.group);
    waterMat.uniforms.uImpact.value.copy(scenery.impact);
    frameScene(h);
  }

  // Fit the whole diorama on screen, below the navbar, at every angle the
  // drift reaches: the camera distance and look-at point for the Lounge view.
  let isoDist = 30;
  const isoTarget = new THREE.Vector3();
  let POLAR = (50 * Math.PI) / 180; // steeper (more overhead) on portrait screens
  let AZIM = (-38 * Math.PI) / 180; // more from the front on portrait screens
  const DRIFT = 0.3; // radians either side, about ±17°
  function frameScene(screenH: number) {
    // corners of each piece's own box: much tighter than one box around all
    const boxes: THREE.Box3[] = [];
    for (const o of [...basin.children, ...scenery!.group.children]) {
      const b = new THREE.Box3().setFromObject(o);
      if (!b.isEmpty()) boxes.push(b);
    }
    const all = boxes.reduce((a, b) => a.union(b), new THREE.Box3());
    all.getCenter(isoTarget);
    const corners: THREE.Vector3[] = [];
    for (const box of boxes) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    // portrait: the pond's long side runs front to back, so look along it
    POLAR = ((camera.aspect < 1 ? 38 : 50) * Math.PI) / 180;
    AZIM = ((camera.aspect < 1 ? -16 : -38) * Math.PI) / 180;
    const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-h")) || 60;
    const top = 1 - (2 * (rail + 12)) / screenH; // NDC y the scene must stay under
    const bottom = -0.96, side = 0.96;
    const project = (dist: number, azim: number) => {
      poseCamera(isoTarget, dist, POLAR, azim);
      camera.updateMatrixWorld();
      return corners.map((c) => c.clone().project(camera));
    };
    const fits = (dist: number, azim: number) =>
      project(dist, azim).every((v) => Math.abs(v.x) <= side && v.y <= top && v.y >= bottom);
    const solve = () => {
      let need = 5;
      for (const a of [AZIM - DRIFT, AZIM - DRIFT / 2, AZIM, AZIM + DRIFT / 2, AZIM + DRIFT]) {
        let lo = 5, hi = 200;
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid, a)) hi = mid; else lo = mid; }
        need = Math.max(need, hi);
      }
      return need;
    };
    // fit, then slide the look-at point so the scene sits centred in the space
    // under the navbar, then fit again (twice: the shift changes the fit)
    isoDist = solve();
    for (let pass = 0; pass < 2; pass++) {
      const pts = project(isoDist, AZIM);
      const xs = pts.map((v) => v.x), ys = pts.map((v) => v.y);
      const dx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const dy = (Math.min(...ys) + Math.max(...ys)) / 2 - (top + bottom) / 2;
      // NDC offset → world offset on the plane through the target, along the
      // camera's right and up
      const halfH = isoDist * Math.tan(((FOV / 2) * Math.PI) / 180);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      isoTarget.addScaledVector(right, dx * halfH * camera.aspect).addScaledVector(upv, dy * halfH);
      isoDist = solve();
    }
    // fog only softens the far side of the diorama, at any camera distance
    const fog = scene.fog as THREE.Fog;
    fog.near = Math.max(topDist + 4, isoDist * 0.9);
    fog.far = fog.near + isoDist * 1.4;
  }

  function poseCamera(at: THREE.Vector3, dist: number, polar: number, azim: number) {
    const sp = Math.sin(polar), cp = Math.cos(polar);
    camera.position.set(at.x + dist * sp * Math.sin(azim), at.y + dist * cp, at.z + dist * sp * Math.cos(azim));
    // screen-up: continuous from "far edge of the pond" (top-down) to world-up-ish
    camera.up.set(-Math.sin(azim) * cp, sp, -Math.cos(azim) * cp);
    camera.lookAt(at);
  }

  // ── camera path ──────────────────────────────────────────────────────────
  // One continuous path: at u=0 straight down at the distance where the floor
  // exactly fills the screen (so it matches the flat background); at u=1 a
  // raised three-quarter view, pulled back, drifting slowly around the pond.
  const topDist = DEPTH / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
  const target = new THREE.Vector3();
  function placeCamera(s: number, time: number) {
    // drift: a slow, uneven swing around the pond, inside ±DRIFT
    const drift = DRIFT * (0.72 * Math.sin(time * 0.045) + 0.28 * Math.sin(time * 0.017 + 1.3));
    target.set(0, 0, 0).lerp(isoTarget, s);
    poseCamera(target, lerp(topDist, isoDist, s), lerp(0, POLAR, s), lerp(0, AZIM + drift, s));
  }

  // ── loop ─────────────────────────────────────────────────────────────────
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let goal = 0; // 1 in the Lounge
  let u = 0; // progress along the path
  let raf = 0;
  let last = performance.now();
  let lastFloor = 0;
  let stopped = false;
  let covered = false;

  function frame(now: number) {
    if (stopped) return;
    // a rAF timestamp can predate the performance.now() taken in start()
    // real elapsed time, so the move takes ~1.8 s even at a low frame rate;
    // capped only so a long pause (a backgrounded tab) can't skip it
    const dt = Math.max(0, Math.min(0.25, (now - last) / 1000));
    last = now;
    const time = now / 1000;
    if (reduced) u = goal;
    else u = goal > u ? Math.min(goal, u + dt / TRANSITION_S) : Math.max(goal, u - dt / TRANSITION_S);
    u = Math.min(1, Math.max(0, u));
    const s = smooth(u);

    // the floor redraws itself at 20 fps; upload it about that often
    if (now - lastFloor > 45) { floorTex.needsUpdate = true; lastFloor = now; }
    koiCtx.clearRect(0, 0, koiCanvas.width, koiCanvas.height);
    school.frame(koiCtx, time);
    koiTex.needsUpdate = true;

    waterMat.uniforms.uTime.value = time;
    waterMat.uniforms.uReveal.value = s;
    // the basin rises out of the slab as the camera tilts
    basin.scale.y = Math.max(0.001, s);
    basin.visible = s > 0.002;
    edgeMat.opacity = 0.9 * s;
    scenery?.update(time, s);
    // fade in over the first part of the move so the hand-off from the flat
    // background is a dissolve, not a cut
    const opacity = Math.min(1, u / 0.12);
    canvas.style.opacity = String(opacity);
    // fully opaque: the flat background underneath can stop drawing
    const cover = opacity >= 1;
    if (cover !== covered) { covered = cover; dispatchEvent(new CustomEvent("lounge:cover", { detail: cover })); }

    placeCamera(s, time);
    waterMat.uniforms.uCam.value.copy(camera.position);
    renderer.render(scene, camera);

    if (u === 0 && goal === 0) {
      onIdle(true); // back to flat: stop drawing until the next visit
      floorRenderer.setPaused(true);
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf || stopped) return;
    onIdle(false);
    floorRenderer.setPaused(false);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function onVisibility() {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (goal === 1 || u > 0) start();
  }

  resize();
  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    setInLounge(on: boolean) {
      goal = on ? 1 : 0;
      start();
    },
    destroy() {
      stopped = true;
      if (covered) dispatchEvent(new CustomEvent("lounge:cover", { detail: false }));
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      floorRenderer.destroy();
      scenery?.dispose();
      renderer.dispose();
      for (const t of [floorTex, koiTex]) t.dispose();
    },
  };
}
