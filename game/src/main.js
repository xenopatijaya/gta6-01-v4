// DUSKFALL — Marlowe City. An original open-world crime game (three.js, no network).
// City, characters, story and art are all invented for this game.
import * as THREE from '../vendor/three.module.min.js';

// ---------- utils ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
function angLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
  return a + d * t;
}
function dist2d(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }

// ---------- config ----------
const CITY = 176;                 // half-extent of the playable city
const ROADS = [-156, -104, -52, 0, 52, 104, 156];
const ROAD_W = 12, BLOCK = 40;
const SAVE_KEY = 'duskfall.save.v1';
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const SEED = Number.isInteger(seedParam) ? seedParam : (Math.random() * 1e9) | 0;
const rng = mulberry32(SEED);

// ---------- audio (all synthesized, no files) ----------
const AudioSys = {
  ctx: null, master: null, muted: false, engineOsc: null, engineGain: null, sirenOsc: null, sirenGain: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.engineOsc = this.ctx.createOscillator(); this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 50;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      this.engineOsc.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.sirenOsc = this.ctx.createOscillator(); this.sirenOsc.type = 'square';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    } catch { /* audio is optional */ }
  },
  setEngine(speed01, on) {
    if (!this.ctx) return;
    this.engineOsc.frequency.value = 45 + speed01 * 160;
    this.engineGain.gain.value = on ? 0.045 + speed01 * 0.05 : 0;
  },
  setSiren(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.cancelScheduledValues(t);
    this.sirenGain.gain.setValueAtTime(this.sirenGain.gain.value, t);
    this.sirenGain.gain.linearRampToValueAtTime(on ? 0.02 : 0, t + 0.4);
    if (on) { this.sirenOsc.frequency.setValueAtTime(660, t); this.sirenOsc.frequency.linearRampToValueAtTime(880, t + 0.45); }
  },
  blip(freq, dur = 0.12, type = 'sine', vol = 0.16) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  },
  jingle() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'triangle', 0.2), i * 110)); },
  thud() { this.blip(90, 0.18, 'sawtooth', 0.25); },
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; return this.muted; },
};

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2140);
scene.fog = new THREE.Fog(0x1b2140, 120, 420);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

const hemi = new THREE.HemisphereLight(0x8a7bff, 0x1a1410, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
sun.position.set(-120, 180, 60);
scene.add(sun);
const moonFill = new THREE.DirectionalLight(0x4d6fff, 0.35);
moonFill.position.set(100, 80, -120);
scene.add(moonFill);

// dusk sky dome (gradient shader, local asset — no texture files)
{
  const geo = new THREE.SphereGeometry(800, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){ float h = normalize(vP).y;
        vec3 top = vec3(0.07,0.08,0.22); vec3 mid = vec3(0.45,0.20,0.42); vec3 low = vec3(0.98,0.45,0.25);
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.65, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// ---------- canvas textures (generated locally) ----------
function windowTexture(base, lit) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 120; y += 14) for (let x = 6; x < 58; x += 12) {
    g.fillStyle = rng() < 0.55 ? lit : '#10131f';
    g.fillRect(x, y, 7, 9);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function signTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg; g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function roadTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#23262e'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f7c948'; g.fillRect(62, 8, 4, 40); g.fillRect(62, 80, 4, 40);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(4, 0, 3, 128); g.fillRect(121, 0, 3, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- city ----------
const colliders = [];   // {minX,maxX,minZ,maxZ}
const buildingMats = [
  new THREE.MeshStandardMaterial({ map: windowTexture('#2c3247', '#ffd98a'), roughness: 0.9, emissive: 0xffffff, emissiveMap: windowTexture('#000000', '#ffd98a'), emissiveIntensity: 0.35 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#3a2f3d', '#9fd8ff'), roughness: 0.9, emissive: 0xffffff, emissiveMap: windowTexture('#000000', '#9fd8ff'), emissiveIntensity: 0.3 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#27303a', '#ffb36b'), roughness: 0.9, emissive: 0xffffff, emissiveMap: windowTexture('#000000', '#ffb36b'), emissiveIntensity: 0.3 }),
];
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function addBuilding(x, z, w, d, h, mat) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d); m.position.set(x, h / 2, z);
  scene.add(m);
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  if (rng() < 0.4) { // rooftop box
    const r = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x1c2030, roughness: 1 }));
    r.scale.set(w * 0.3, 2.5, d * 0.3); r.position.set(x, h + 1.2, z); scene.add(r);
  }
}
function buildCity() {
  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY * 2 + 260, CITY * 2 + 260),
    new THREE.MeshStandardMaterial({ color: 0x171a24, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  // ocean on the west edge
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(300, CITY * 2 + 260),
    new THREE.MeshStandardMaterial({ color: 0x0d2b45, roughness: 0.25, metalness: 0.5 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(-(CITY + 150), 0.05, 0); scene.add(sea);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(24, CITY * 2 + 260),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 }));
  beach.rotation.x = -Math.PI / 2; beach.position.set(-(CITY + 12), 0.06, 0); scene.add(beach);

  const roadTex = roadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
  const walkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4d, roughness: 1 });
  for (const r of ROADS) {
    for (const horizontal of [true, false]) {
      const len = CITY * 2 + 40;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD_W), roadMat.clone());
      road.material.map = roadTex.clone(); road.material.map.needsUpdate = true;
      road.material.map.repeat.set(len / 12, 1);
      road.rotation.x = -Math.PI / 2;
      if (horizontal) { road.position.set(0, 0.1, r); } else { road.rotation.z = Math.PI / 2; road.position.set(r, 0.1, 0); }
      scene.add(road);
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(len, 3), walkMat);
      walk.rotation.x = -Math.PI / 2;
      if (horizontal) walk.position.set(0, 0.08, r + ROAD_W / 2 + 1.5);
      else { walk.rotation.z = Math.PI / 2; walk.position.set(r + ROAD_W / 2 + 1.5, 0.08, 0); }
      scene.add(walk);
    }
  }
  // blocks of buildings
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
    if (cx < -CITY + 30) continue; // keep the beach clear
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const w = 12 + rng() * 16, d = 12 + rng() * 16, h = 10 + rng() * rng() * 55;
      const x = cx + (rng() - 0.5) * (BLOCK - w - 4), z = cz + (rng() - 0.5) * (BLOCK - d - 4);
      addBuilding(x, z, w, d, h, buildingMats[Math.floor(rng() * buildingMats.length)]);
    }
  }
  // street lamps + palms
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.6 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc860, emissiveIntensity: 2 });
  const lampGeo = new THREE.CylinderGeometry(0.12, 0.16, 6, 6);
  const bulbGeo = new THREE.SphereGeometry(0.35, 8, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f6b34, roughness: 1 });
  for (const r of ROADS) for (let s = -150; s <= 150; s += 52) {
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(s, 3, r + ROAD_W / 2 + 3.4); scene.add(lamp);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(s, 6.2, r + ROAD_W / 2 + 3.4); scene.add(bulb);
    if (rng() < 0.6) {
      const tx = s + 12, tz = r - ROAD_W / 2 - 3;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 5, 6), trunkMat);
      trunk.position.set(tx, 2.5, tz); scene.add(trunk);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.4, 7), leafMat);
      leaves.position.set(tx, 6.4, tz); scene.add(leaves);
    }
  }
  // neon signs (original fictional businesses)
  const signs = [
    ['HOTEL LUMEN', '#ff2d78', '#ffffff', 60, -140, 0],
    ['TACOS 24H', '#00e5ff', '#06222b', -60, 140, 1],
    ['MARLOWE PIER', '#ffb03d', '#241503', -140, 60, 2],
    ['QUINN & CO', '#7dffb0', '#062b16', 140, -60, 3],
  ];
  for (const [text, bg, fg, x, z, face] of signs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5),
      new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) }));
    m.position.set(x, 14, z);
    m.rotation.y = face * Math.PI / 2;
    scene.add(m);
  }
}
buildCity();

