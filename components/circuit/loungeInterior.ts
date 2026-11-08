// Inside the Venture Studios headquarters: the lobby, and floor 1, the CS2
// Department (the only floor open of the building's 34). Both share one
// layout for the elevator bank (three elevators in the wall at x = 20,
// facing into the room, the middle one in service), so a ride is the same
// camera move in either room and the switch happens behind closed doors.
//
// Room-local units, about a metre each, floor at y = 0. The lobby stands in
// the plaza itself (the caller puts it inside the headquarters' podium): its
// glass front is the building's facade, with sliding doors in the middle;
// floor 1 is out of sight, reached only by the elevator. Lit by real lights (only
// these rooms' materials use them).
import * as THREE from "three";
import { LOGO_ASPECT, makeSign } from "./loungeCampus";

export const ELEVATOR = { wallX: 20, z: -2, carBack: 22.6 }; // the middle elevator: its door plane, and the car's back wall
export interface Interior {
  lobby: THREE.Group;
  office: THREE.Group;
  setDoors(room: "lobby" | "office", open: number): void;
  setFrontDoors(open: number): void; // the lobby's sliding glass doors onto the plaza
  frontDoor: THREE.Vector3; // their middle, at eye height, in lobby units
  update(time: number): void;
  dispose(): void;
}

const ROOM = { x0: -20, x1: 20, z0: -15, z1: 15 };
const ELEV_Z = [-8, -2, 4];
const DOOR_W = 2.4, DOOR_H = 2.8;

