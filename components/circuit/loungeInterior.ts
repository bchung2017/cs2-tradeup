// Inside the Venture Studios headquarters: the lobby, and floor 1, the CS2
// Department (the only floor open of the building's 34). Both share one
// layout for the elevator bank (three elevators in the wall at x = 20,
// facing into the room, the middle one in service), so a ride is the same
// camera move in either room and the switch happens behind closed doors.
//
// Room-local units, about a metre each, floor at y = 0; the caller places
// each room somewhere out of sight of the plaza. Lit by real lights (only
// these rooms' materials use them).
import * as THREE from "three";
import { LOGO_ASPECT, makeSign } from "./loungeCampus";

export const ELEVATOR = { wallX: 20, z: -2, carBack: 22.6 }; // the middle elevator: its door plane, and the car's back wall
export interface Interior {
  lobby: THREE.Group;
  office: THREE.Group;
  setDoors(room: "lobby" | "office", open: number): void;
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
  // a night skyline, for the views out of the windows
  const skyline = canvasTex(2048, 512, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, "#020806"); grd.addColorStop(1, "#0c2216");
    g.fillStyle = grd; g.fillRect(0, 0, 2048, 512);
    for (let i = 0; i < 70; i++) {
      const w = 40 + hash(i, 1) * 110, x = hash(i, 2) * 2048, h = 120 + hash(i, 3) * 360;
      g.fillStyle = hash(i, 4) < 0.5 ? "#0a1611" : "#0e1d17";
      g.fillRect(x, 512 - h, w, h);
      for (let wy = 512 - h + 10; wy < 500; wy += 14) for (let wx = x + 6; wx < x + w - 6; wx += 10) {
        if (hash(wx, wy) < 0.32) { g.fillStyle = hash(wy, wx) < 0.7 ? "#9fe8b4" : "#f1dd9a"; g.fillRect(wx, wy, 5, 7); }
      }
    }
  });

  // ── the shell both rooms share: floor, ceiling, walls, the elevator bank ──
  function shell(room: THREE.Group, H: number, floorMat: THREE.Material, wallMat: THREE.Material, ceilMat: THREE.Material, label: string) {
    const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0;
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    room.add(floor);
    const ceil = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, D)), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    room.add(ceil);
    box(room, W, H, 0.4, wallMat, 0, H / 2, ROOM.z0 - 0.2); // back
    box(room, 0.4, H, D, wallMat, ROOM.x0 - 0.2, H / 2, 0); // left
    // the elevator wall, around three openings
    const X = ELEVATOR.wallX + 0.2;
    let z = ROOM.z0;
    for (const ez of [...ELEV_Z, ROOM.z1 + DOOR_W / 2]) {
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
    return doors;
  }

  // ── the lobby ──────────────────────────────────────────────────────────
  const lobby = new THREE.Group();
  const LH = 9;
  const stoneFloor = std(0xffffff, {
    roughness: 0.22, metalness: 0.15,
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
  // the glass front, with the plaza at night beyond it
  {
    const glass = keep(new THREE.MeshStandardMaterial({ color: 0x9fd8c0, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2 }));
    const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(40, LH)), glass);
    pane.position.set(0, LH / 2, ROOM.z1);
    pane.rotation.y = Math.PI;
    lobby.add(pane);
    const mull = std(0x1d2321, { metalness: 0.6, roughness: 0.4 });
    for (let x = -20; x <= 20; x += 4) box(lobby, 0.12, LH, 0.2, mull, x, LH / 2, ROOM.z1);
    box(lobby, 40, 0.15, 0.2, mull, 0, 3.4, ROOM.z1);
    const out = new THREE.Mesh(keep(new THREE.PlaneGeometry(90, 26)), keep(new THREE.MeshBasicMaterial({ map: skyline, color: new THREE.Color(0.9, 1, 0.95) })));
    out.position.set(0, 8, ROOM.z1 + 14);
    out.rotation.y = Math.PI;
    lobby.add(out);
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
  const office = new THREE.Group();
  const OH = 4.2;
  const carpet = std(0xffffff, {
    roughness: 0.95,
    map: canvasTex(256, 256, (g) => {
      g.fillStyle = "#4c5550"; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 3000; i++) { g.fillStyle = hash(i, 1) < 0.5 ? "#56605a" : "#414945"; g.fillRect(hash(i, 2) * 256, hash(i, 3) * 256, 2, 2); }
      g.strokeStyle = "rgba(20,24,22,0.7)"; g.strokeRect(0, 0, 256, 256);
    }, [40 / 4, 30 / 4]),
  });
  const plaster = std(0xd9ddd8, { roughness: 0.9 });
  const officeDoors = shell(office, OH, carpet, plaster, std(0xeef0ec), "1");
  // the window wall on the left, the city at night beyond it
  {
    const glass = keep(new THREE.MeshStandardMaterial({ color: 0x9fd8c0, transparent: true, opacity: 0.1, roughness: 0.05 }));
    const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(30, OH)), glass);
    pane.position.set(ROOM.x0 + 0.25, OH / 2, 0);
    pane.rotation.y = Math.PI / 2;
    office.add(pane);
    const mull = std(0x1d2321, { metalness: 0.6, roughness: 0.4 });
    for (let z = -15; z <= 15; z += 3) box(office, 0.2, OH, 0.12, mull, ROOM.x0 + 0.2, OH / 2, z);
    const out = new THREE.Mesh(keep(new THREE.PlaneGeometry(80, 22)), keep(new THREE.MeshBasicMaterial({ map: skyline })));
    out.position.set(ROOM.x0 - 16, 2, 0);
    out.rotation.y = Math.PI / 2;
    office.add(out);
  }
  // the department's sign on the back wall
  {
    box(office, 22, 3.4, 0.06, std(0x14191a), 0, 2.2, ROOM.z0 + 0.03);
    const LW = 4.2;
    office.add(makeSign({ x: -6.5, y: 2.2, z: ROOM.z0 + 0.12, w: LW, h: LW / LOGO_ASPECT, kind: "logo" }, keep));
    const t = textSign([
      { text: "CS2 DEPARTMENT", size: 120, color: "#ffffff" },
      { text: "VENTURE STUDIOS  ·  FLOOR 1", size: 52, color: "#e2c27a" },
    ], 13, 2.6, 1600);
    t.position.set(3.2, 2.2, ROOM.z0 + 0.12);
    office.add(t);
  }
  // desks in pods of four, each with two glowing monitors
  const screenTex = canvasTex(256, 160, (g) => {
    g.fillStyle = "#04140a"; g.fillRect(0, 0, 256, 160);
    g.strokeStyle = "rgba(51,255,51,0.25)"; g.lineWidth = 1;
    for (let x = 0; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 160); g.stroke(); }
    for (let y = 0; y < 160; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    g.strokeStyle = "#5dff7a"; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, 110 - Math.sin(x * 0.05) * 30 - x * 0.2 + hash(x, 3) * 12);
    g.stroke();
    g.fillStyle = "#e2c27a"; g.fillRect(14, 14, 60, 10);
  }, [1, 1]);
  screenTex.wrapS = THREE.RepeatWrapping;
  {
    const top = std(0xf2f3ef, { roughness: 0.4 }), leg = std(0x2a2f2c, { metalness: 0.5 }), chair = std(0x1e2422);
    const screen = keep(new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.3, 1.4, 1.3) }));
    for (const x of [-14, -8, -2, 4]) for (const z of [-8, -2.5, 3, 8.5]) {
      box(office, 3.2, 0.06, 1.8, top, x, 0.74, z);
      for (const [dx, dz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) box(office, 0.06, 0.72, 0.06, leg, x + dx, 0.36, z + dz);
      for (const side of [-1, 1]) for (const dx of [-0.8, 0.8]) {
        box(office, 0.7, 0.42, 0.04, leg, x + dx, 1.1, z + side * 0.25);
        const s = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.64, 0.36)), screen);
        s.position.set(x + dx, 1.1, z + side * 0.25 + side * 0.03);
        if (side < 0) s.rotation.y = Math.PI;
        office.add(s);
        box(office, 0.55, 0.5, 0.55, chair, x + dx, 0.5, z + side * 1.25);
        box(office, 0.55, 0.6, 0.08, chair, x + dx, 0.95, z + side * 1.5);
      }
    }
    // planters between the pods, a big market screen on the front wall
    const leaf = std(0x2e7a36, { flatShading: true });
    for (const x of [-11, -5, 1]) {
      box(office, 1.6, 0.7, 0.6, std(0x2a2f2c), x, 0.35, 0.25);
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.38, 1)), leaf);
        c.position.set(x - 0.5 + i * 0.5, 0.95, 0.25);
        office.add(c);
      }
    }
    const big = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 2.6)), screen);
    big.position.set(-4, 2.2, ROOM.z1 - 0.05);
    big.rotation.y = Math.PI;
    office.add(big);
  }
  for (let x = -16; x <= 12; x += 4) for (let z = -12; z <= 12; z += 4) box(office, 1.2, 0.04, 1.2, glow(1.0, 1.02, 1.0), x, OH - 0.03, z);
  office.add(new THREE.HemisphereLight(0xf2f6f2, 0x2a2f2c, 1.4));
  {
    const l = new THREE.DirectionalLight(0xffffff, 0.8);
    l.position.set(-10, 12, 6);
    office.add(l);
    for (const [x, z] of [[-10, -5], [-10, 6], [2, -5], [2, 6]]) {
      const p = new THREE.PointLight(0xf4fff6, 7, 14, 1.6);
      p.position.set(x, OH - 0.5, z);
      office.add(p);
    }
  }

  const doorsOf = { lobby: lobbyDoors[1], office: officeDoors[1] };
  return {
    lobby,
    office,
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