// collision resolve for a circle (x,z,r) against building AABBs
function collideCircle(p, r) {
  for (const c of colliders) {
    const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r;
      return true;
    }
    if (d2 <= 0.0001) { p.x += r; return true; }
  }
  return false;
}
function onRoad(x, z) {
  for (const r of ROADS) if (Math.abs(z - r) < ROAD_W / 2 + 1 || Math.abs(x - r) < ROAD_W / 2 + 1) return true;
  return false;
}
function nearestRoadCoord(v) {
  let best = ROADS[0], bd = 1e9;
  for (const r of ROADS) { const d = Math.abs(v - r); if (d < bd) { bd = d; best = r; } }
  return best;
}

// ---------- vehicles ----------
const CAR_COLORS = [0xd23c3c, 0x3c7dd2, 0xe8b93c, 0x37b06a, 0x8a5fd2, 0xd2d2d2, 0x222831, 0xff7a3d];
const CAR_NAMES = ['Comet', 'Vanta', 'Bison', 'Striker', 'Marlin', 'Prowler', 'Dune', 'Falcon'];
function makeCarMesh(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0e1622, roughness: 0.15, metalness: 0.8 });
  const body = new THREE.Mesh(boxGeo, paint); body.scale.set(2, 0.62, 4.4); body.position.y = 0.62; g.add(body);
  const cabin = new THREE.Mesh(boxGeo, glass); cabin.scale.set(1.7, 0.55, 2.1); cabin.position.set(0, 1.18, -0.25); g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.36, wz); g.add(w);
  }
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 1.6 });
  for (const s of [-0.6, 0.6]) {
    const l = new THREE.Mesh(boxGeo, lightMat); l.scale.set(0.4, 0.18, 0.1); l.position.set(s, 0.7, 2.22); g.add(l);
  }
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xaa0000, emissiveIntensity: 1.2 });
  for (const s of [-0.6, 0.6]) {
    const l = new THREE.Mesh(boxGeo, tailMat); l.scale.set(0.4, 0.18, 0.1); l.position.set(s, 0.7, -2.22); g.add(l);
  }
  // blob shadow
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; g.add(sh);
  return g;
}
function makeCar(x, z, heading, colorIdx) {
  const mesh = makeCarMesh(CAR_COLORS[colorIdx % CAR_COLORS.length]);
  mesh.position.set(x, 0, z); mesh.rotation.y = heading;
  scene.add(mesh);
  return { mesh, x, z, heading, speed: 0, colorIdx, name: CAR_NAMES[colorIdx % CAR_NAMES.length], hp: 100 };
}

// ---------- people ----------
function makePersonMesh(shirt, pants, skin) {
  const g = new THREE.Group();
  const mShirt = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const mPants = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const mSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const torso = new THREE.Mesh(boxGeo, mShirt); torso.scale.set(0.62, 0.72, 0.34); torso.position.y = 1.12; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mSkin); head.position.y = 1.68; g.add(head);
  const legL = new THREE.Mesh(boxGeo, mPants); legL.scale.set(0.24, 0.72, 0.26); legL.position.set(-0.16, 0.38, 0); g.add(legL);
  const legR = new THREE.Mesh(boxGeo, mPants); legR.scale.set(0.24, 0.72, 0.26); legR.position.set(0.16, 0.38, 0); g.add(legR);
  const armL = new THREE.Mesh(boxGeo, mShirt); armL.scale.set(0.18, 0.6, 0.2); armL.position.set(-0.42, 1.12, 0); g.add(armL);
  const armR = new THREE.Mesh(boxGeo, mShirt); armR.scale.set(0.18, 0.6, 0.2); armR.position.set(0.42, 1.12, 0); g.add(armR);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; g.add(sh);
  return g;
}
const PED_SHIRTS = [0xe86a6a, 0x6aa8e8, 0x7dd07d, 0xe8d06a, 0xb06ae8, 0xe8e8e8, 0x6ad8d8];
const SKINS = [0xd9a066, 0x8a5a32, 0xe8b88a, 0x6b4423];

