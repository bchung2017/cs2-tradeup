// The Lounge's koi as 3D models, so they hold up at any camera angle: the
// three-quarter view, the pool's edge, straight down.
//
// They swim exactly as the 2D school does (koi2d.js runs the motion in its
// pixel field; this maps it onto the pond floor). Each fish is two meshes,
// rebuilt from its spine every frame (a few hundred vertices each):
//   body   a tube with an oval cross-section, a flatter belly, the 2D
//          koi's width profile and tail wave, wrapped in the same metallic
//          smoke texture, with a moving sheen, a rim light and eyes; it
//          emits its scheme's bright colour past white (HDR), which the
//          Lounge's bloom turns into a glow
//   fins   translucent sheets edged in the scheme's bright colour: the tail
//          (the profile's fan), pectorals and pelvics that wave, a dorsal sail
import * as THREE from "three";
import type { KoiFish } from "./koi2d";

// the 2D koi's proportions (koi2d.js), in fractions of a fish's length
const BODYSPAN = 1.7, WIDTH_MULT = 0.111, NOSE_FRAC = 0.45, WAIST = 0.55;
const PEC_U = 0.15, PELV_U = 0.4, DORSAL_U0 = 0.18, DORSAL_U1 = 0.62;
const BODY_END = 0.66; // the tube stops here; the tail fin carries on to 1
const TAIL_U0 = 0.58;
const NB = 18, RJ = 12; // body rings, vertices around a ring
const NT = 10, MF = 8, ND = 10; // tail, side-fin and dorsal segments
const GLOW = 1.0; // how far past white the koi shine (the bloom starts at white)

function profileWidth(L: number, u: number) {
  let w: number;
  const HEAD_END = 0.08, PLATEAU_END = 0.14;
  if (u < HEAD_END) w = NOSE_FRAC + (1.12 - NOSE_FRAC) * Math.pow(u / HEAD_END, 0.5);
  else if (u < PLATEAU_END) w = 1.12;
  else if (u < 0.5) w = 1.12 * Math.pow(1 - (u - PLATEAU_END) / (0.5 - PLATEAU_END + 0.55), 0.85);
  else if (u < 0.62) {
    const t = (u - 0.5) / 0.12, trunkEnd = 1.12 * Math.pow(1 - (0.5 - PLATEAU_END) / (0.5 - PLATEAU_END + 0.55), 0.85);
    w = trunkEnd * (1 - t) + 0.3 * t;
  } else {
    const tv = (u - 0.62) / 0.38;
    w = 0.3 * (1 - tv * 0.6) + Math.sin(Math.min(1, tv * 1.1) * Math.PI) * 0.62;
  }
  return Math.max(w, 0.04) * L * WIDTH_MULT;
}
// the body's height above/below its centre line, as a share of its half-width
const thickness = (u: number) => (u < 0.45 ? 0.82 : 0.82 - (Math.min(u, BODY_END) - 0.45) * 1.6);

function sampleTrail(tr: { x: number; y: number }[], dist: number, out: { x: number; y: number }) {
  let acc = 0;
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1], b = tr[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= dist) {
      const t = (dist - acc) / (seg || 1e-4);
      out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t;
      return out;
    }
    acc += seg;
  }
  out.x = tr[tr.length - 1].x; out.y = tr[tr.length - 1].y;
  return out;
}

const rgb = (c: number[]) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

