// The Lounge: the circuit pond as a 3D diorama. Entering the Lounge, the
// camera eases from straight down (the flat background, unchanged) to a
// raised three-quarter view and drifts around the pond; leaving, it eases
// back. Same pieces as the flat background, now at depth:
//   floor   the circuit, drawn live by circuitLite into an off-screen canvas
//   koi     the same school (koi2d.js), as 3D fish swimming above the floor
//           (loungeKoi.ts), so they look right from any angle
//   water   a rippling surface above the koi, phosphor sheen at grazing angles
//   basin   the pond's walls, edged in glowing green, rising as the camera tilts
//   scenery     rock face, spring, waterfall, bonsai, patio and ramp
//               (loungeScenery.ts)
//   campus      the plaza and towers around it (loungeCampus.ts)
// The camera has two places to end up: the Lounge's raised three-quarter view
// (/lounge), or standing at the pool's front edge at about eye height,
// looking across the water to the rock and the waterfall (the homepage).
// On the homepage it also gives the tour (see "the tour" below): over the
// waterfall into the Venture Studios headquarters' lobby, and up the
// elevator to floor 1 (loungeInterior.ts).
// It renders in HDR (a half-float buffer) with a bloom pass whose threshold
// sits just above white: only what shines brighter than white glows, which
// is the koi (their shaders go past 1).
// Building it is split into small steps with a frame between each
// (createLounge reports progress for the loading bar), so the page never
// freezes, and everything is compiled and on the GPU before the camera moves.
import * as THREE from "three";
import { initCircuitLite } from "./circuitLite";
import { createKoiSchool, makeKoiTexturesAsync } from "./koi2d";
import { createKoi3D } from "./loungeKoi";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildScenery, fillAt, fillable, paintBoth, type Scenery } from "./loungeScenery";
import { buildCampus, type Campus } from "./loungeCampus";
import { buildInterior, type Interior } from "./loungeInterior";

const BG = 0x020507;
const GREEN = 0x33ff33;
const FOV = 35; // degrees, vertical
const DEPTH = 10; // the floor's extent front-to-back, in world units
const WATER_Y = 1.1; // water surface height above the floor
const KOI_Y = 0.55; // the koi swim between the floor and the surface
const RIM = 1.6; // basin wall height
const POND_SCALE = 2.2; // how much larger the pond and rock feature are than the campus's scale
const TRANSITION_S = 1.8; // seconds, top-down ↔ three-quarter
const EYE = 0.85; // eye height above the plaza, at the campus's scale (a person, POND_SCALE smaller)
const EDGE_FOV = 52; // a wider lens when standing at the edge
const FLOOR_RES = 0.75; // the floor's

// wait for the browser to paint (so the loading bar moves) before going on
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export interface Lounge {
  setInLounge(on: boolean): void;
  setEdgeView(on: boolean): void; // stand at the pool's edge instead of above it
  destroy(): void;
}