// ---------- game state ----------
const G = {
  screen: 'title', // title | play | pause | banner
  started: false,
  cash: 0, health: 100, wanted: 0,
  missionIdx: 0, missionStage: 0, missionDone: false,
  player: null, car: null, // car the player drives
  traffic: [], peds: [], police: [],
  camYaw: 0.6, camPitch: 0.32, camDist: 10,
  time: 0, wantedTimer: 0, crimeCooldown: 0, punchCooldown: 0,
  bustedTimer: 0, holdTimer: 0, toastTimer: 0,
  stats: { stolen: 0, punches: 0, escapes: 0 },
  saveLoaded: false,
};
const MISSIONS = [
  { title: 'MISSION 1 — WHEELS UP', name: 'Wheels Up',
    stages: ['Steal a car — press E near one', 'Drive to the garage in the north-east'],
    targets: [null, { x: 130, z: -104 }], reward: 300 },
  { title: 'MISSION 2 — THE MARLOWE DROP', name: 'The Marlowe Drop',
    stages: ['Pick up Mara\'s package at the pier', 'Deliver it to the south docks — the cops are watching'],
    targets: [{ x: -104, z: 130 }, { x: 104, z: 130 }], reward: 600 },
  { title: 'MISSION 3 — HARBOR LIGHTS HEIST', name: 'Harbor Lights Heist',
    stages: ['Reach the warehouse on the west docks', 'Hold E to crack the safe — then run!', 'Escape to the safehouse'],
    targets: [{ x: -104, z: -130 }, { x: -104, z: -130 }, { x: 26, z: 156 }], reward: 1200 },
];

// mission beacon
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 30, 16, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
beacon.visible = false; scene.add(beacon);
const beaconRing = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.18, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xffd23d }));
beaconRing.rotation.x = Math.PI / 2; beaconRing.visible = false; scene.add(beaconRing);

// ---------- player ----------
function createPlayer(x, z) {
  const mesh = makePersonMesh(0x222831, 0x2b3a55, 0xd9a066);
  // Kai's jacket: dark with a red stripe
  const stripe = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xff2d78, roughness: 0.8 }));
  stripe.scale.set(0.64, 0.12, 0.36); stripe.position.y = 1.3; mesh.add(stripe);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  return { mesh, x, z, heading: 0, speed: 0, hp: 100, walkPhase: 0 };
}
G.player = createPlayer(0, 8);

// ---------- traffic & peds ----------
function spawnTraffic(n) {
  for (let i = 0; i < n; i++) {
    const horiz = rng() < 0.5;
    const road = ROADS[Math.floor(rng() * ROADS.length)];
    const along = -160 + rng() * 320;
    const lane = (rng() < 0.5 ? -1 : 1) * 3;
    const dir = rng() < 0.5 ? 1 : -1;
    const c = makeCar(horiz ? along : road + lane, horiz ? road + lane : along,
      horiz ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI), Math.floor(rng() * CAR_COLORS.length));
    c.axis = horiz ? 'x' : 'z'; c.dir = dir; c.cruise = 8 + rng() * 6; c.turnCd = 0;
    c.speed = c.cruise;
    G.traffic.push(c);
  }
}
function spawnPeds(n) {
  for (let i = 0; i < n; i++) {
    const road = ROADS[Math.floor(rng() * ROADS.length)];
    const horiz = rng() < 0.5;
    const x = horiz ? -160 + rng() * 320 : road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 2.5);
    const z = horiz ? road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 2.5) : -160 + rng() * 320;
    const mesh = makePersonMesh(PED_SHIRTS[Math.floor(rng() * PED_SHIRTS.length)],
      0x2a2f3a, SKINS[Math.floor(rng() * SKINS.length)]);
    mesh.position.set(x, 0, z); scene.add(mesh);
    G.peds.push({ mesh, x, z, tx: x, tz: z, speed: 1.2 + rng() * 0.9, flee: 0, down: 0, walkPhase: rng() * 6 });
  }
}
spawnTraffic(12);
spawnPeds(18);

// ---------- police ----------
const policeLightMat = new THREE.MeshStandardMaterial({ color: 0x2233ff, emissive: 0x2244ff, emissiveIntensity: 2 });
const policeLightMat2 = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 2 });
function spawnPolice() {
  const p = G.player;
  const ang = rng() * TAU;
  const x = clamp(p.x + Math.cos(ang) * 70, -CITY, CITY);
  const z = clamp(p.z + Math.sin(ang) * 70, -CITY, CITY);
  const c = makeCar(x, z, 0, 1);
  c.mesh.children[1].material = new THREE.MeshStandardMaterial({ color: 0x11151f, roughness: 0.4, metalness: 0.5 });
  const bar = new THREE.Mesh(boxGeo, policeLightMat); bar.scale.set(1.1, 0.18, 0.5); bar.position.set(0, 1.55, -0.25); c.mesh.add(bar);
  c.bar = bar; c.isPolice = true; c.speed = 0; c.hp = 100; c.bust = 0;
  scene.add(c.mesh); // already added by makeCar; harmless duplicate add is a no-op in three
  G.police.push(c);
  return c;
}
function wantedTarget() {
  return G.wanted <= 1 ? 1 : G.wanted <= 2 ? 2 : G.wanted <= 3 ? 3 : 4;
}
function addWanted(n, why) {
  if (G.crimeCooldown > 0 && n <= 1) return;
  G.wanted = clamp(G.wanted + n, 0, 5);
  G.crimeCooldown = 1.2;
  if (n > 0) toast(why + ' — wanted level ' + G.wanted);
  updateStars();
}