export function buildInterior(): Interior {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const std = (color: number | THREE.Color, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    keep(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o }));
  const glow = (r: number, g: number, b: number) => keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) }));
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d")!);
    const t = keep(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    return t;
  };
  const hash = (i: number, j: number) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  // a text panel, drawn on a canvas, laid over a wall additively
  const textSign = (lines: { text: string; size: number; color: string; font?: string }[], w: number, h: number, pxW = 1024) => {
    const pxH = Math.round((pxW * h) / w);
    const t = canvasTex(pxW, pxH, (g) => {
      g.textAlign = "center"; g.textBaseline = "middle";
      const total = lines.reduce((s, l) => s + l.size * 1.35, 0);
      let y = pxH / 2 - total / 2;
      for (const l of lines) {
        y += (l.size * 1.35) / 2;
        g.font = l.font ?? `600 ${l.size}px Georgia, 'Times New Roman', serif`;
        g.fillStyle = l.color;
        g.fillText(l.text, pxW / 2, y);
        y += (l.size * 1.35) / 2;
      }
    });
    return new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), keep(new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  };
  // ── the shell both rooms share: floor, ceiling, walls, the elevator bank ──
  // `core`: no outer walls, only a compact core round the elevators (a glass floor)
  function shell(room: THREE.Group, H: number, floorMat: THREE.Material, wallMat: THREE.Material, ceilMat: THREE.Material, label: string, core = false) {
    const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0;
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    room.add(floor);
    const ceil = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    room.add(ceil);
    if (!core) {
      box(room, W, H, 0.4, wallMat, 0, H / 2, ROOM.z0 - 0.2); // back
      box(room, 0.4, H, D, wallMat, ROOM.x0 - 0.2, H / 2, 0); // left
    }
    // the elevator wall, around three openings (just the core's face, for a glass floor)
    const X = ELEVATOR.wallX + 0.2;
    const C0 = ELEV_Z[0] - DOOR_W / 2 - 1.2, C1 = ELEV_Z[2] + DOOR_W / 2 + 1.2;
    let z = core ? C0 : ROOM.z0;
    for (const ez of [...ELEV_Z, (core ? C1 : ROOM.z1) + DOOR_W / 2 + 0.2]) {
      const z1 = ez - DOOR_W / 2 - 0.2;
      if (z1 > z) box(room, 0.4, H, z1 - z, wallMat, X, H / 2, (z + z1) / 2);
      z = ez + DOOR_W / 2 + 0.2;
    }
    const steel = std(0x9aa3a0, { metalness: 0.85, roughness: 0.3 });
    const doors: THREE.Mesh[][] = [];
    for (const ez of ELEV_Z) {
      box(room, 0.4, H - DOOR_H - 0.2, DOOR_W + 0.4, wallMat, X, (H + DOOR_H + 0.2) / 2, ez); // above the door
      box(room, 0.46, 0.2, DOOR_W + 0.4, steel, X, DOOR_H + 0.1, ez); // frame
      for (const s of [-1, 1]) box(room, 0.46, DOOR_H, 0.2, steel, X, DOOR_H / 2, ez + s * (DOOR_W / 2 + 0.1));
      const pair = [-1, 1].map((s) => box(room, 0.06, DOOR_H, DOOR_W / 2, steel, ELEVATOR.wallX + 0.05, DOOR_H / 2, ez + (s * DOOR_W) / 4));
      doors.push(pair);
      // the floor indicator over each door, and a call button beside it
      const ind = textSign([{ text: `▲ ${label}`, size: 70, color: "#9dffb0", font: "600 70px ui-monospace, Menlo, monospace" }], 0.9, 0.3, 256);
      ind.rotation.y = -Math.PI / 2;
      ind.position.set(ELEVATOR.wallX - 0.02, DOOR_H + 0.45, ez);
      room.add(ind);
      box(room, 0.03, 0.12, 0.12, glow(1.6, 2.4, 1.7), ELEVATOR.wallX - 0.02, 1.15, ez + DOOR_W / 2 + 0.45);
    }
    // the middle elevator's car: brushed steel inside, a light in the ceiling
    {
      const z = ELEVATOR.z, x0 = ELEVATOR.wallX + 0.4, x1 = ELEVATOR.carBack, cw = DOOR_W + 0.6, ch = 3.0;
      // walls, ceiling and back: no front, so the doorway stays open
      const car = std(0x7d8582, { metalness: 0.7, roughness: 0.4 });
      box(room, 0.1, ch, cw, std(0x9aa29f, { metalness: 0.6, roughness: 0.25 }), x1 + 0.05, ch / 2, z);
      for (const s of [-1, 1]) box(room, x1 - x0 + 0.2, ch, 0.1, car, (x0 + x1) / 2, ch / 2, z + s * (cw / 2 + 0.05));
      box(room, x1 - x0 + 0.2, 0.1, cw, car, (x0 + x1) / 2, ch + 0.05, z);
      box(room, x1 - x0, 0.02, cw - 0.1, std(0x2a2f2c), (x0 + x1) / 2, 0.01, z);
      box(room, x0 - ELEVATOR.wallX, 0.02, DOOR_W, steel, (ELEVATOR.wallX + x0) / 2, 0.01, z); // the threshold
      box(room, 1.2, 0.03, 1.2, glow(1.05, 1.05, 1.0), (x0 + x1) / 2, ch - 0.02, z);
      box(room, 0.04, 0.04, cw - 0.3, steel, x1 - 0.1, 0.95, z); // handrail
      box(room, 0.03, 0.5, 0.25, std(0x202523), x0 + 0.4, 1.3, z - cw / 2 + 0.05); // button panel
      for (let i = 0; i < 4; i++) box(room, 0.04, 0.05, 0.05, glow(1.4, 2.2, 1.5), x0 + 0.38, 1.12 + i * 0.1, z - cw / 2 + 0.15);
      const light = new THREE.PointLight(0xfff4e0, 1.2, 4, 2);
      light.position.set((x0 + x1) / 2, ch - 0.4, z);
      room.add(light);
    }
    if (core) {
      // the rest of the core: sides, back and top, round the elevator shafts
      const xb = ELEVATOR.carBack + 0.9, xm = (X + 0.2 + xb) / 2, dx = xb - X - 0.2;
      for (const zz of [C0, C1]) box(room, dx, H, 0.4, wallMat, xm, H / 2, zz);
      box(room, 0.4, H, C1 - C0 + 0.4, wallMat, xb, H / 2, (C0 + C1) / 2);
      box(room, dx, 0.3, C1 - C0, wallMat, xm, H + 0.15, (C0 + C1) / 2);
    }
    return doors;
  }

  // ── the lobby ──────────────────────────────────────────────────────────
  const lobby = new THREE.Group();
  const LH = 9;
  const stoneFloor = std(0xffffff, {
    roughness: 0.55, metalness: 0,
    map: canvasTex(512, 512, (g) => {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const v = 196 + Math.floor(hash(i, j) * 26);
        g.fillStyle = `rgb(${v},${v + 2},${v - 2})`;
        g.fillRect(i * 128, j * 128, 128, 128);
        for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(90,96,92,${0.08 + hash(k, i + j) * 0.1})`; g.fillRect(i * 128 + hash(k, j) * 128, j * 128 + hash(i, k) * 128, 30, 2); }
      }
      g.strokeStyle = "rgba(60,64,62,0.6)"; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke(); }
    }, [40 / 12, 30 / 12]),
  });
  const lobbyWall = std(0x3b423f, { roughness: 0.6 });
  const lobbyDoors = shell(lobby, LH, stoneFloor, lobbyWall, std(0x1c211f), "L");
  // the glass front, onto the plaza, with sliding doors in the middle
  const FD = 4.4, FH = 3.3; // the doorway
  const frontDoors: THREE.Mesh[] = [];
  {
    const glass = keep(new THREE.MeshStandardMaterial({ color: 0x9fd8c0, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    const pane = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), glass);
      m.position.set(x, y, ROOM.z1);
      lobby.add(m);
    };
    const side = (40 - FD) / 2;
    pane(side, LH, -FD / 2 - side / 2, LH / 2);
    pane(side, LH, FD / 2 + side / 2, LH / 2);
    pane(FD, LH - FH, 0, FH + (LH - FH) / 2);
    const mull = std(0x1d2321, { metalness: 0.6, roughness: 0.4 });
    for (let x = -20; x <= 20; x += 4) if (Math.abs(x) > FD / 2 + 0.3) box(lobby, 0.12, LH, 0.2, mull, x, LH / 2, ROOM.z1);
    box(lobby, 40, 0.15, 0.2, mull, 0, FH + 0.07, ROOM.z1);
    for (const sx of [-1, 1]) box(lobby, 0.16, FH, 0.24, mull, (sx * FD) / 2, FH / 2, ROOM.z1);
    // the doors: two framed glass leaves that slide apart
    const leafGlass = keep(new THREE.MeshStandardMaterial({ color: 0xbfe8d6, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Mesh(keep(new THREE.PlaneGeometry(FD / 2, FH - 0.05)), leafGlass);
      const frame = new THREE.LineSegments(keep(new THREE.EdgesGeometry(keep(new THREE.PlaneGeometry(FD / 2, FH - 0.05)))), keep(new THREE.LineBasicMaterial({ color: 0x6f7d77 })));
      leaf.add(frame);
      leaf.position.set((sx * FD) / 4, FH / 2, ROOM.z1 + 0.15);
      leaf.userData.sx = sx;
      lobby.add(leaf);
      frontDoors.push(leaf);
    }
    // a mat inside the doors, and the canopy's light strip outside
    box(lobby, FD + 1, 0.02, 2.2, std(0x1e2422), 0, 0.01, ROOM.z1 - 1.3);
    box(lobby, FD + 2, 0.06, 0.06, glow(2.2, 2.0, 1.6), 0, FH + 0.4, ROOM.z1 + 0.25);
  }
  // the feature wall: warm wood slats behind the logo
  {
    const wood = std(0x6b4a2c, { roughness: 0.55 });
    for (let x = -11; x <= 11; x += 0.55) box(lobby, 0.22, LH - 0.4, 0.14, wood, x, LH / 2, ROOM.z0 + 0.1);
    box(lobby, 23, LH - 0.4, 0.05, std(0x1a1310), 0, LH / 2, ROOM.z0 + 0.02);
    const SW = 8.6, SH = SW / LOGO_ASPECT;
    lobby.add(makeSign({ x: 0, y: 5.3, z: ROOM.z0 + 0.3, w: SW, h: SH, kind: "logo" }, keep));
    lobby.add(makeSign({ x: 0, y: 5.3 - SH / 2 - 0.5, z: ROOM.z0 + 0.3, w: SW * 0.8, h: (SW * 0.8) / 8, kind: "dik" }, keep));
  }
  // the reception desk: a long white stone counter with a light strip
  {
    const white = std(0xe9ece8, { roughness: 0.3 });
    box(lobby, 9, 1.1, 1.3, white, 0, 0.55, -7.5);
    box(lobby, 9.4, 0.08, 1.5, std(0xf5f6f2, { roughness: 0.15 }), 0, 1.14, -7.5);
    box(lobby, 8.6, 0.05, 0.02, glow(1.6, 2.6, 1.8), 0, 0.12, -6.84);
    for (const x of [-2.5, 2.5]) box(lobby, 0.9, 0.55, 0.05, glow(0.35, 0.8, 0.5), x, 1.5, -7.9);
  }
  // a living wall on the left, columns, benches, potted trees
  {
    const moss = canvasTex(1024, 384, (g) => {
      g.fillStyle = "#123a1c"; g.fillRect(0, 0, 1024, 384);
      const tones = ["#1f5a2a", "#2a6c32", "#184a24", "#356f2c", "#3f8a3a", "#4e9a40"];
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = tones[Math.floor(hash(i, 5) * tones.length)];
        g.beginPath(); g.arc(hash(i, 6) * 1024, hash(i, 7) * 384, 6 + hash(i, 8) * 14, 0, 7); g.fill();
      }
    });
    const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(18, 6.5)), std(0xffffff, { map: moss, roughness: 1 }));
    wall.position.set(ROOM.x0 + 0.05, 4, 0);
    wall.rotation.y = Math.PI / 2;
    lobby.add(wall);
    box(lobby, 0.9, 0.6, 18, std(0x2a2f2c), ROOM.x0 + 0.45, 0.3, 0);
    const col = std(0xdfe2dd, { roughness: 0.4 });
    for (const [x, z] of [[-10, 4], [10, 4], [-10, -6], [10, -6]]) {
      const c = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.45, 0.45, LH, 24)), col);
      c.position.set(x, LH / 2, z);
      lobby.add(c);
    }
    const bench = std(0x7a5530, { roughness: 0.5 });
    for (const x of [-6, 6]) { box(lobby, 3.2, 0.12, 0.8, bench, x, 0.45, 9); box(lobby, 2.8, 0.4, 0.6, std(0x2a2f2c), x, 0.2, 9); }
    const pot = std(0x1e2622);
    const leaf = std(0x2e7a36, { flatShading: true });
    for (const [x, z] of [[-16, 12], [16, 12], [-16, -12], [14, -12]]) {
      const p = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.8, 0.65, 1.1, 20)), pot);
      p.position.set(x, 0.55, z);
      lobby.add(p);
      box(lobby, 0.12, 2.4, 0.12, std(0x4a3a24), x, 2, z);
      for (const [dx, dy, dz, r] of [[0, 3.6, 0, 1.1], [0.6, 3.1, 0.3, 0.8], [-0.5, 3.2, -0.3, 0.8]]) {
        const c = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(r, 1)), leaf);
        c.position.set(x + dx, dy, z + dz);
        lobby.add(c);
      }
    }
    // the directory, beside the elevators
    const dir = textSign([
      { text: "DIRECTORY", size: 44, color: "#9dffb0", font: "600 44px ui-monospace, Menlo, monospace" },
      { text: "1  ·  VENTURE STUDIOS  ·  CS2 DEPARTMENT", size: 38, color: "#ffffff", font: "500 38px ui-monospace, Menlo, monospace" },
      { text: "2 – 34  ·  OPENING SOON", size: 34, color: "#7f8a85", font: "500 34px ui-monospace, Menlo, monospace" },
    ], 3.6, 1.6, 1024);
    dir.rotation.y = -Math.PI / 2;
    dir.position.set(ELEVATOR.wallX - 0.02, 1.9, 9);
    lobby.add(dir);
    box(lobby, 0.04, 1.8, 3.8, std(0x141917), ELEVATOR.wallX - 0.04, 1.9, 9);
  }
  // ceiling light strips and the room's light
  for (let z = -12; z <= 12; z += 4) box(lobby, 30, 0.05, 0.25, glow(2, 2, 1.85), 0, LH - 0.04, z);
  lobby.add(new THREE.HemisphereLight(0xeef3ee, 0x2a2f2c, 1.3));
  {
    const sun = new THREE.DirectionalLight(0xfff3df, 1.2);
    sun.position.set(-8, 14, 10);
    lobby.add(sun);
    for (const [x, z] of [[0, -6], [-10, 6], [10, 6]]) {
      const l = new THREE.PointLight(0xffe8c4, 25, 22, 1.6);
      l.position.set(x, LH - 1.5, z);
      lobby.add(l);
    }
  }

  // ── floor 1: the CS2 Department ────────────────────────────────────────
  // A wall-less floor: glass all round onto the city, the elevator core the
  // only solid thing. Bright and playful: light oak, colour, plants, places
  // to think (a glass pod, whiteboards), to talk (a lounge, a long table),
  // to play (ping-pong) and to nap (pods).
  const office = new THREE.Group();
  const OH = 4.2;
  const oak = std(0xffffff, {
    roughness: 0.6,
    map: canvasTex(512, 512, (g) => {
      for (let i = 0; i < 16; i++) {
        const v = 0.86 + hash(i, 9) * 0.12;
        g.fillStyle = `rgb(${Math.round(222 * v)},${Math.round(190 * v)},${Math.round(150 * v)})`;
        g.fillRect(0, i * 32, 512, 32);
        for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(150,110,70,${0.08 + hash(i, k) * 0.08})`; g.fillRect(hash(k, i) * 512, i * 32 + hash(i + 1, k) * 30, 60 + hash(k, k) * 120, 1); }
        g.fillStyle = "rgba(120,90,60,0.35)"; g.fillRect(0, i * 32, 512, 1);
        g.fillRect(hash(i, 3) * 512, i * 32, 1, 32);
      }
    }, [40 / 8, 30 / 8]),
  });
  const coreMat = std(0xf4f1ea, { roughness: 0.9 });
  const officeDoors = shell(office, OH, oak, coreMat, std(0xb9b4ab, { roughness: 1 }), "1", true);
  const C = (h: number) => std(h, { roughness: 0.75 });
  const coral = C(0xff6b5a), mustard = C(0xffc24b), teal = C(0x2ec4b6), lilac = C(0x9b8cff), sky = C(0x6ec3ff), white = C(0xf6f5f0), oakDark = C(0xb7895a), green = C(0x3fae5a);
  const leaf = std(0x3e9a48, { flatShading: true, roughness: 0.8 });
  const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 24) => {
    const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(rt, rb, h, seg)), mat);
    m.position.set(x, y, z);
    office.add(m);
    return m;
  };
  const blob = (r: number, mat: THREE.Material, x: number, y: number, z: number, sy = 1, sx = 1, sz = 1) => {
    const m = new THREE.Mesh(keep(new THREE.SphereGeometry(r, 20, 14)), mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    office.add(m);
    return m;
  };
  const plant = (x: number, z: number, big = false) => {
    cyl(big ? 0.55 : 0.38, big ? 0.45 : 0.3, big ? 0.8 : 0.55, white, x, big ? 0.4 : 0.28, z);
    const h = big ? 2.4 : 1.2;
    if (big) cyl(0.06, 0.08, h - 0.6, oakDark, x, 0.8 + (h - 0.6) / 2, z, 6);
    for (const [dx, dy, dz, r] of big ? [[0, h, 0, 0.8], [0.45, h - 0.4, 0.2, 0.6], [-0.4, h - 0.35, -0.25, 0.6]] : [[0, 0.9, 0, 0.45], [0.25, 0.75, 0.1, 0.35], [-0.2, 0.8, -0.15, 0.35]]) {
      const c = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(r, 1)), leaf);
      c.position.set(x + dx, dy, z + dz);
      office.add(c);
    }
  };
  // glass all round, thin mullions, a slim sill
  {
    const glass = keep(new THREE.MeshStandardMaterial({ color: 0xcfeee4, transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    const mull = std(0x2a2f2c, { metalness: 0.6, roughness: 0.4 });
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
      const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(L, OH)), glass);
      pane.position.set((x0 + x1) / 2, OH / 2, (z0 + z1) / 2);
      pane.rotation.y = -a;
      office.add(pane);
      for (let t = 0; t <= L + 0.01; t += 2.5) {
        const m = box(office, 0.08, OH, 0.08, mull, x0 + Math.cos(a) * t, OH / 2, z0 + Math.sin(a) * t);
        void m;
      }
      const sill = box(office, L, 0.12, 0.3, mull, (x0 + x1) / 2, 0.06, (z0 + z1) / 2);
      sill.rotation.y = -a;
    };
    run(-20, -15, 20, -15); run(-20, 15, 20, 15); run(-20, -15, -20, 15);
    const C0 = ELEV_Z[0] - DOOR_W / 2 - 1.2, C1 = ELEV_Z[2] + DOOR_W / 2 + 1.2;
    run(20, -15, 20, C0); run(20, C1, 20, 15);
    // the city round about, at dusk: a ring of skyline
    const dusk = canvasTex(4096, 1024, (g) => {
      const grd = g.createLinearGradient(0, 0, 0, 1024);
      grd.addColorStop(0, "#14233f"); grd.addColorStop(0.45, "#3b4f86"); grd.addColorStop(0.62, "#d98b6a"); grd.addColorStop(0.7, "#f2c48a"); grd.addColorStop(0.71, "#1a2420"); grd.addColorStop(1, "#0d1311");
      g.fillStyle = grd; g.fillRect(0, 0, 4096, 1024);
      for (let i = 0; i < 160; i++) {
        const w = 50 + hash(i, 11) * 140, x = hash(i, 12) * 4096, h = 120 + hash(i, 13) * 420, y0 = 727 - h;
        g.fillStyle = hash(i, 14) < 0.5 ? "#1b2433" : "#232d3f";
        g.fillRect(x, y0, w, h);
        for (let wy = y0 + 8; wy < 720; wy += 12) for (let wx = x + 5; wx < x + w - 5; wx += 9) {
          if (hash(wx, wy) < 0.38) { g.fillStyle = hash(wy, wx) < 0.6 ? "#ffd99a" : "#bfe9ff"; g.fillRect(wx, wy, 4, 6); }
        }
      }
    });
    dusk.wrapS = THREE.RepeatWrapping;
    const ring = new THREE.Mesh(keep(new THREE.CylinderGeometry(70, 70, 60, 64, 1, true)), keep(new THREE.MeshBasicMaterial({ map: dusk, side: THREE.BackSide })));
    ring.position.y = 8;
    office.add(ring);
    const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(70, 48)), keep(new THREE.MeshBasicMaterial({ color: 0x0d1311 })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -12;
    office.add(ground);
  }
  // the department's sign: a freestanding oak feature wall, moss on the back
  {
    box(office, 15, 3.3, 0.3, oakDark, -1, 1.65, -11.5);
    const LW = 3.6;
    office.add(makeSign({ x: -5.5, y: 1.95, z: -11.3, w: LW, h: LW / LOGO_ASPECT, kind: "logo" }, keep));
    const t = textSign([
      { text: "CS2 DEPARTMENT", size: 120, color: "#ffffff" },
      { text: "VENTURE STUDIOS  ·  FLOOR 1", size: 52, color: "#ffe08a" },
    ], 9.5, 2.0, 1600);
    t.position.set(2.2, 1.95, -11.33);
    office.add(t);
    const moss = std(0x2f7a3a, { roughness: 1 });
    box(office, 14.6, 3.0, 0.05, moss, -1, 1.65, -11.68);
  }
  // the lounge: a big round rug, a curved sofa, bean bags, a low table
  {
    const rug = new THREE.Mesh(keep(new THREE.CircleGeometry(4.2, 48)), C(0xffd7a8));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-12, 0.01, 6);
    office.add(rug);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(3.3, 3.6, 48)), coral);
    ring.rotation.x = -Math.PI / 2; ring.position.set(-12, 0.015, 6);
    office.add(ring);
    // a curved sofa: segments round an arc
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.95 + (i / 8) * Math.PI * 0.9, r = 3;
      const seat = box(office, 1.1, 0.45, 0.9, teal, -12 + Math.cos(a) * r, 0.25, 6 + Math.sin(a) * r);
      seat.rotation.y = -a + Math.PI / 2;
      const back = box(office, 1.1, 0.55, 0.25, teal, -12 + Math.cos(a) * (r + 0.4), 0.7, 6 + Math.sin(a) * (r + 0.4));
      back.rotation.y = -a + Math.PI / 2;
    }
    cyl(0.9, 0.9, 0.08, white, -12, 0.42, 6.4);
    cyl(0.12, 0.2, 0.4, oakDark, -12, 0.2, 6.4, 10);
    for (const [x, z, m] of [[-9.6, 8.6, mustard], [-10.6, 9.8, lilac], [-13.8, 9.6, coral], [-8.8, 6.6, sky]] as const) blob(0.6, m, x, 0.35, z, 0.62, 1.05, 1.05);
    // a floor lamp, big and round
    cyl(0.04, 0.04, 2.6, std(0x222222), -15.6, 1.3, 8.6, 8);
    blob(0.4, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.0) })), -15.6, 2.7, 8.6);
  }
  // nap pods along the far window: capsules with a soft bed, a round porthole
  for (const [x, m] of [[-16.5, mustard], [-13.2, sky], [-9.9, lilac]] as const) {
    const pod = new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.85, 1.6, 8, 20)), m);
    pod.rotation.x = Math.PI / 2; pod.position.set(x, 0.95, 12.6);
    office.add(pod);
    const opening = new THREE.Mesh(keep(new THREE.CircleGeometry(0.62, 24)), std(0x2b2f3a));
    opening.position.set(x, 0.95, 11.35);
    opening.rotation.y = Math.PI;
    office.add(opening);
    blob(0.5, white, x, 0.75, 11.6, 0.3, 1.1, 0.4); // the pillow peeking out
  }
  // the think tank: a round glass meeting pod with a round table
  {
    const glassPod = keep(new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.18, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    cyl(3, 3, 3.2, glassPod, -12, 1.6, -7, 40).material = glassPod;
    cyl(3.05, 3.05, 0.12, white, -12, 3.26, -7, 40);
    cyl(1.2, 1.2, 0.06, white, -12, 0.76, -7);
    cyl(0.1, 0.25, 0.74, std(0x333333), -12, 0.37, -7, 10);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; cyl(0.32, 0.32, 0.45, [coral, mustard, teal][i % 3], -12 + Math.cos(a) * 1.8, 0.23, -7 + Math.sin(a) * 1.8, 16); }
    // a whiteboard full of doodles beside it
    const doodles = canvasTex(1024, 512, (g) => {
      g.fillStyle = "#fbfbf8"; g.fillRect(0, 0, 1024, 512);
      const ink = ["#2ec4b6", "#ff6b5a", "#4b6bff", "#1f8a3a", "#222"];
      g.lineWidth = 5; g.lineCap = "round";
      for (let i = 0; i < 16; i++) {
        g.strokeStyle = ink[i % ink.length]; g.beginPath();
        const x = 60 + hash(i, 1) * 880, y = 60 + hash(i, 2) * 380;
        if (i % 4 === 0) g.arc(x, y, 20 + hash(i, 3) * 40, 0, 7);
        else if (i % 4 === 1) { g.moveTo(x, y); g.lineTo(x + 120, y - 40); g.lineTo(x + 240, y + 10); }
        else if (i % 4 === 2) g.strokeRect(x, y, 90, 50);
        else { g.moveTo(x, y); for (let k = 1; k < 8; k++) g.lineTo(x + k * 24, y - Math.sin(k) * 30 - k * 6); }
        g.stroke();
      }
      g.fillStyle = "#222"; g.font = "bold 44px 'Comic Sans MS', 'Marker Felt', sans-serif";
      g.fillText("TRADE-UP IDEAS", 60, 60); g.fillStyle = "#ff6b5a"; g.fillText("ship it! ✓", 680, 470);
    });
    const wb = new THREE.Mesh(keep(new THREE.PlaneGeometry(4.2, 2.1)), std(0xffffff, { map: doodles, roughness: 0.3 }));
    wb.position.set(-6.5, 1.6, -8.6); wb.rotation.y = Math.PI / 5;
    office.add(wb);
    for (const s2 of [-1, 1]) { const leg = box(office, 0.06, 1.6, 0.06, std(0x888888, { metalness: 0.6 }), -6.5 + s2 * 1.7 * Math.cos(Math.PI / 5), 0.8, -8.6 - s2 * 1.7 * Math.sin(Math.PI / 5)); void leg; }
  }
  // the long table: oak, colourful chairs, a few laptops glowing
  const screenTex = canvasTex(256, 160, (g) => {
    g.fillStyle = "#0b1d14"; g.fillRect(0, 0, 256, 160);
    g.strokeStyle = "rgba(51,255,51,0.25)"; g.lineWidth = 1;
    for (let x = 0; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 160); g.stroke(); }
    g.strokeStyle = "#5dff7a"; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, 110 - Math.sin(x * 0.05) * 30 - x * 0.2 + hash(x, 3) * 12);
    g.stroke();
    g.fillStyle = "#ffc24b"; g.fillRect(14, 14, 60, 10);
  }, [1, 1]);
  screenTex.wrapS = THREE.RepeatWrapping;
  const screen = keep(new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.2, 1.25, 1.2) }));
  {
    box(office, 10, 0.08, 1.8, std(0xe6c9a1, { roughness: 0.5 }), 3, 0.76, 3.5);
    for (const x of [-1.5, 7.5]) box(office, 0.12, 0.72, 1.4, std(0x2a2a2a), x, 0.36, 3.5);
    const cols = [coral, mustard, teal, lilac, sky];
    for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) {
      const x = -1 + i * 1.65, z = 3.5 + sd * 1.25;
      box(office, 0.5, 0.06, 0.5, cols[(i + (sd > 0 ? 2 : 0)) % cols.length], x, 0.46, z);
      box(office, 0.5, 0.5, 0.06, cols[(i + (sd > 0 ? 2 : 0)) % cols.length], x, 0.72, z + sd * 0.24);
      for (const dx of [-0.2, 0.2]) box(office, 0.04, 0.46, 0.04, std(0x333333), x + dx, 0.23, z);
      if ((i + (sd > 0 ? 1 : 0)) % 2 === 0) {
        box(office, 0.42, 0.02, 0.3, std(0xcfd2d4, { metalness: 0.6 }), x, 0.81, 3.5 + sd * 0.45);
        const s3 = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.4, 0.26)), screen);
        s3.position.set(x, 0.95, 3.5 + sd * 0.6); s3.rotation.x = sd > 0 ? -0.25 : 0.25; if (sd < 0) s3.rotation.y = Math.PI;
        office.add(s3);
      }
    }
    // pendant lights over it: big coloured domes
    for (let i = 0; i < 3; i++) {
      const x = -0.5 + i * 3.5;
      cyl(0.015, 0.015, 1.3, std(0x222222), x, OH - 0.65, 3.5, 6);
      const dome = new THREE.Mesh(keep(new THREE.SphereGeometry(0.45, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), [mustard, coral, teal][i]);
      dome.position.set(x, OH - 1.35, 3.5);
      office.add(dome);
      blob(0.16, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.6, 1.2) })), x, OH - 1.4, 3.5);
    }
  }
  // standing desks in a loose zig-zag by the window, each with a monitor
  for (let i = 0; i < 5; i++) {
    const x = -4 + i * 3.6, z = -13 + (i % 2) * 0.8;
    box(office, 2.0, 0.06, 0.9, white, x, 1.08, z);
    for (const dx of [-0.85, 0.85]) box(office, 0.06, 1.06, 0.06, std(0x333333), x + dx, 0.53, z);
    box(office, 0.9, 0.52, 0.04, std(0x1a1a1a), x, 1.45, z - 0.25);
    const s4 = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.84, 0.46)), screen);
    s4.position.set(x, 1.45, z - 0.225);
    office.add(s4);
    box(office, 0.55, 0.65, 0.55, [coral, teal, mustard, lilac, sky][i], x, 0.33, z + 0.9); // a perch stool
  }
  // ping-pong in the open middle
  {
    box(office, 2.74, 0.06, 1.52, std(0x1f6fd6, { roughness: 0.5 }), 6, 0.76, -5.5);
    box(office, 2.74, 0.004, 0.03, white, 6, 0.795, -5.5);
    box(office, 0.02, 0.16, 1.6, std(0xeeeeee), 6, 0.86, -5.5);
    for (const [dx, dz] of [[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]]) box(office, 0.06, 0.74, 0.06, std(0x333333), 6 + dx, 0.37, -5.5 + dz);
    blob(0.05, white, 6.4, 0.84, -5.3);
    const rug2 = new THREE.Mesh(keep(new THREE.CircleGeometry(2.6, 40)), C(0xd8f3ee));
    rug2.rotation.x = -Math.PI / 2; rug2.position.set(6, 0.01, -5.5); rug2.scale.set(1.5, 1, 1);
    office.add(rug2);
  }
  // plants everywhere, and a hanging garden over the lounge
  for (const [x, z, big] of [[-18, -13, true], [-18, 2, true], [-5, 12.5, true], [3, 12.5, false], [9, 9, true], [14, -12.5, true], [-1, -9, false], [12, 7.5, false]] as const) plant(x, z, big);
  for (let i = 0; i < 7; i++) {
    const x = -15 + i * 1.2, z = 6 + Math.sin(i) * 1.5;
    cyl(0.01, 0.01, 0.8, std(0x333333), x, OH - 0.4, z, 4);
    cyl(0.22, 0.16, 0.25, white, x, OH - 0.9, z, 12);
    for (let k = 0; k < 3; k++) blob(0.12, leaf, x + (hash(i, k) - 0.5) * 0.3, OH - 1.05 - k * 0.18, z + (hash(k, i) - 0.5) * 0.3);
  }
  // round ceiling lights everywhere, and bright, even light
  for (let x = -16; x <= 16; x += 5) for (let z = -12; z <= 12; z += 5) {
    const d = new THREE.Mesh(keep(new THREE.CircleGeometry(0.45, 24)), glow(1.05, 1.03, 0.98));
    d.rotation.x = Math.PI / 2; d.position.set(x, OH - 0.02, z);
    office.add(d);
  }
  office.add(new THREE.HemisphereLight(0xffffff, 0xe6d8c4, 1.3));
  {
    const l = new THREE.DirectionalLight(0xfff1dc, 1.2);
    l.position.set(-10, 12, 8);
    office.add(l);
    for (const [x, z] of [[-11, -5], [-11, 7], [2, -6], [2, 6], [12, 0]]) {
      const p = new THREE.PointLight(0xfff6ea, 4, 14, 1.6);
      p.position.set(x, OH - 0.5, z);
      office.add(p);
    }
  }

  const doorsOf = { lobby: lobbyDoors[1], office: officeDoors[1] };
  return {
    lobby,
    office,
    frontDoor: new THREE.Vector3(0, 1.7, ROOM.z1),
    setFrontDoors(open) {
      const k = Math.min(1, Math.max(0, open));
      for (const d of frontDoors) d.position.x = (d.userData.sx * FD) / 4 + d.userData.sx * k * (FD / 2 - 0.1);
    },
    setDoors(room, open) {
      const k = Math.min(1, Math.max(0, open));
      const [a, b] = doorsOf[room];
      a.position.z = ELEVATOR.z - DOOR_W / 4 - k * (DOOR_W / 2 - 0.05);
      b.position.z = ELEVATOR.z + DOOR_W / 4 + k * (DOOR_W / 2 - 0.05);
    },
    update(time) {
      screenTex.offset.x = (time * 0.03) % 1;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