const BODY_VERT = /* glsl */ `
  attribute vec3 nrm;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    vUv = uv; vN = nrm;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const BODY_FRAG = /* glsl */ `
  uniform sampler2D map; uniform vec3 hot; uniform vec3 base; uniform vec3 cam;
  uniform float sweepU; uniform float uvOff; uniform float reveal; uniform float glow;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    vec3 n = normalize(vN), v = normalize(cam - vW), L = normalize(vec3(-0.35, 1.0, 0.45));
    // the smoke texture wraps the body, mirrored either side of the spine
    float around = abs(vUv.y * 2.0 - 1.0);
    vec3 tex = texture2D(map, vec2(fract(vUv.x * 2.1 + uvOff), 0.2 + 0.6 * around)).rgb;
    float diff = 0.5 + 0.6 * max(0.0, dot(n, L));
    float spec = pow(max(0.0, dot(reflect(-L, n), v)), 28.0);
    float rim = pow(1.0 - max(0.0, dot(n, v)), 2.4);
    float sweep = exp(-pow(vUv.x / ${BODY_END.toFixed(2)} - sweepU, 2.0) * 22.0) * max(0.0, n.y);
    vec3 c = mix(base, tex, 0.85) * diff + hot * (spec * 0.7 + rim * 0.55 + sweep * 0.55);
    // emission, brighter than white: a steady inner light, hotter along the
    // sheen and at the rim
    c += hot * glow * (0.35 + 0.35 * dot(tex, vec3(0.33)) + 2.0 * sweep + 1.3 * rim);
    // eyes, either side of the head
    vec2 e1 = vec2(vUv.x - 0.055, vUv.y - 0.085), e2 = vec2(vUv.x - 0.055, vUv.y - 0.415);
    float eye = 1.0 - smoothstep(0.012, 0.018, min(length(e1 * vec2(1.0, 0.6)), length(e2 * vec2(1.0, 0.6))));
    c = mix(c, vec3(0.01), eye * 0.95);
    gl_FragColor = vec4(c, reveal);
    #include <colorspace_fragment>
  }`;
const FIN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FIN_FRAG = /* glsl */ `
  uniform vec3 hot; uniform vec3 mid; uniform float reveal; uniform float glow;
  varying vec2 vUv;
  void main() {
    float e = abs(vUv.y * 2.0 - 1.0);
    float edge = smoothstep(0.72, 1.0, e) + smoothstep(0.8, 1.0, vUv.x) * 0.6;
    float rays = 0.0;
    for (int i = -1; i <= 1; i++) rays += 1.0 - smoothstep(0.0, 0.07, abs(vUv.y - 0.5 - float(i) * 0.25));
    float lit = clamp(edge + rays * 0.35, 0.0, 1.0);
    vec3 c = mix(mid * 0.7, hot, lit) * (1.0 + glow * 2.2 * lit); // edges and rays past white
    gl_FragColor = vec4(c, (0.22 + 0.6 * lit) * reveal);
    #include <colorspace_fragment>
  }`;

interface KoiMesh {
  body: THREE.Mesh; fins: THREE.Mesh;
  bodyMat: THREE.ShaderMaterial; finMat: THREE.ShaderMaterial;
  tex: HTMLCanvasElement | null;
}

export interface Koi3D {
  group: THREE.Group;
  // the school's pixel field and the pond floor it maps onto
  setField(wPx: number, hPx: number, wWorld: number, dWorld: number): void;
  update(fish: KoiFish[], y: number, camera: THREE.Vector3, reveal: number): void;
  dispose(): void;
}

export function createKoi3D(): Koi3D {
  const group = new THREE.Group();
  const meshes: KoiMesh[] = [];
  const textures = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  let wPx = 1, hPx = 1, wW = 1, dW = 1;

  const texFor = (c: HTMLCanvasElement) => {
    let t = textures.get(c);
    if (!t) {
      t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      textures.set(c, t);
    }
    return t;
  };

  function makeMesh(): KoiMesh {
    // body: rings of RJ+1 vertices (the seam doubled for the texture)
    const bodyGeo = new THREE.BufferGeometry();
    const nv = (NB + 1) * (RJ + 1);
    bodyGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    bodyGeo.setAttribute("nrm", new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(nv * 2), idx: number[] = [];
    for (let i = 0; i <= NB; i++) for (let j = 0; j <= RJ; j++) { uv[(i * (RJ + 1) + j) * 2] = (i / NB) * BODY_END; uv[(i * (RJ + 1) + j) * 2 + 1] = j / RJ; }
    for (let i = 0; i < NB; i++) for (let j = 0; j < RJ; j++) {
      const a = i * (RJ + 1) + j, b = a + RJ + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    bodyGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    bodyGeo.setIndex(idx);
    // fins: the tail, four side fins, the dorsal: strips of vertex pairs
    const strips = [NT, MF, MF, MF, MF, ND];
    const fv = strips.reduce((s, n) => s + (n + 1) * 2, 0);
    const finGeo = new THREE.BufferGeometry();
    finGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const fuv = new Float32Array(fv * 2), fidx: number[] = [];
    let o = 0;
    for (const n of strips) {
      for (let i = 0; i <= n; i++) {
        fuv.set([i / n, 0, i / n, 1], (o + i * 2) * 2);
        if (i < n) { const a = o + i * 2; fidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      o += (n + 1) * 2;
    }
    finGeo.setAttribute("uv", new THREE.BufferAttribute(fuv, 2));
    finGeo.setIndex(fidx);
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, hot: { value: new THREE.Color() }, base: { value: new THREE.Color() }, cam: { value: new THREE.Vector3() }, sweepU: { value: 0 }, uvOff: { value: 0 }, reveal: { value: 1 }, glow: { value: GLOW } },
      vertexShader: BODY_VERT, fragmentShader: BODY_FRAG,
    });
    const finMat = new THREE.ShaderMaterial({
      uniforms: { hot: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, reveal: { value: 1 }, glow: { value: GLOW } },
      vertexShader: FIN_VERT, fragmentShader: FIN_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat), fins = new THREE.Mesh(finGeo, finMat);
    body.frustumCulled = fins.frustumCulled = false; // they move every frame
    fins.renderOrder = 1;
    group.add(body, fins);
    return { body, fins, bodyMat, finMat, tex: null };
  }

  // scratch
  const sp = { x: 0, y: 0 }, spine: { x: number; z: number; tx: number; tz: number; w: number }[] = [];
  for (let i = 0; i <= 40; i++) spine.push({ x: 0, z: 0, tx: 1, tz: 0, w: 0 });

  // the spine at u (0 head … 1 tail tip), in world x/z, with the tail's wave
  function spineAt(f: KoiFish, u: number, out: { x: number; z: number; tx: number; tz: number; w: number }) {
    const span = f.len * BODYSPAN, k = wW / wPx;
    const du = 0.02;
    sampleTrail(f.trail, Math.max(0, u - du) * span, sp);
    const ax = sp.x, ay = sp.y;
    sampleTrail(f.trail, Math.min(1, u + du) * span, sp);
    let tx = sp.x - ax, ty = sp.y - ay;
    const tl = Math.hypot(tx, ty) || 1e-4;
    tx /= tl; ty /= tl;
    sampleTrail(f.trail, u * span, sp);
    let lat = 0;
    if (u > WAIST) { const tv = (u - WAIST) / (1 - WAIST); lat = Math.sin(f.tailPhase - tv * 3.0) * Math.pow(tv, 1.6) * f.len * 0.11; }
    const px = sp.x + -ty * lat, py = sp.y + tx * lat;
    out.x = (px / wPx - 0.5) * wW;
    out.z = (py / hPx - 0.5) * dW;
    out.tx = tx; out.tz = ty; // pixel and world axes line up (x→x, y→z)
    out.w = profileWidth(f.len, u) * k;
    return out;
  }

  function build(m: KoiMesh, f: KoiFish, y0: number) {
    const k = wW / wPx;
    // ── body
    const pos = m.body.geometry.attributes.position as THREE.BufferAttribute, nrm = m.body.geometry.attributes.nrm as THREE.BufferAttribute;
    const p = pos.array as Float32Array, nn = nrm.array as Float32Array;
    for (let i = 0; i <= NB; i++) {
      const u = (i / NB) * BODY_END, s = spineAt(f, u, spine[i]);
      const nose = Math.sqrt(Math.min(1, u / 0.045)); // round the snout off to a point
      const w = s.w * nose, h = s.w * thickness(u) * nose;
      const nx = -s.tz, nz = s.tx; // sideways, in the floor plane
      const hump = h * 0.15; // the back rides a little higher than the belly
      for (let j = 0; j <= RJ; j++) {
        const th = (j / RJ) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
        const up = sn >= 0 ? sn * h + hump * sn : sn * h * 0.7;
        const o = (i * (RJ + 1) + j) * 3;
        p[o] = s.x + nx * c * w; p[o + 1] = y0 + up; p[o + 2] = s.z + nz * c * w;
        // the oval's normal
        const ex = c / Math.max(w, 1e-4), ey = sn / Math.max(sn >= 0 ? h * 1.15 : h * 0.7, 1e-4);
        const l = Math.hypot(ex, ey) || 1;
        nn[o] = (nx * ex) / l; nn[o + 1] = ey / l; nn[o + 2] = (nz * ex) / l;
      }
    }
    pos.needsUpdate = true; nrm.needsUpdate = true;
    // ── fins
    const fp = (m.fins.geometry.attributes.position as THREE.BufferAttribute);
    const a = fp.array as Float32Array;
    let o = 0;
    const put = (x: number, yy: number, z: number) => { a[o++] = x; a[o++] = yy; a[o++] = z; };
    // tail: the profile's fan, flat, waving with the spine
    const t = spineAt(f, TAIL_U0, spine[NB + 1]);
    for (let i = 0; i <= NT; i++) {
      const u = TAIL_U0 + (i / NT) * (1 - TAIL_U0), s = spineAt(f, u, spine[NB + 2]);
      const w = Math.max(s.w, 0.01 * f.len * k), nx = -s.tz, nz = s.tx;
      put(s.x + nx * w, y0 + (i / NT) * 0.02, s.z + nz * w);
      put(s.x - nx * w, y0 + (i / NT) * 0.02, s.z - nz * w);
    }
    void t;
    // side fins: out from the body, swept back, drooping, waving
    const L = f.len * k;
    const fin = (u0: number, side: number, reach: number, wide: number, phase: number) => {
      const s = spineAt(f, u0, spine[NB + 3]);
      const nx = -s.tz * side, nz = s.tx * side, bx = -s.tx, bz = -s.tz;
      const ox = s.x + nx * s.w * 0.9, oz = s.z + nz * s.w * 0.9, oy = y0 - s.w * 0.25;
      for (let i = 0; i <= MF; i++) {
        const q = i / MF;
        const out = reach * Math.sin(q * Math.PI * 0.6), back = reach * 0.9 * q;
        const billow = Math.sin(f.tailPhase - q * 3.0 + phase) * Math.pow(q, 1.8) * L * 0.05;
        const cx = ox + nx * (out + billow) + bx * back, cz = oz + nz * (out + billow) + bz * back, cy = oy - out * 0.35 + billow * 0.6;
        const half = wide * Math.pow(1 - q, 1.1) * Math.min(1, q * 3) + 0.004;
        put(cx + bx * half, cy, cz + bz * half);
        put(cx - bx * half, cy, cz - bz * half);
      }
    };
    fin(PEC_U, 1, L * 0.26, L * 0.085, 0);
    fin(PEC_U, -1, L * 0.26, L * 0.085, 1.0);
    fin(PELV_U, 1, L * 0.18, L * 0.06, 0.5);
    fin(PELV_U, -1, L * 0.18, L * 0.06, 1.5);
    // dorsal: a sail standing on the back
    for (let i = 0; i <= ND; i++) {
      const q = i / ND, u = DORSAL_U0 + q * (DORSAL_U1 - DORSAL_U0), s = spineAt(f, u, spine[NB + 4]);
      const top = y0 + s.w * thickness(u) * 1.1;
      const hgt = Math.pow(Math.sin(q * Math.PI), 0.7) * (0.85 + 0.15 * Math.sin(f.tailPhase * 1.3 - q * 6.0)) * L * 0.075;
      put(s.x, top, s.z);
      put(s.x, top + hgt, s.z);
    }
    fp.needsUpdate = true;
  }

  return {
    group,
    setField(w, h, ww, dw) { wPx = w; hPx = h; wW = ww; dW = dw; },
    update(fish, y, camera, reveal) {
      while (meshes.length < fish.length) meshes.push(makeMesh());
      meshes.forEach((m, i) => { m.body.visible = m.fins.visible = i < fish.length; });
      fish.forEach((f, i) => {
        const m = meshes[i];
        if (m.tex !== f.tex) {
          // a new fish (or a respawned one): its skin and colours
          m.tex = f.tex;
          m.bodyMat.uniforms.map.value = texFor(f.tex);
          m.bodyMat.uniforms.hot.value.copy(rgb(f.scheme.hot));
          m.bodyMat.uniforms.base.value.copy(rgb(f.scheme.base));
          m.finMat.uniforms.hot.value.copy(rgb(f.scheme.hot));
          m.finMat.uniforms.mid.value.copy(rgb(f.scheme.mid));
        }
        m.bodyMat.uniforms.uvOff.value = f.uvOff;
        m.bodyMat.uniforms.sweepU.value = ((f.texPhase * 0.15 + 0.2) % 1.2) - 0.1;
        m.bodyMat.uniforms.cam.value.copy(camera);
        m.bodyMat.uniforms.reveal.value = reveal;
        m.bodyMat.transparent = reveal < 1;
        m.finMat.uniforms.reveal.value = reveal;
        // a slow bob, each fish its own
        build(m, f, y + Math.sin(f.texPhase * 0.7 + f.uvOff * 6) * 0.04);
      });
    },
    dispose() {
      for (const m of meshes) { m.body.geometry.dispose(); m.fins.geometry.dispose(); m.bodyMat.dispose(); m.finMat.dispose(); }
      for (const t of textures.values()) t.dispose();
    },
  };
}