// ---------- input ----------
const keys = {};
let dragging = false, lastMX = 0, lastMY = 0;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyM') { const m = AudioSys.toggleMute(); toast(m ? 'Sound muted' : 'Sound on'); }
  if (e.code === 'KeyP' && G.screen === 'play') pauseGame(true);
  else if (e.code === 'KeyP' && G.screen === 'pause') pauseGame(false);
  if (e.code === 'Enter' && G.screen === 'title') startGame(false);
  if (e.code === 'KeyE') onInteract();
  if (e.code === 'KeyF') onPunch();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => { dragging = true; lastMX = e.clientX; lastMY = e.clientY; AudioSys.init(); });
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  G.camYaw -= (e.clientX - lastMX) * 0.005;
  G.camPitch = clamp(G.camPitch + (e.clientY - lastMY) * 0.004, -0.15, 1.1);
  lastMX = e.clientX; lastMY = e.clientY;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud'), starsEl = $('stars'), toastEl = $('toast'), hintEl = $('hint');
const mm = $('minimap').getContext('2d');
function updateStars() {
  let s = '';
  for (let i = 0; i < 5; i++) s += i < G.wanted ? '★' : '<span class="dim">★</span>';
  starsEl.innerHTML = s;
}
function toast(msg, ms = 2600) {
  toastEl.textContent = msg; toastEl.style.display = 'block';
  G.toastTimer = ms / 1000;
}
function setHint(msg) {
  if (msg) { hintEl.textContent = msg; hintEl.style.display = 'block'; }
  else hintEl.style.display = 'none';
}
function updateObjective() {
  const m = MISSIONS[G.missionIdx];
  if (!m) { $('objTitle').textContent = 'FREE ROAM'; $('objText').textContent = 'Marlowe City is yours, Kai.'; $('objDist').textContent = ''; return; }
  $('objTitle').textContent = m.title;
  $('objText').textContent = m.stages[G.missionStage];
  const t = m.targets[G.missionStage];
  if (t) {
    const d = Math.round(dist2d(G.player.x, G.player.z, t.x, t.z));
    $('objDist').textContent = d + ' m  ·  reward $' + m.reward;
  } else $('objDist').textContent = 'reward $' + m.reward;
}
function updateHUD() {
  $('cash').innerHTML = '$' + G.cash.toLocaleString('en-US') + ' <small>CASH</small>';
  $('hpbar').style.width = Math.max(0, G.health) + '%';
  const inCar = !!G.car;
  $('speed').style.display = inCar ? 'block' : 'none';
  if (inCar) $('speedVal').textContent = Math.round(Math.abs(G.car.speed) * 3.6);
  if (G.toastTimer > 0) { G.toastTimer -= 1 / 60; if (G.toastTimer <= 0) toastEl.style.display = 'none'; }
  $('vignette').style.opacity = G.health < 35 ? String((35 - G.health) / 35 * 0.8) : '0';
  updateObjective();
}
function drawMinimap() {
  const S = 190, C = S / 2, scale = S / (CITY * 2 + 60);
  mm.clearRect(0, 0, S, S);
  mm.fillStyle = '#0d1226'; mm.fillRect(0, 0, S, S);
  const px = (x) => C + x * scale, pz = (z) => C + z * scale;
  // water
  mm.fillStyle = '#0d2b45'; mm.fillRect(0, 0, px(-CITY), S);
  // roads
  mm.strokeStyle = '#3a3f4d'; mm.lineWidth = 7;
  for (const r of ROADS) {
    mm.beginPath(); mm.moveTo(px(-CITY - 20), pz(r)); mm.lineTo(px(CITY + 20), pz(r)); mm.stroke();
    mm.beginPath(); mm.moveTo(px(r), pz(-CITY - 20)); mm.lineTo(px(r), pz(CITY + 20)); mm.stroke();
  }
  // mission marker
  const m = MISSIONS[G.missionIdx];
  if (m) {
    const t = m.targets[G.missionStage];
    if (t) {
      const pulse = 5 + Math.sin(G.time * 5) * 2;
      mm.fillStyle = '#ffd23d';
      mm.beginPath(); mm.arc(px(t.x), pz(t.z), pulse, 0, TAU); mm.fill();
      mm.strokeStyle = '#fff'; mm.lineWidth = 1.5;
      mm.beginPath(); mm.arc(px(t.x), pz(t.z), pulse + 3, 0, TAU); mm.stroke();
    }
  }
  // traffic
  mm.fillStyle = '#c8ccd8';
  for (const c of G.traffic) { mm.fillRect(px(c.x) - 1.5, pz(c.z) - 1.5, 3, 3); }
  // police (flashing)
  mm.fillStyle = Math.floor(G.time * 4) % 2 ? '#ff4444' : '#4488ff';
  for (const c of G.police) { mm.beginPath(); mm.arc(px(c.x), pz(c.z), 4, 0, TAU); mm.fill(); }
  // player arrow
  const p = G.player;
  mm.save(); mm.translate(px(p.x), pz(p.z)); mm.rotate(-p.heading);
  mm.fillStyle = '#00e5ff';
  mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 6); mm.lineTo(-5, 6); mm.closePath(); mm.fill();
  mm.restore();
  // north
  mm.fillStyle = '#9aa3b5'; mm.font = 'bold 11px system-ui'; mm.fillText('N', C - 4, 13);
}