const smooth = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export async function createLounge(
  canvas: HTMLCanvasElement,
  onIdle: (idle: boolean) => void,
  onProgress: (done: number) => void,
): Promise<Lounge> {
  const step = (done: number) => { onProgress(done); return nextFrame(); };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 18, 42);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  // HDR: the scene into a half-float, multisampled buffer, the over-bright
  // parts bloomed, then tone and colour space for the screen
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.55, 1.0); // a soft glow
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ── floor: the live circuit ──────────────────────────────────────────────
  const floorCanvas = document.createElement("canvas");
  const floorRenderer = initCircuitLite(floorCanvas, { scale: FLOOR_RES });
  floorRenderer.setPaused(true); // runs only while the Lounge is showing
  await step(0.2);
  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ── koi: the same school, swimming in the screen's pixel field, drawn as
  // 3D fish at depth ──────────────────────────────────────────────────────
  // the koi's smoke textures are the slowest thing to make: one per frame
  const school = createKoiSchool(await makeKoiTexturesAsync((d) => step(0.2 + 0.35 * d)));
  const koi = createKoi3D();
  scene.add(koi.group);

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
        gl_FragColor.rgb = sRGBTransferEOTF(gl_FragColor).rgb; // written in display colours: to linear for the HDR buffer
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);

  // ── basin: walls with glowing edges, rising with the tilt ────────────────
  const basin = new THREE.Group();
  // walls: dark with glowing edges while tilting, filled stone in the Lounge
  const wallMat = fillable(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const WALL_DARK = new THREE.Color(0x050d08).multiplyScalar(2.4), WALL_FILL = new THREE.Color(0x6e7b74);
  const edgeMat = new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.9 });
  scene.add(basin);
  // the rock face, waterfall, bonsai, patio and ramp (loungeScenery.ts),
  // rebuilt when the screen's shape changes the pond's width
  let scenery: Scenery | null = null;
  // the corporate campus around it (loungeCampus.ts), laid out from a seed
  // taken when the Lounge is first built: a new campus each page load, the
  // same one across resizes and repeat visits
  let campus: Campus | null = null;
  const campusSeed = Date.now() & 0x7fffffff;

  let W = DEPTH; // floor width in world units, set from the screen's aspect
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
      const m = new THREE.Mesh(paintBoth(g, WALL_DARK, WALL_FILL), wallMat);
      m.position.set(x, RIM / 2, z);
      basin.add(m);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
      lines.position.copy(m.position);
      basin.add(lines);
    }
    // the slab the pond is cut into
    const slab = new THREE.BoxGeometry(W + 2 * t, 0.6, DEPTH + 2 * t);
    const slabMesh = new THREE.Mesh(paintBoth(slab, WALL_DARK, WALL_FILL), wallMat);
    slabMesh.position.y = -0.31;
    basin.add(slabMesh);
    const slabEdges = new THREE.LineSegments(new THREE.EdgesGeometry(slab), edgeMat);
    slabEdges.position.copy(slabMesh.position);
    basin.add(slabEdges);
  }

  function onResize() {
    layout();
    rebuild(innerHeight);
  }
  function layout() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    W = DEPTH * (w / h);
    for (const m of [floor, water]) m.scale.set(W, DEPTH, 1);
    school.setSize(w, h);
    koi.setField(w, h, W, DEPTH);
  }
  function rebuild(h: number) {
    buildBasin();
    if (scenery) { scene.remove(scenery.group); scenery.dispose(); }
    scenery = buildScenery(W, DEPTH, RIM, WATER_Y);
    scene.add(scenery.group);
    waterMat.uniforms.uImpact.value.copy(scenery.impact);
    if (campus) { scene.remove(campus.group); campus.dispose(); }
    const box = new THREE.Box3().setFromObject(basin).union(new THREE.Box3().setFromObject(scenery.group));
    // the campus is laid out at POND_SCALE times the pond's size, then shrunk
    // to fit: the pond and rock stand that much larger against everything
    // around them
    const t = 0.35, k = POND_SCALE;
    campus = buildCampus(
      { minX: box.min.x * k, maxX: box.max.x * k, minZ: box.min.z * k, maxZ: box.max.z * k },
      { minX: (-W / 2 - t) * k, maxX: (W / 2 + t) * k, minZ: (-DEPTH / 2 - t) * k, maxZ: (DEPTH / 2 + t) * k },
      RIM * k,
      campusSeed,
      { image: scenery.paving.image, size: scenery.paving.size * k },
    );
    campus.group.scale.setScalar(1 / k);
    // the lobby, inside the headquarters' podium: its glass front on the
    // building's face (both in campus units)
    const e = campus.entrance;
    interior.lobby.position.set(e.x, e.y + 0.02, e.z - 15.05);
    campus.group.add(interior.lobby);
    scene.add(campus.group);
    frameScene(h);
  }

  // Fit the whole diorama on screen, below the navbar, at every angle the
  // drift reaches: the camera distance and look-at point for the Lounge view.
  let isoDist = 30;
  const isoTarget = new THREE.Vector3();
  let POLAR = (50 * Math.PI) / 180; // steeper (more overhead) on portrait screens
  let AZIM = (-38 * Math.PI) / 180; // more from the front on portrait screens
  const DRIFT = 0.3; // radians either side, about ±17°
  // the pool's edge: where the camera stands, as a pose round a look-at point
  const edge = { target: new THREE.Vector3(), dist: 10, polar: 1.5, azim: 0 };
  function frameScene(screenH: number) {
    camera.fov = FOV; // the fit below is for the Lounge's lens
    camera.updateProjectionMatrix();
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
    // and the headquarters' sign behind the pond, so it's always in the shot
    const cs = campus?.group.scale.x ?? 1;
    for (const p of campus?.landmarks ?? []) corners.push(p.clone().multiplyScalar(cs));
    // portrait: the pond's long side runs front to back, so look along it
    POLAR = ((camera.aspect < 1 ? 46 : 50) * Math.PI) / 180;
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
    // pull back past the diorama so the campus around it shows: the pond
    // stays the centrepiece, the campus fills the rest of the screen
    isoDist *= camera.aspect < 1 ? 1.12 : 1.08; // a little room round the pond and the sign
    // standing a step back from the front-left corner, the rim in the
    // foreground, looking down the pond's clear left side to the foot of the
    // waterfall (the ramp crosses further right)
    // on a narrow screen, well back and a little higher, so the whole sign
    // fits across the screen above the bonsai
    const tall = camera.aspect < 1;
    const eye = new THREE.Vector3(-W / 2 + Math.min(1.2, W * 0.15), RIM + EYE + (tall ? 2.6 : 0), DEPTH / 2 + (tall ? 16 : 1.6)); // (any further and it would stand inside the towers on that side)
    // the gaze lifted a little, so the sign shows over the rock
    edge.target.set(tall ? 1.6 : -W * 0.2 + 0.4, WATER_Y + (tall ? 5.2 : 3.4), -DEPTH / 2 + 1.0);
    const d = eye.clone().sub(edge.target);
    edge.dist = d.length();
    edge.polar = Math.acos(d.y / edge.dist);
    edge.azim = Math.atan2(d.x, d.z);
    // fog swallows the campus's far edge, at any camera distance
    const fog = scene.fog as THREE.Fog;
    fog.near = Math.max(topDist + 4, isoDist * 0.95);
    fog.far = fog.near + isoDist * 2.2;
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
  const target = new THREE.Vector3(), endTarget = new THREE.Vector3();
  let view = 0, viewGoal = 0; // 0 the three-quarter view, 1 the pool's edge
  function placeCamera(s: number, time: number) {
    // drift: a slow, uneven swing around the pond, inside ±DRIFT; at the edge,
    // only a slow glance from side to side
    const drift = DRIFT * (0.72 * Math.sin(time * 0.045) + 0.28 * Math.sin(time * 0.017 + 1.3));
    const glance = 0.06 * Math.sin(time * 0.11) + 0.03 * Math.sin(time * 0.047 + 2);
    const v = smooth(view);
    endTarget.copy(isoTarget).lerp(edge.target, v);
    const dist = lerp(isoDist, edge.dist, v), polar = lerp(POLAR, edge.polar, v), azim = lerp(AZIM + drift, edge.azim + glance, v);
    const fov = lerp(FOV, lerp(FOV, EDGE_FOV, v), s);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    target.set(0, 0, 0).lerp(endTarget, s);
    poseCamera(target, lerp(topDist, dist, s), lerp(0, polar, s), lerp(0, azim, s));
  }


  // ── the tour: into the headquarters (homepage only) ──────────────────────
  // The lobby is part of the plaza: a room inside the headquarters' podium
  // (built with the campus, below), its glass front the building's facade,
  // its sliding doors opening as you come up to them. "lounge:go" events
  // (components/home/LoungeTour.tsx) ask for a stop: the plaza (the pool's
  // edge), the lobby, or floor 1. The camera walks there in one unbroken
  // move (floor 1 is a ride in the elevator); "lounge:tour" events say where
  // it is and whether it's moving.
  type Stop = "plaza" | "lobby" | "floor1";
  type Room = "lobby" | "office";
  type Pose = { p: THREE.Vector3; yaw: number; pitch: number };
  const interior: Interior = buildInterior();
  interior.office.position.set(0, -300, 0); // out of sight: reached only by the elevator
  interior.office.scale.setScalar(1 / POND_SCALE); // rooms are in campus units, like the lobby
  interior.office.visible = false;
  scene.add(interior.office);
  // the rooms are shrunk to the world's scale: their lamps' reach and
  // strength shrink with them, so they light the same
  for (const room of [interior.lobby, interior.office]) room.traverse((o) => {
    const l = o as THREE.PointLight;
    if (l.isPointLight) { l.distance /= POND_SCALE; l.intensity /= Math.pow(POND_SCALE, l.decay); }
  });
  let where: "plaza" | Room = "plaza"; // the office is the only place apart
  let stop: Stop = "plaza";
  let ready = false; // standing at the pool's edge, free to go
  let move: { t0: number; dur: number; step(k: number, time: number): void; end(): void } | null = null;
  const easeIO = (k: number) => { const t = Math.min(1, Math.max(0, k)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const seg = (t: number, a: number, b: number) => easeIO((t - a) / (b - a));
  const lerpAngle = (a: number, b: number, t: number) => { const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI; return a + d * t; };
  const anglesTo = (from: THREE.Vector3, to: THREE.Vector3) => { const d = to.clone().sub(from); return { yaw: Math.atan2(d.z, d.x), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }; };
  const posed = (p: [number, number, number], look: [number, number, number]): Pose => ({ p: new THREE.Vector3(...p), ...anglesTo(new THREE.Vector3(...p), new THREE.Vector3(...look)) });
  // poses in room units (the two rooms share the elevator's layout)
  const LOBBY_IDLE = posed([-2, 1.7, 7], [4, 2.8, -9]);
  const LOBBY_IDLE_TALL = posed([0, 1.7, 9.5], [0, 4.2, -15]); // narrow screens: square on to the logo
  const ELEV_FRONT: Pose = { p: new THREE.Vector3(16.6, 1.7, -2), yaw: 0, pitch: 0 };
  const ELEV_CAR: Pose = { p: new THREE.Vector3(21.6, 1.7, -2), yaw: Math.PI, pitch: -0.03 };
  const OFFICE_IDLE = posed([13, 1.8, 6], [-1, 2.0, -15]);
  const OFFICE_IDLE_TALL = posed([9, 1.8, 11], [3.5, 2.2, -15]);
  const lobbyIdle = () => (camera.aspect < 1 ? LOBBY_IDLE_TALL : LOBBY_IDLE);
  const officeIdle = () => (camera.aspect < 1 ? OFFICE_IDLE_TALL : OFFICE_IDLE);
  // room units → the world (both rooms are unrotated, scaled down uniformly)
  const roomObj = (r: Room) => (r === "lobby" ? interior.lobby : interior.office);
  const toWorld = (r: Room, v: THREE.Vector3) => { const o = roomObj(r); o.updateMatrixWorld(true); return v.clone().applyMatrix4(o.matrixWorld); };
  const pose: Pose = { p: new THREE.Vector3(), yaw: 0, pitch: 0 };
  let poseRoom: Room | null = null; // what pose.p is relative to: a room, or the world
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function applyPose() {
    const p = poseRoom ? toWorld(poseRoom, pose.p) : tmpA.copy(pose.p);
    camera.up.set(0, 1, 0);
    camera.position.copy(p);
    tmpB.set(Math.cos(pose.yaw) * Math.cos(pose.pitch), Math.sin(pose.pitch), Math.sin(pose.yaw) * Math.cos(pose.pitch));
    camera.lookAt(tmpB.add(p));
  }
  const lerpPose = (a: Pose, b: Pose, t: number) => {
    pose.p.copy(a.p).lerp(b.p, t);
    pose.yaw = lerpAngle(a.yaw, b.yaw, t);
    pose.pitch = a.pitch + (b.pitch - a.pitch) * t;
  };
  function emit(busy: boolean, extra: Record<string, unknown> = {}) {
    const detail = { stop, busy, ready, ...extra };
    (window as unknown as { __loungeTour?: unknown }).__loungeTour = detail;
    dispatchEvent(new CustomEvent("lounge:tour", { detail }));
  }
  const fog = () => scene.fog as THREE.Fog;
  let fogKeep = { near: 0, far: 0 };
  function setWhere(w: "plaza" | Room) {
    const apart = (x: string) => x === "office";
    if (apart(w) && !apart(where)) { fogKeep = { near: fog().near, far: fog().far }; fog().near = 300; fog().far = 600; floorRenderer.setPaused(true); }
    if (!apart(w) && apart(where)) { fog().near = fogKeep.near; fog().far = fogKeep.far; floorRenderer.setPaused(false); }
    where = w;
  }
  // the pool's edge pose at `time`, without moving the camera for good
  function edgePose(time: number): Pose {
    placeCamera(1, time);
    const p = camera.position.clone();
    return { p, ...anglesTo(p, target) };
  }
  // the walk between the pool's edge and the lobby, in world units: up over
  // the rock and the waterfall, down across the plaza to the doors, inside
  function walkway(edge: THREE.Vector3, inside: THREE.Vector3) {
    const f = scenery!.fall, d = interior.frontDoor;
    const L = (x: number, y: number, z: number) => toWorld("lobby", new THREE.Vector3(x, y, z));
    return new THREE.CatmullRomCurve3([
      edge,
      new THREE.Vector3(f.x, f.top + 4.5, f.z + 1),
      L(d.x, 9, d.z + 24),
      L(d.x, 3.2, d.z + 11),
      L(d.x, d.y, d.z + 3),
      L(d.x, d.y, d.z - 2),
      inside,
    ], false, "centripetal");
  }
  const run = (dur: number, step: (k: number, time: number) => void, end: () => void) => {
    move = { t0: performance.now() / 1000, dur: reduced ? 0.01 : dur, step, end };
  };
  // follow a path, looking along it, turning to `endLook` at the end
  function follow(path: THREE.CatmullRomCurve3, from: Pose, endLook: Pose, k: number) {
    const u = easeIO(k);
    path.getPointAt(u, pose.p);
    const ahead = path.getPointAt(Math.min(1, u + 0.05));
    const dir = anglesTo(pose.p, ahead.distanceTo(pose.p) > 1e-4 ? ahead : path.getPointAt(1));
    dir.pitch = Math.max(-0.45, Math.min(0.25, dir.pitch));
    const a = easeIO(Math.min(1, k / 0.15)), b = easeIO(Math.max(0, (k - 0.78) / 0.22));
    pose.yaw = lerpAngle(lerpAngle(from.yaw, dir.yaw, a), endLook.yaw, b);
    pose.pitch = from.pitch + (dir.pitch - from.pitch) * a;
    pose.pitch += (endLook.pitch - pose.pitch) * b;
  }
  function walkIn() {
    const from: Pose = { p: camera.position.clone(), ...anglesTo(camera.position, target) };
    const idle = lobbyIdle(), inside = toWorld("lobby", idle.p);
    const path = walkway(from.p, inside);
    poseRoom = null;
    emit(true);
    run(9, (k) => follow(path, from, idle, k), () => {
      poseRoom = "lobby";
      pose.p.copy(idle.p); pose.yaw = idle.yaw; pose.pitch = idle.pitch;
      setWhere("lobby");
      stop = "lobby";
      emit(false);
    });
  }
  function walkOut() {
    const startW = toWorld("lobby", pose.p), from: Pose = { p: startW, yaw: pose.yaw, pitch: pose.pitch };
    const dur = 9, end = edgePose(performance.now() / 1000 + dur);
    const path = walkway(end.p, startW);
    poseRoom = null;
    setWhere("plaza");
    emit(true);
    run(dur, (k) => follow({ getPointAt: (u: number, out?: THREE.Vector3) => path.getPointAt(1 - u, out) } as unknown as THREE.CatmullRomCurve3, from, end, k), () => {
      stop = "plaza";
      emit(false);
    });
  }
  function ride(from: Room, to: Room, endPose: Pose, endStop: Stop, labels: [string, string]) {
    const start = { p: pose.p.clone(), yaw: pose.yaw, pitch: pose.pitch };
    interior.setDoors(to, 0);
    emit(true, { ride: { from: labels[0], to: labels[1] } });
    let switched = false;
    poseRoom = from;
    run(12, (k, time) => {
      const t = k * 12;
      if (t < 2.4) lerpPose(start, ELEV_FRONT, seg(t, 0, 2.4));
      else if (t < 3.4) { lerpPose(ELEV_FRONT, ELEV_FRONT, 0); interior.setDoors(from, seg(t, 2.4, 3.4)); }
      else if (t < 5.2) {
        interior.setDoors(from, 1);
        const e = seg(t, 3.4, 5.2);
        pose.p.copy(ELEV_FRONT.p).lerp(ELEV_CAR.p, e);
        pose.yaw = Math.PI * e; // turn round to face the doors
        pose.pitch = ELEV_CAR.pitch * e;
      } else if (t < 8.6) {
        pose.p.copy(ELEV_CAR.p); pose.yaw = Math.PI; pose.pitch = ELEV_CAR.pitch;
        interior.setDoors(from, 1 - seg(t, 5.2, 6.2));
        // the switch happens behind closed doors
        if (t > 7.4 && !switched) { switched = true; interior.setDoors(from, 0); setWhere(to); poseRoom = to; }
        pose.p.y += Math.sin(time * 30) * 0.004 * Math.min(1, (t - 6.2) * 2) * Math.min(1, (8.6 - t) * 2); // the ride's hum
      } else {
        if (!switched) { switched = true; setWhere(to); poseRoom = to; }
        interior.setDoors(to, t < 10.8 ? seg(t, 8.6, 9.6) : 1 - seg(t, 10.8, 11.8));
        lerpPose(ELEV_CAR, endPose, seg(t, 9.6, 12));
      }
    }, () => { interior.setDoors(to, 0); stop = endStop; emit(false); });
  }
  function go(target: Stop) {
    if (move || !ready || target === stop) return;
    if (stop === "plaza" && target === "lobby") walkIn();
    else if (stop === "lobby" && target === "plaza") walkOut();
    else if (stop === "lobby" && target === "floor1") ride("lobby", "office", officeIdle(), "floor1", ["L", "1"]);
    else if (stop === "floor1" && target === "lobby") ride("office", "lobby", lobbyIdle(), "lobby", ["1", "L"]);
  }
  const onGo = (e: Event) => go((e as CustomEvent<Stop>).detail);
  addEventListener("lounge:go", onGo);
  // leaving the homepage mid-tour: straight back to the Lounge's own camera
  function resetTour() {
    move = null;
    poseRoom = null;
    setWhere("plaza");
    interior.setFrontDoors(0);
    if (stop !== "plaza" || ready) { stop = "plaza"; ready = false; emit(false); }
  }
  // each frame, after the plaza has updated: the tour's camera, the rooms,
  // the lobby's doors (they open for whoever comes near)
  function tourFrame(time: number) {
    const apart = where === "office";
    if (apart) for (const o of [floor, water, basin, koi.group, scenery?.group, campus?.group]) if (o) o.visible = false;
    interior.office.visible = apart;
    interior.update(time);
    let moved = false;
    if (move) {
      const k = Math.min(1, (time - move.t0) / move.dur);
      move.step(k, time);
      if (k >= 1) { const m = move; move = null; m.end(); }
      moved = true;
    } else if (stop === "lobby" || stop === "floor1") {
      const idle = stop === "lobby" ? lobbyIdle() : officeIdle();
      poseRoom = stop === "lobby" ? "lobby" : "office";
      pose.p.copy(idle.p); pose.p.y += Math.sin(time * 0.6) * 0.03;
      pose.yaw = idle.yaw + Math.sin(time * 0.13) * 0.06; pose.pitch = idle.pitch;
      moved = true;
    }
    if (moved) applyPose();
    if (!apart) {
      const d = toWorld("lobby", interior.frontDoor).distanceTo(camera.position) * POND_SCALE; // in lobby units
      interior.setFrontDoors((9 - d) / 4);
    }
    return moved;
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
    if (reduced) { u = goal; view = viewGoal; }
    else {
      u = goal > u ? Math.min(goal, u + dt / TRANSITION_S) : Math.max(goal, u - dt / TRANSITION_S);
      // between the two views only while tilted: from flat, go straight to the right one
      view = u === 0 ? viewGoal : viewGoal > view ? Math.min(viewGoal, view + dt / TRANSITION_S) : Math.max(viewGoal, view - dt / TRANSITION_S);
    }
    u = Math.min(1, Math.max(0, u));
    const s = smooth(u);

    // the floor redraws itself at 20 fps; upload it about that often
    if (now - lastFloor > 45) { floorTex.needsUpdate = true; lastFloor = now; }
    school.advance(time);

    waterMat.uniforms.uTime.value = time;
    waterMat.uniforms.uReveal.value = s;
    // the basin rises out of the slab as the camera tilts
    basin.scale.y = Math.max(0.001, s);
    basin.visible = s > 0.002;
    edgeMat.opacity = 0.9 * s * (1 - 0.7 * fillAt(s));
    scenery?.update(time, s);
    campus?.update(time, s);
    // fade in over the first part of the move so the hand-off from the flat
    // background is a dissolve, not a cut
    const opacity = Math.min(1, u / 0.12);
    canvas.style.opacity = String(opacity);
    // fully opaque: the flat background underneath can stop drawing
    const cover = opacity >= 1;
    if (cover !== covered) { covered = cover; dispatchEvent(new CustomEvent("lounge:cover", { detail: cover })); }

    // the tour's moves only on the homepage, once standing at the pool's edge
    const atEdge = viewGoal === 1 && goal === 1 && u === 1 && view === 1;
    if (!atEdge && (ready || where !== "plaza" || move)) resetTour();
    if (atEdge && !ready && !move) { ready = true; emit(false); }
    if (!tourFrame(time)) placeCamera(s, time);
    if (where !== "office") koi.update(school.fish(), KOI_Y, camera.position, 1);
    waterMat.uniforms.uCam.value.copy(camera.position);
    composer.render();

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

  // ── staged build ─────────────────────────────────────────────────────────
  layout();
  // the fish enter from off-screen: swim them ~20 s ahead, in chunks, so the
  // pond isn't empty on arrival (motion only, no drawing)
  for (let k = 0; k < 16; k++) {
    for (let i = 0; i < 25; i++) school.advance((k * 25 + i) * 0.05);
    await step(0.55 + 0.0075 * (k + 1));
  }
  rebuild(innerHeight); // basin, scenery (built and baked), camera framing
  await step(0.8);
  // compile every shader up front, with the scene fully risen so nothing is
  // skipped (parallel compile where the browser supports it)
  scenery!.update(0, 1);
  campus!.update(0, 1);
  basin.visible = true;
  basin.scale.y = 1;
  waterMat.uniforms.uReveal.value = 1;
  placeCamera(1, 0);
  koi.update(school.fish(), KOI_Y, camera.position, 1); // the fish's meshes exist before compiling
  interior.office.visible = true; // compiled now, not mid-ride
  await renderer.compileAsync(scene, camera);
  interior.office.visible = false;
  await step(0.92);
  // one hidden draw of the full scene: uploads textures and geometry to the
  // GPU now rather than on the first frame of the move
  canvas.style.opacity = "0";
  floorTex.needsUpdate = true;
  composer.render(); // also compiles the bloom's shaders
  scenery!.update(0, 0);
  campus!.update(0, 0);
  basin.visible = false;
  waterMat.uniforms.uReveal.value = 0;
  await step(1);

  addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    setInLounge(on: boolean) {
      goal = on ? 1 : 0;
      start();
    },
    setEdgeView(on: boolean) {
      viewGoal = on ? 1 : 0;
      if (u === 0) view = viewGoal;
    },
    destroy() {
      stopped = true;
      removeEventListener("lounge:go", onGo);
      interior.dispose();
      if (covered) dispatchEvent(new CustomEvent("lounge:cover", { detail: false }));
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      floorRenderer.destroy();
      scenery?.dispose();
      campus?.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      floorTex.dispose();
      koi.dispose();
    },
  };
}