// ---------- save ----------
function saveGame() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, missionIdx: G.missionIdx, missionStage: G.missionStage,
      health: G.health, stats: G.stats, time: Date.now(),
    }));
  } catch { /* storage may be off */ }
}
function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ---------- flow ----------
function startGame(continueSave) {
  AudioSys.init();
  if (continueSave) {
    const s = loadSave();
    if (s) {
      G.cash = s.cash || 0; G.missionIdx = s.missionIdx || 0; G.missionStage = s.missionStage || 0;
      G.health = s.health || 100; G.stats = s.stats || G.stats; G.saveLoaded = true;
    }
  } else {
    G.cash = 0; G.missionIdx = 0; G.missionStage = 0; G.health = 100; G.wanted = 0;
  }
  G.started = true; G.screen = 'play';
  $('title').classList.add('hidden'); $('banner').classList.add('hidden'); $('pause').classList.add('hidden');
  hud.classList.add('on');
  updateStars(); updateObjective();
  toast(MISSIONS[G.missionIdx] ? MISSIONS[G.missionIdx].title : 'Free roam');
  if (G.saveLoaded) toast('Save loaded — welcome back, Kai');
}
function pauseGame(on) {
  G.screen = on ? 'pause' : 'play';
  $('pause').classList.toggle('hidden', !on);
}
function showBanner(title, text) {
  G.screen = 'banner';
  $('bannerTitle').textContent = title; $('bannerText').textContent = text;
  $('banner').classList.remove('hidden');
}
function busted() {
  const fine = Math.min(G.cash, 150);
  G.cash -= fine; G.wanted = 0; G.health = 100;
  for (const c of G.police) scene.remove(c.mesh);
  G.police.length = 0;
  G.player.x = 0; G.player.z = 8; G.player.mesh.position.set(0, 0, 8);
  if (G.car) { G.car = null; }
  updateStars(); saveGame();
  showBanner('BUSTED', 'Marlowe PD impounded your ride and fined you $' + fine + '. Mara Quinn is not impressed — but she still has work for you.');
}
function wasted() {
  const lost = Math.min(G.cash, 200);
  G.cash -= lost; G.wanted = 0; G.health = 100;
  for (const c of G.police) scene.remove(c.mesh);
  G.police.length = 0;
  G.player.x = 0; G.player.z = 8; G.player.mesh.position.set(0, 0, 8);
  if (G.car) { G.car = null; }
  updateStars(); saveGame();
  showBanner('WASTED', 'You wake up at Marlowe General, $' + lost + ' lighter. The city does not wait — get back out there.');
}
function missionComplete() {
  const m = MISSIONS[G.missionIdx];
  G.cash += m.reward;
  AudioSys.jingle();
  toast(m.name + ' complete — +$' + m.reward);
  G.missionIdx += 1; G.missionStage = 0; G.wanted = Math.max(0, G.wanted - 2);
  updateStars(); saveGame();
  if (G.missionIdx >= MISSIONS.length) {
    G.missionDone = true;
    showBanner('STORY COMPLETE', 'All three jobs done. Mara Quinn pays out $' + G.cash.toLocaleString('en-US') + ' total and Marlowe City is yours, Kai. Free roam continues — steal, drive, survive.');
  } else {
    toast(MISSIONS[G.missionIdx].title + ' — new job from Mara Quinn');
  }
}
$('btnStart').addEventListener('click', () => startGame(false));
$('btnContinue').addEventListener('click', () => startGame(true));
$('btnResume').addEventListener('click', () => pauseGame(false));
$('btnRestart').addEventListener('click', () => { try { window.localStorage.removeItem(SAVE_KEY); } catch {} location.reload(); });
$('btnBanner').addEventListener('click', () => { $('banner').classList.add('hidden'); G.screen = 'play'; });
if (loadSave()) {
  $('btnContinue').style.display = 'inline-block';
  const s = loadSave();
  $('saveInfo').textContent = 'Save found: $' + (s.cash || 0) + ' cash · mission ' + ((s.missionIdx || 0) + 1) + ' of 3.';
}

// ---------- interactions ----------
function nearestCar(maxD) {
  let best = null, bd = maxD;
  const p = G.player;
  for (const c of [...G.traffic, ...G.police]) {
    const d = dist2d(p.x, p.z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function onInteract() {
  if (G.screen !== 'play') return;
  const p = G.player;
  if (G.car) { // exit car
    const c = G.car; G.car = null;
    p.x = c.x + Math.cos(c.heading + Math.PI / 2) * 3; p.z = c.z + Math.sin(c.heading + Math.PI / 2) * 3;
    p.mesh.position.set(p.x, 0, p.z); p.mesh.visible = true;
    p.heading = c.heading;
    AudioSys.setEngine(0, false);
    return;
  }
  // mission hold (M3 stage 1) is handled in update via key E held; here handle entering cars
  const c = nearestCar(4.5);
  if (c) {
    if (c.isPolice) { toast('That is a cop car — not today'); return; }
    const ti = G.traffic.indexOf(c);
    if (ti >= 0) G.traffic.splice(ti, 1);
    G.car = c; c.speed = 0;
    p.mesh.visible = false;
    G.stats.stolen += 1;
    AudioSys.blip(660, 0.1, 'square', 0.12);
    if (G.missionIdx === 0 && G.missionStage === 0) { G.missionStage = 1; toast('Nice wheels. Now drive to the garage!'); }
    else if (G.wanted === 0) addWanted(1, 'Grand theft auto');
    else addWanted(1, 'Grand theft auto');
    updateObjective();
  }
}
function onPunch() {
  if (G.screen !== 'play' || G.car || G.punchCooldown > 0) return;
  G.punchCooldown = 0.45;
  const p = G.player;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  AudioSys.thud();
  // punch a ped
  for (const ped of G.peds) {
    if (ped.down > 0) continue;
    const d = dist2d(p.x, p.z, ped.x, ped.z);
    if (d < 2.4) {
      ped.down = 999; ped.mesh.rotation.x = -Math.PI / 2; ped.mesh.position.y = 0.3;
      G.stats.punches += 1;
      addWanted(1, 'Assault');
      toast('Down! The street saw that.');
      return;
    }
  }
  // punch a cop
  for (const cop of G.police) {
    const d = dist2d(p.x, p.z, cop.x, cop.z);
    if (d < 3) {
      cop.hp -= 34;
      if (cop.hp <= 0) {
        scene.remove(cop.mesh);
        G.police.splice(G.police.indexOf(cop), 1);
        addWanted(2, 'Cop down');
      } else addWanted(1, 'Assaulting an officer');
      return;
    }
  }
}

// ---------- updates ----------
function updatePlayer(dt) {
  const p = G.player;
  if (G.car) return;
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz -= 1;
  if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  const run = keys.ShiftLeft || keys.ShiftRight;
  const speed = run ? 10 : 5.5;
  if (ix || iz) {
    const len = Math.hypot(ix, iz); ix /= len; iz /= len;
    const sin = Math.sin(G.camYaw), cos = Math.cos(G.camYaw);
    const mx = ix * cos - iz * sin, mz = ix * sin + iz * cos;
    p.x += mx * speed * dt; p.z += mz * speed * dt;
    p.heading = angLerp(p.heading, Math.atan2(mx, mz), 1 - Math.pow(0.0001, dt));
    p.walkPhase += dt * (run ? 14 : 9);
    p.speed = speed;
    const bob = Math.sin(p.walkPhase) * 0.06;
    p.mesh.position.set(p.x, Math.abs(bob) * 0.3, p.z);
    p.mesh.rotation.y = p.heading;
    p.mesh.rotation.z = Math.sin(p.walkPhase) * 0.05;
  } else {
    p.speed = 0;
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.heading; p.mesh.rotation.z = 0;
  }
  p.x = clamp(p.x, -CITY - 20, CITY + 20); p.z = clamp(p.z, -CITY - 20, CITY + 20);
  collideCircle(p, 0.6);
  // M3 safe-cracking hold
  if (G.missionIdx === 2 && G.missionStage === 1) {
    const t = MISSIONS[2].targets[1];
    if (dist2d(p.x, p.z, t.x, t.z) < 5 && keys.KeyE) {
      G.holdTimer += dt;
      $('prog').style.display = 'block';
      $('progbar').style.width = (G.holdTimer / 3 * 100) + '%';
      if (G.holdTimer >= 3) {
        $('prog').style.display = 'none'; G.holdTimer = 0;
        G.missionStage = 2; addWanted(3, 'Safe cracked — run!');
        AudioSys.jingle(); toast('Safe cracked! Get to the safehouse!');
      }
    } else {
      G.holdTimer = Math.max(0, G.holdTimer - dt * 2);
      $('prog').style.display = 'none';
    }
  }
}
function updateDriving(dt) {
  const c = G.car; if (!c) return;
  const accel = keys.KeyW || keys.ArrowUp ? 1 : keys.KeyS || keys.ArrowDown ? -1 : 0;
  const steer = keys.KeyA || keys.ArrowLeft ? 1 : keys.KeyD || keys.ArrowRight ? -1 : 0;
  const handbrake = keys.Space;
  const maxF = 30, maxR = -10;
  if (accel > 0) c.speed += 16 * dt;
  else if (accel < 0) c.speed += (c.speed > 0.5 ? -26 : -8) * dt;
  else c.speed *= Math.pow(0.4, dt);
  if (handbrake) c.speed *= Math.pow(0.02, dt);
  c.speed = clamp(c.speed, maxR, maxF);
  if (Math.abs(c.speed) > 0.1) {
    c.heading += steer * (c.speed > 0 ? 1 : -1) * 1.9 * dt * Math.min(1, Math.abs(c.speed) / 8);
  }
  c.x += Math.sin(c.heading) * c.speed * dt;
  c.z += Math.cos(c.heading) * c.speed * dt;
  c.x = clamp(c.x, -CITY - 24, CITY + 24); c.z = clamp(c.z, -CITY - 24, CITY + 24);
  const hitWall = collideCircle(c, 1.6);
  if (hitWall) c.speed *= 0.55;
  c.mesh.position.set(c.x, 0, c.z);
  c.mesh.rotation.y = c.heading;
  c.mesh.rotation.z = -steer * Math.min(1, Math.abs(c.speed) / 20) * 0.06;
  G.player.x = c.x; G.player.z = c.z; G.player.heading = c.heading;
  AudioSys.setEngine(Math.abs(c.speed) / maxF, true);
  // run over peds
  if (Math.abs(c.speed) > 5) {
    for (const ped of G.peds) {
      if (ped.down > 0) continue;
      if (dist2d(c.x, c.z, ped.x, ped.z) < 2.2) {
        ped.down = 999; ped.mesh.rotation.x = -Math.PI / 2; ped.mesh.position.y = 0.3;
        addWanted(1, 'Pedestrian down');
        AudioSys.thud();
      }
    }
  }
}
function updateTraffic(dt) {
  for (const c of G.traffic) {
    c.turnCd -= dt;
    const speed = c.cruise;
    c.x += c.axis === 'x' ? Math.sin(c.heading) * speed * dt : 0;
    c.z += c.axis === 'z' ? Math.cos(c.heading) * speed * dt : 0;
    // turning at intersections
    const along = c.axis === 'x' ? c.x : c.z;
    const cross = nearestRoadCoord(along);
    if (Math.abs(along - cross) < 1.2 && c.turnCd <= 0 && rng() < 0.35) {
      c.turnCd = 4;
      const horiz = c.axis === 'x';
      const newDir = rng() < 0.5 ? 1 : -1;
      c.axis = horiz ? 'z' : 'x'; c.dir = newDir;
      c.heading = horiz ? (newDir > 0 ? 0 : Math.PI) : (newDir > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (horiz) c.x = cross; else c.z = cross;
    }
    // wrap at edges
    if (c.x > CITY + 24) c.x = -CITY - 20; if (c.x < -CITY - 24) c.x = CITY + 20;
    if (c.z > CITY + 24) c.z = -CITY - 20; if (c.z < -CITY - 24) c.z = CITY + 20;
    c.mesh.position.set(c.x, 0, c.z);
    c.mesh.rotation.y = c.heading;
  }
}
function updatePeds(dt) {
  const p = G.player;
  for (const ped of G.peds) {
    if (ped.down > 0) { ped.down -= dt; if (ped.down <= 0) { ped.mesh.rotation.x = 0; ped.mesh.position.y = 0; ped.flee = 0; } continue; }
    const dP = dist2d(p.x, p.z, ped.x, ped.z);
    const danger = (G.car && Math.abs(G.car.speed) > 8 && dP < 12) || (!G.car && G.wanted > 0 && dP < 8);
    if (danger) { ped.flee = 2.5; ped.tx = ped.x + (ped.x - p.x) * 2; ped.tz = ped.z + (ped.z - p.z) * 2; }
    if (ped.flee > 0) ped.flee -= dt;
    const d = dist2d(ped.x, ped.z, ped.tx, ped.tz);
    if (d < 2) {
      const road = ROADS[Math.floor(rng() * ROADS.length)];
      const horiz = rng() < 0.5;
      ped.tx = horiz ? -160 + rng() * 320 : road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 2.5);
      ped.tz = horiz ? road + (rng() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 2.5) : -160 + rng() * 320;
    } else {
      const sp = ped.flee > 0 ? ped.speed * 3.2 : ped.speed;
      const dx = (ped.tx - ped.x) / d, dz = (ped.tz - ped.z) / d;
      ped.x += dx * sp * dt; ped.z += dz * sp * dt;
      ped.walkPhase += dt * sp * 4;
      ped.mesh.position.set(ped.x, Math.abs(Math.sin(ped.walkPhase)) * 0.04, ped.z);
      ped.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }
}
function updatePolice(dt) {
  const p = G.player;
  const want = wantedTarget();
  while (G.police.length < want && G.wanted > 0) spawnPolice();
  while (G.police.length > want) { const c = G.police.pop(); scene.remove(c.mesh); }
  for (const cop of G.police) {
    const dx = p.x - cop.x, dz = p.z - cop.z;
    const d = Math.hypot(dx, dz) || 1;
    const targetHeading = Math.atan2(dx, dz);
    cop.heading = angLerp(cop.heading, targetHeading, 1 - Math.pow(0.001, dt));
    cop.speed = lerp(cop.speed, 17, 1 - Math.pow(0.1, dt));
    cop.x += Math.sin(cop.heading) * cop.speed * dt;
    cop.z += Math.cos(cop.heading) * cop.speed * dt;
    collideCircle(cop, 1.6);
    cop.mesh.position.set(cop.x, 0, cop.z);
    cop.mesh.rotation.y = cop.heading;
    // flashing light bar
    cop.bar.material = Math.floor(G.time * 5) % 2 ? policeLightMat : policeLightMat2;
    if (d < 3.2) {
      if (G.car) {
        G.car.speed *= Math.pow(0.5, dt);
        G.health -= 4 * dt;
        if (G.health <= 0) wasted();
      } else {
        cop.bust += dt;
        G.health -= 6 * dt;
        if (G.health <= 0) { wasted(); return; }
        if (cop.bust > 2.5) { busted(); return; }
      }
    } else cop.bust = Math.max(0, cop.bust - dt);
  }
  AudioSys.setSiren(G.wanted > 0 && G.screen === 'play');
}
function updateWanted(dt) {
  if (G.wanted <= 0) return;
  G.wantedTimer += dt;
  let nearestCop = 1e9;
  for (const cop of G.police) nearestCop = Math.min(nearestCop, dist2d(G.player.x, G.player.z, cop.x, cop.z));
  if (nearestCop > 55 && G.wantedTimer > 18) {
    G.wantedTimer = 0; G.wanted -= 1; updateStars();
    if (G.wanted === 0) { toast('You lost them. For now.'); G.stats.escapes += 1; }
  }
}
function updateCamera(dt) {
  const p = G.player;
  const target = G.car ? G.car : p;
  const dist = G.car ? 13 : 9;
  const cy = G.camYaw, cp = G.camPitch;
  const cx = target.x - Math.sin(cy) * Math.cos(cp) * dist;
  const cz = target.z - Math.cos(cy) * Math.cos(cp) * dist;
  const cyPos = (G.car ? 2.2 : 2.4) + Math.sin(cp) * dist;
  camera.position.set(cx, cyPos, cz);
  camera.lookAt(target.x, G.car ? 1.4 : 1.6, target.z);
  // keep camera out of buildings (cheap: clamp height)
  if (camera.position.y < 1.2) camera.position.y = 1.2;
}
function updateBeacon(dt) {
  const m = MISSIONS[G.missionIdx];
  const t = m ? m.targets[G.missionStage] : null;
  if (t && G.screen === 'play') {
    beacon.visible = true; beaconRing.visible = true;
    beacon.position.set(t.x, 15, t.z);
    beaconRing.position.set(t.x, 0.3 + Math.sin(G.time * 3) * 0.15, t.z);
    beacon.material.opacity = 0.22 + Math.sin(G.time * 4) * 0.08;
  } else { beacon.visible = false; beaconRing.visible = false; }
}
function updateMissions() {
  const m = MISSIONS[G.missionIdx];
  if (!m) return;
  const t = m.targets[G.missionStage];
  if (!t) return;
  const d = dist2d(G.player.x, G.player.z, t.x, t.z);
  if (G.missionIdx === 1 && G.missionStage === 0 && !G.car && d < 4) {
    G.missionStage = 1; addWanted(2, 'The package is hot'); AudioSys.blip(880, 0.15);
    toast('Package grabbed — deliver it south, fast!');
    updateObjective();
    return;
  }
  if (d < 5) {
    if (G.missionIdx === 0 && G.missionStage === 1) missionComplete();
    else if (G.missionIdx === 1 && G.missionStage === 1) missionComplete();
    else if (G.missionIdx === 2 && G.missionStage === 2) missionComplete();
  }
}
function updateHints() {
  if (G.screen !== 'play') { setHint(''); return; }
  if (G.car) { setHint('W/S drive · A/D steer · Space handbrake · E exit car'); return; }
  const c = nearestCar(4.5);
  if (c) { setHint('Press E to steal the ' + c.name); return; }
  if (G.missionIdx === 2 && G.missionStage === 1) {
    const t = MISSIONS[2].targets[1];
    if (dist2d(G.player.x, G.player.z, t.x, t.z) < 6) { setHint('Hold E to crack the safe'); return; }
  }
  setHint('');
}

// ---------- main loop ----------
const STEP = 1 / 60;
let last = performance.now(), acc = 0, saveTimer = 0;
function step(dt) {
  G.time += dt;
  G.crimeCooldown = Math.max(0, G.crimeCooldown - dt);
  G.punchCooldown = Math.max(0, G.punchCooldown - dt);
  if (G.screen !== 'play') return;
  updatePlayer(dt);
  updateDriving(dt);
  updateMissions();
  updateTraffic(dt);
  updatePeds(dt);
  updatePolice(dt);
  updateWanted(dt);
  updateBeacon(dt);
  updateHints();
  updateHUD();
  drawMinimap();
  saveTimer += dt;
  if (saveTimer > 15) { saveTimer = 0; saveGame(); }
  if (G.health <= 0 && G.screen === 'play') wasted();
}
function loop(now) {
  requestAnimationFrame(loop);
  const frame = Math.min((now - last) / 1000, 0.25);
  last = now;
  acc += frame;
  while (acc >= STEP) { step(STEP); acc -= STEP; }
  if (G.screen === 'title') {
    // slow cinematic orbit behind the title screen
    const t = G.time + frame;
    camera.position.set(Math.sin(t * 0.05) * 120, 42, Math.cos(t * 0.05) * 120);
    camera.lookAt(0, 8, 0);
    updateTraffic(STEP); updatePeds(STEP);
    G.time += frame;
  }
  updateCamera(frame);
  renderer.render(scene, camera);
}

// ---------- screenshot staging ----------
function stageShot(name) {
  G.started = true; G.screen = 'play';
  $('title').classList.add('hidden'); hud.classList.add('on');
  $('loading').style.display = 'none';
  const p = G.player;
  if (name === 'start') {
    G.screen = 'title';
    $('title').classList.remove('hidden'); hud.classList.remove('on');
    for (let i = 0; i < 180; i++) { updateTraffic(STEP); updatePeds(STEP); }
  } else if (name === 'drive') {
    const c = makeCar(-40, 0, Math.PI / 2, 0);
    G.car = c; p.mesh.visible = false; p.x = c.x; p.z = c.z;
    G.traffic.length = 0;
    spawnTraffic(8);
    G.camYaw = Math.PI / 2; G.camPitch = 0.22;
    c.speed = 24;
    for (let i = 0; i < 90; i++) { updateDriving(STEP); updateTraffic(STEP); }
  } else if (name === 'mission') {
    p.x = -118; p.z = -118; p.mesh.position.set(p.x, 0, p.z); p.heading = Math.PI * 0.75;
    G.missionIdx = 2; G.missionStage = 1; G.wanted = 2;
    G.camYaw = Math.PI * 0.75; G.camPitch = 0.3;
    spawnPolice();
    for (let i = 0; i < 120; i++) { updateTraffic(STEP); updatePeds(STEP); updatePolice(STEP); updateBeacon(STEP); }
    updateStars(); updateObjective();
  } else { // cover (default): in a car, mission live, cops closing in
    const c = makeCar(20, 52, Math.PI / 2, 4);
    G.car = c; p.mesh.visible = false; p.x = c.x; p.z = c.z;
    G.missionIdx = 1; G.missionStage = 1; G.wanted = 2; G.cash = 1840;
    G.camYaw = Math.PI / 2; G.camPitch = 0.26;
    c.speed = 12;
    spawnPolice(); spawnPolice();
    for (let i = 0; i < 150; i++) { updateDriving(STEP); updateTraffic(STEP); updatePeds(STEP); updatePolice(STEP); updateBeacon(STEP); }
    updateStars(); updateObjective(); updateHUD(); drawMinimap();
  }
  updateStars(); updateHUD(); drawMinimap();
  let painted = 0;
  (function paint() {
    updateCamera(0.016);
    renderer.render(scene, camera);
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else window.__shotReady = true;
  })();
}

// ---------- boot ----------
updateStars();
if (shot) {
  stageShot(shot);
} else {
  $('loading').style.display = 'none';
  requestAnimationFrame(loop);
  // keep the title screen alive behind the overlay
  G.screen = 'title';
}
window.__game = G;
window.__ready = true;
