import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// =====================================================================
//  ARENA DUEL — лоуполи-шутер для двоих: по сети (WebRTC) или сплит-скрин
// =====================================================================

const WIN_SCORE = 10;
const MAX_HP = 100;
const BULLET_DMG = 20;
const FIRE_COOLDOWN = 0.28;
const RESPAWN_TIME = 3.0;
const MOVE_SPEED = 9.5;
const STRAFE_SPEED = 7.5;
const TURN_SPEED = 2.6;
const MOUSE_SENS = 0.0026;
const ARENA_HALF = 38;
const NET_SEND_INTERVAL = 1 / 30;

// ---------------------------------------------------------------------
//  Рендерер и сцена
// ---------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc4e8);

// мягкое PBR-окружение для материалов (внутри здания без него всё выглядит плоско)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// небо-градиент
{
  const skyGeo = new THREE.SphereGeometry(400, 16, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(0x3d7edb) },
      bottom: { value: new THREE.Color(0xbfe3f5) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = normalize(vP).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

// освещение
const hemi = new THREE.HemisphereLight(0x9db4d6, 0x3f3a33, 0.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 3.0);
sun.position.set(40, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0005;
scene.add(sun);

// солнечный диск с ореолом
{
  const sunDir = sun.position.clone().normalize();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(16, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff6d0, fog: false })
  );
  disc.position.copy(sunDir).multiplyScalar(330);
  disc.lookAt(0, 0, 0);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(34, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0.25, fog: false })
  );
  glow.position.copy(sunDir).multiplyScalar(335);
  glow.lookAt(0, 0, 0);
  scene.add(glow, disc);
}

// лоуполи-облака, медленно плывущие и отбрасывающие тени
const clouds = [];
{
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const blobs = 3 + Math.floor(Math.random() * 2);
    for (let b = 0; b < blobs; b++) {
      const r = 3 + Math.random() * 4;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), cloudMat);
      m.position.set((b - blobs / 2) * r * 1.1, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3);
      m.scale.y = 0.45;
      m.castShadow = true;
      g.add(m);
    }
    g.position.set((Math.random() - 0.5) * 240, 44 + Math.random() * 18, (Math.random() - 0.5) * 240);
    scene.add(g);
    clouds.push({ g, sp: 0.8 + Math.random() * 1.4 });
  }
}

// ---------------------------------------------------------------------
//  Материалы
// ---------------------------------------------------------------------
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });

// ---- процедурные текстуры (canvas) ----
function makeTexture(size, painter, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  painter(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const paintConcrete = (base, dark, light) => (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 46; i++) { // крупные пятна
    g.globalAlpha = 0.055;
    g.fillStyle = Math.random() > 0.5 ? dark : light;
    g.beginPath();
    g.arc(Math.random() * s, Math.random() * s, 18 + Math.random() * 70, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 5200; i++) { // зерно
    g.globalAlpha = 0.1 + Math.random() * 0.16;
    g.fillStyle = Math.random() > 0.5 ? dark : light;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  g.globalAlpha = 0.13; g.strokeStyle = dark; g.lineWidth = 1; // трещины
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 85; y += (Math.random() - 0.5) * 85; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
};

const paintWood = (g, s) => {
  g.fillStyle = '#7d5f3e'; g.fillRect(0, 0, s, s);
  const rows = 5, ph = s / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle = `hsl(28, 34%, ${26 + Math.random() * 12}%)`;
    g.fillRect(0, r * ph, s, ph);
    g.strokeStyle = 'rgba(40,26,12,0.55)'; g.lineWidth = 3;
    g.strokeRect(-2, r * ph, s + 4, ph);
    g.strokeStyle = 'rgba(30,18,8,0.14)'; g.lineWidth = 1; // волокна
    for (let i = 0; i < 22; i++) {
      const y = r * ph + Math.random() * ph;
      g.beginPath(); g.moveTo(0, y);
      g.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 8, s * 0.7, y + (Math.random() - 0.5) * 8, s, y);
      g.stroke();
    }
  }
};

const floorTex = makeTexture(512, paintConcrete('#8d8d8b', '#6f6f6d', '#a5a5a2'), 10, 10);
const wallTex = makeTexture(512, paintConcrete('#b3aea1', '#948f83', '#c9c4b6'), 3, 1);
const ceilTex = makeTexture(512, paintConcrete('#7e828a', '#63666d', '#94989f'), 8, 8);
const columnTex = makeTexture(512, paintConcrete('#9a9ea6', '#7d8188', '#b2b6bd'), 2, 2);
const woodTex = makeTexture(256, paintWood, 1, 1);

const M = {
  floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }),
  ceil: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95 }),
  column: new THREE.MeshStandardMaterial({ map: columnTex, roughness: 0.85 }),
  lowWall: new THREE.MeshStandardMaterial({ map: columnTex, color: 0xb8bcc4, roughness: 0.85 }),
  crate: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 }),
  crateDark: mat(0x6b4f33, { roughness: 0.8 }),
  metal: mat(0x646b74, { roughness: 0.4, metalness: 0.75 }),
  blue: mat(0x2f6fe0),
  blueDark: mat(0x1e4aa8),
  red: mat(0xe04a35),
  redDark: mat(0xa83324),
  skin: mat(0xeac086),
  gun: mat(0x333940, { roughness: 0.5, metalness: 0.4 }),
  medkit: mat(0xf2f5f7),
  medcross: mat(0xe03535, { emissive: 0x801010, emissiveIntensity: 0.4 }),
};

// ---------------------------------------------------------------------
//  Арена
// ---------------------------------------------------------------------
const obstacles = [];
const shootables = [];

function addObstacleBox(mesh, pad = 0) {
  const box = new THREE.Box3().setFromObject(mesh);
  obstacles.push({ minX: box.min.x - pad, maxX: box.max.x + pad, minZ: box.min.z - pad, maxZ: box.max.z + pad });
  shootables.push(mesh);
}

// =====  ЗДАНИЕ-АРЕНА (60×60, стены высотой 7) =====
const WALL_H = 7;

// детерминированный рандом — карта одинаковая у обоих игроков
let seed = 1234567;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// пол
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  shootables.push(floor);
}

function wall(cx, cz, sx, sz, h = WALL_H, m = M.wall) {
  const w = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), m);
  w.position.set(cx, h / 2, cz);
  w.castShadow = w.receiveShadow = true;
  scene.add(w);
  addObstacleBox(w, 0);
  return w;
}

// внешние стены
wall(0, -30.5, 62, 1); wall(0, 30.5, 62, 1);
wall(-30.5, 0, 1, 62); wall(30.5, 0, 1, 62);

// четыре угловые комнаты, в каждой по два дверных проёма
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  wall(14 * sx, 16.5 * sz, 1, 5);
  wall(14 * sx, 27.5 * sz, 1, 5);
  wall(27.5 * sx, 14 * sz, 5, 1);
  wall(17 * sx, 14 * sz, 6, 1);
}

// низкие укрытия в центральном зале
wall(0, -8, 10, 1, 1.3, M.lowWall); wall(0, 8, 10, 1, 1.3, M.lowWall);
wall(-8, 0, 1, 10, 1.3, M.lowWall); wall(8, 0, 1, 10, 1.3, M.lowWall);

// колонны до потолка
for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, WALL_H, 12), M.column);
  c.position.set(x, WALL_H / 2, z);
  c.castShadow = c.receiveShadow = true;
  scene.add(c);
  addObstacleBox(c, 0.05);
}

// ящики
const cratePositions = [
  [-22, -17], [22, 17], [-17, 22], [17, -22],
  [-26, -26], [26, 26], [-26, 26], [26, -26],
  [0, -14], [0, 14], [-14, 0], [14, 0],
];
for (const [x, z] of cratePositions) {
  const stack = 1 + (rand() > 0.55 ? 1 : 0);
  for (let s = 0; s < stack; s++) {
    const size = 2.2 - s * 0.35;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), M.crate);
    crate.position.set(x + (s ? 0.12 : 0), size / 2 + s * 2.0, z + (s ? -0.1 : 0));
    crate.rotation.y = rand() * 0.5;
    crate.castShadow = crate.receiveShadow = true;
    scene.add(crate);
    if (s === 0) addObstacleBox(crate, 0.05); else shootables.push(crate);
  }
}

// бочки
for (const [x, z] of [[-9, -3], [9, 3], [3, -9], [-3, 9]]) {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 14), M.metal);
  b.position.set(x, 0.6, z);
  b.castShadow = b.receiveShadow = true;
  scene.add(b);
  addObstacleBox(b, 0);
}

// потолок с центральным световым люком 16×16
for (const [cx, cz, w, d] of [[0, 20, 64, 24], [0, -20, 64, 24], [-20, 0, 24, 16], [20, 0, 24, 16]]) {
  const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), M.ceil);
  s.position.set(cx, WALL_H + 0.25, cz);
  s.castShadow = s.receiveShadow = true;
  scene.add(s);
  shootables.push(s);
}
// балки над люком — рисуют полосы света
for (const rot of [0, Math.PI / 2]) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.35, 0.35), M.metal);
  beam.position.y = WALL_H;
  beam.rotation.y = rot;
  beam.castShadow = true;
  scene.add(beam);
}

// подвесные лампы
for (const [x, z] of [[16, 0], [-16, 0], [0, 16], [0, -16], [22, 22], [-22, 22], [22, -22], [-22, -22]]) {
  const g = new THREE.Group();
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), M.gun);
  cable.position.y = WALL_H - 0.45;
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 12), M.metal);
  shade.position.y = WALL_H - 0.95;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe6b8, emissive: 0xffc46a, emissiveIntensity: 2.5 })
  );
  bulb.position.y = WALL_H - 1.12;
  const light = new THREE.PointLight(0xffd9a0, 22, 20, 1.8);
  light.position.y = WALL_H - 1.3;
  g.add(cable, shade, bulb, light);
  g.position.set(x, 0, z);
  scene.add(g);
}

// ---------------------------------------------------------------------
//  Аптечки
// ---------------------------------------------------------------------
class Medkit {
  constructor(x, z) {
    this.group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), M.medkit);
    base.castShadow = true;
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.72, 0.24), M.medcross);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.7), M.medcross);
    this.group.add(base, c1, c2);
    this.group.position.set(x, 1.0, z);
    this.baseY = 1.0;
    this.active = true;
    this.timer = 0;
    scene.add(this.group);
  }
  update(dt, t) {
    if (!this.active) {
      this.timer -= dt;
      if (this.timer <= 0) { this.active = true; this.group.visible = true; }
      return;
    }
    this.group.rotation.y += dt * 1.5;
    this.group.position.y = this.baseY + Math.sin(t * 2.2) * 0.18;
  }
  take() {
    this.active = false;
    this.group.visible = false;
    this.timer = 12;
  }
  reset() { this.active = true; this.group.visible = true; this.timer = 0; }
}
const medkits = [new Medkit(0, 0), new Medkit(-25, 0), new Medkit(25, 0)];

// ---------------------------------------------------------------------
//  Модель солдата
// ---------------------------------------------------------------------
function buildSoldier(bodyMat, darkMat) {
  const g = new THREE.Group();
  const parts = {};

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.55, 4, 12), bodyMat);
  torso.position.y = 1.3;
  g.add(torso);

  const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.39, 0.3, 4, 12), darkMat);
  vest.position.y = 1.35;
  vest.scale.z = 0.85;
  g.add(vest);

  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.2, 4, 10), darkMat);
  pelvis.position.y = 0.68;
  g.add(pelvis);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 12), M.skin);
  head.position.y = 2.06;
  g.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), darkMat);
  helmet.position.y = 2.12;
  g.add(helmet);

  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.2 * side, 0.55, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.6, 4, 10), darkMat);
    leg.position.y = -0.42;
    hip.add(leg);
    g.add(hip);
    parts[side === -1 ? 'legL' : 'legR'] = hip;
  }

  const armR = new THREE.Group();
  armR.position.set(0.5, 1.68, 0);
  const armRMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 10), bodyMat);
  armRMesh.position.y = -0.35;
  armR.add(armRMesh);
  armR.rotation.x = -Math.PI / 2.4;
  g.add(armR);
  parts.armR = armR;

  const armL = new THREE.Group();
  armL.position.set(-0.5, 1.68, 0);
  const armLMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 10), bodyMat);
  armLMesh.position.y = -0.35;
  armL.add(armLMesh);
  armL.rotation.x = -Math.PI / 2.1;
  armL.rotation.z = Math.PI / 7;
  g.add(armL);
  parts.armL = armL;

  const gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 1.15), M.gun);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), M.gun);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, 0.8);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.35), M.crateDark);
  stock.position.set(0, -0.1, -0.6);
  gun.add(body, barrel, stock);
  gun.position.set(0.3, 1.45, 0.55);
  g.add(gun);
  parts.gun = gun;

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, 1.15);
  gun.add(muzzle);
  parts.muzzle = muzzle;

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0 })
  );
  flash.position.copy(muzzle.position);
  gun.add(flash);
  parts.flash = flash;

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, parts };
}

// ---------------------------------------------------------------------
//  View-модель оружия (от первого лица) и вспышка выстрела
// ---------------------------------------------------------------------
function buildViewModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, 0.85), M.gun);
  body.position.z = -0.1;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), M.gun);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.75);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.42), M.crateDark);
  handguard.position.set(0, -0.02, -0.48);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.3), M.crateDark);
  stock.position.set(0, -0.05, 0.38);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.12), M.crateDark);
  grip.position.set(0, -0.19, 0.08);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.14), M.gun);
  sight.position.set(0, 0.14, -0.05);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.14), M.skin);
  handR.position.set(0.01, -0.2, 0.06);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.16), M.skin);
  handL.position.set(-0.02, -0.12, -0.45);
  g.add(body, barrel, handguard, stock, grip, sight, handR, handL);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -1.02);
  g.add(muzzle);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0 })
  );
  flash.position.copy(muzzle.position);
  g.add(flash);

  g.position.set(0.3, -0.28, -0.5);
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return { group: g, muzzle, flash };
}
const viewModel = buildViewModel();

// точечный свет от выстрелов (переиспользуется)
const muzzleLight = new THREE.PointLight(0xffc860, 0, 14, 1.8);
scene.add(muzzleLight);
let muzzleLightTime = 0;
function flashMuzzleLight(pos) {
  muzzleLight.position.copy(pos);
  muzzleLightTime = 0.05;
}

// ---------------------------------------------------------------------
//  Звук
// ---------------------------------------------------------------------
const AudioSys = {
  ctx: null,
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  shot(quiet) {
    this.ensure();
    const c = this.ctx, t = c.currentTime;
    const vol = quiet ? 0.5 : 1;
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    f.type = 'lowpass'; f.frequency.value = 2500;
    g.gain.setValueAtTime(0.35 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(f).connect(g).connect(c.destination);
    o.start(t); o.stop(t + 0.15);
    const buf = c.createBuffer(1, c.sampleRate * 0.06, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const n = c.createBufferSource(), ng = c.createGain();
    n.buffer = buf;
    ng.gain.setValueAtTime(0.25 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(ng).connect(c.destination);
    n.start(t);
  },
  hit() {
    this.ensure();
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.1);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + 0.12);
  },
  death() {
    this.ensure();
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + 0.55);
  },
  pickup() {
    this.ensure();
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = i ? 880 : 587;
      g.gain.setValueAtTime(0.001, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.2, t + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.2);
      o.connect(g).connect(c.destination);
      o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.22);
    }
  },
  click() {
    this.ensure();
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 660;
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + 0.09);
  },
  marker() { // подтверждение попадания
    this.ensure();
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = 1500;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + 0.06);
  },
};

// ---------------------------------------------------------------------
//  Эффекты
// ---------------------------------------------------------------------
const tracers = [];
function spawnTracer(from, to) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.1) return;
  const geo = new THREE.CylinderGeometry(0.03, 0.03, len, 4);
  geo.translate(0, len / 2, 0);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.9 }));
  m.position.copy(from);
  m.lookAt(to);
  scene.add(m);
  tracers.push({ mesh: m, life: 0.09 });
}

const particles = [];
function spawnParticles(pos, color, count = 10, speed = 6) {
  for (let i = 0; i < count; i++) {
    const s = 0.07 + Math.random() * 0.1;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    scene.add(m);
    particles.push({ mesh: m, vel: v, life: 0.5 + Math.random() * 0.3, maxLife: 0.8 });
  }
}

function updateEffects(dt) {
  muzzleLightTime -= dt;
  muzzleLight.intensity = muzzleLightTime > 0 ? 30 : 0;
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
    if (t.life <= 0) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.vel.y -= 18 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
    p.mesh.rotation.x += dt * 5; p.mesh.rotation.z += dt * 4;
    if (p.life <= 0 || p.mesh.position.y < 0) {
      scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); particles.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------
//  Игрок
// ---------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const _euler = new THREE.Euler();

// центры угловых комнат и середины коридоров
const SPAWN_POINTS = [
  new THREE.Vector3(-22, 0, -22), new THREE.Vector3(22, 0, 22),
  new THREE.Vector3(-22, 0, 22), new THREE.Vector3(22, 0, -22),
  new THREE.Vector3(0, 0, -25), new THREE.Vector3(0, 0, 25),
];

class Player {
  constructor(id, bodyMat, darkMat, spawnPos, spawnAngle, colorHex) {
    this.id = id;
    this.colorHex = colorHex;
    this.spawnPos = spawnPos.clone();
    this.spawnAngle = spawnAngle;
    this.control = 'keys1'; // keys1 | keys2 | mouse | remote
    this.pitch = 0;         // вертикальный обзор (только от первого лица)
    this.fpView = false;    // вид от первого лица — своя модель скрыта
    this.viewModel = null;  // оружие перед камерой в FP-режиме
    this.vy = 0;            // вертикальная скорость (прыжок)
    this.grounded = true;
    this.crouching = false;
    this.crouchAmt = 0;     // плавный присед 0..1
    this.bobY = 0;          // покачивание модели при ходьбе

    const { group, parts } = buildSoldier(bodyMat, darkMat);
    this.mesh = group;
    this.parts = parts;
    scene.add(group);

    this.hitbox = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 2.5, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.hitbox.position.y = 1.25;
    group.add(this.hitbox);

    // полоска здоровья над головой (для противника в сетевом режиме)
    this.hpBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.18), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6, depthTest: false }));
    this.hpBarFill = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.18), new THREE.MeshBasicMaterial({ color: 0x4dff6a, transparent: true, opacity: 0.95, depthTest: false }));
    this.hpBarFill.position.z = 0.001;
    this.hpBar.add(bg, this.hpBarFill);
    this.hpBar.position.y = 2.85;
    this.hpBar.visible = false;
    this.hpBar.renderOrder = 999;
    group.add(this.hpBar);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 300);

    // сетевая цель для интерполяции
    this.netTarget = { x: spawnPos.x, z: spawnPos.z, a: spawnAngle, v: 0 };

    this.reset(true);
  }

  reset(full) {
    this.pos = this.spawnPos.clone();
    this.angle = this.spawnAngle;
    this.pitch = 0;
    this.hp = MAX_HP;
    this.alive = true;
    this.cooldown = 0;
    this.respawnTimer = 0;
    this.walkPhase = 0;
    this.recoil = 0;
    this.flashTime = 0;
    this.vy = 0;
    this.grounded = true;
    this.crouching = false;
    this.crouchAmt = 0;
    this.bobY = 0;
    this.mesh.scale.y = 1;
    this.mesh.visible = !this.fpView;
    this.netTarget = { x: this.spawnPos.x, z: this.spawnPos.z, a: this.spawnAngle, v: 0, y: 0, cr: 0 };
    if (full) this.score = 0;
    this.syncMesh();
    this.updateCamera(1);
    this.updateHpBar();
  }

  updateHpBar() {
    const f = Math.max(0, this.hp) / MAX_HP;
    this.hpBarFill.scale.x = Math.max(0.001, f);
    this.hpBarFill.position.x = -(1 - f) * 0.75;
    this.hpBarFill.material.color.setHex(f > 0.55 ? 0x4dff6a : f > 0.3 ? 0xffc24d : 0xff4d4d);
  }

  camPosTarget() {
    const back = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle));
    return this.pos.clone().addScaledVector(back, -6.5).add(new THREE.Vector3(0, 4.2, 0));
  }
  camLookTarget() {
    const fwd = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle));
    return this.pos.clone().addScaledVector(fwd, 6).add(new THREE.Vector3(0, 1.6, 0));
  }

  syncMesh() {
    this.mesh.position.set(this.pos.x, this.pos.y + this.bobY, this.pos.z);
    this.mesh.rotation.y = this.angle;
  }

  tryMove(dx, dz) {
    const R = 0.65;
    let nx = this.pos.x + dx;
    if (!obstacles.some(o => nx + R > o.minX && nx - R < o.maxX && this.pos.z + R > o.minZ && this.pos.z - R < o.maxZ)) this.pos.x = nx;
    let nz = this.pos.z + dz;
    if (!obstacles.some(o => this.pos.x + R > o.minX && this.pos.x - R < o.maxX && nz + R > o.minZ && nz - R < o.maxZ)) this.pos.z = nz;
  }

  readControls() {
    // возвращает { turn, move, strafe, fire } из клавиатуры/мыши
    if (this.control === 'keys1') {
      return {
        turn: (input['KeyA'] ? 1 : 0) - (input['KeyD'] ? 1 : 0),
        move: (input['KeyW'] ? 1 : 0) - (input['KeyS'] ? 1 : 0),
        strafe: (input['KeyE'] ? 1 : 0) - (input['KeyQ'] ? 1 : 0),
        fire: !!input['Space'],
        mouse: false,
      };
    }
    if (this.control === 'keys2') {
      return {
        turn: (input['ArrowLeft'] ? 1 : 0) - (input['ArrowRight'] ? 1 : 0),
        move: (input['ArrowUp'] ? 1 : 0) - (input['ArrowDown'] ? 1 : 0),
        strafe: (input['Period'] ? 1 : 0) - (input['Comma'] ? 1 : 0),
        fire: !!input['Enter'],
        mouse: false,
      };
    }
    // mouse: WASD — движение относительно взгляда, мышь — поворот
    return {
      turn: 0,
      move: (input['KeyW'] ? 1 : 0) - (input['KeyS'] ? 1 : 0),
      strafe: (input['KeyD'] ? 1 : 0) - (input['KeyA'] ? 1 : 0),
      fire: mouseFire,
      jump: !!input['Space'],
      crouch: !!input['KeyC'], // не Ctrl: Ctrl+W закрыл бы вкладку
      mouse: true,
    };
  }

  update(dt, opponent, t) {
    this.cooldown -= dt;
    this.flashTime -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.parts.flash.material.opacity = this.flashTime > 0 ? 1 : 0;
    this.parts.flash.scale.setScalar(this.flashTime > 0 ? 0.8 + Math.random() * 0.7 : 1);
    this.parts.gun.position.z = 0.55 - this.recoil * 0.25;

    if (this.control === 'remote') { this.updateRemote(dt); return; }

    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn(opponent);
      this.updateCamera(dt);
      return;
    }

    const c = this.readControls();
    if (c.mouse) {
      this.angle -= consumeMouseDX() * MOUSE_SENS;
      this.pitch = THREE.MathUtils.clamp(this.pitch - consumeMouseDY() * MOUSE_SENS, -1.15, 1.15);
    } else {
      this.angle += c.turn * TURN_SPEED * dt;
    }

    // прыжок и присед (только от первого лица)
    if (c.mouse) {
      if (c.jump && this.grounded && !this.crouching) { this.vy = 7.5; this.grounded = false; }
      if (!this.grounded) {
        this.pos.y += this.vy * dt;
        this.vy -= 22 * dt;
        if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.grounded = true; }
      }
      this.crouching = c.crouch && this.grounded;
    }
    this.crouchAmt += ((this.crouching ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 12);

    const fwd = new THREE.Vector3(Math.sin(this.angle), 0, Math.cos(this.angle));
    // при взгляде вдоль fwd экранное «вправо» — это (-fwd.z, 0, fwd.x)
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const vel = new THREE.Vector3()
      .addScaledVector(fwd, c.move * MOVE_SPEED)
      .addScaledVector(right, c.strafe * (c.mouse ? MOVE_SPEED * 0.85 : STRAFE_SPEED));
    if (c.mouse) vel.multiplyScalar(1 - 0.55 * this.crouchAmt);
    this.tryMove(vel.x * dt, vel.z * dt);

    this.animateWalk(dt, vel.length());

    // покачивание и отдача оружия перед камерой
    if (this.viewModel) {
      const vm = this.viewModel;
      vm.group.position.x = 0.3 + Math.sin(this.walkPhase) * 0.012;
      vm.group.position.y = -0.28 + Math.abs(Math.sin(this.walkPhase)) * 0.02;
      vm.group.position.z = -0.5 + this.recoil * 0.12;
      vm.group.rotation.x = this.recoil * 0.08;
      vm.flash.material.opacity = this.flashTime > 0 ? 1 : 0;
      if (this.flashTime > 0) vm.flash.scale.setScalar(0.7 + Math.random() * 0.8);
    }

    if (c.fire && this.cooldown <= 0) this.shoot(opponent);

    for (const mk of medkits) {
      if (mk.active && this.hp < MAX_HP && mk.group.position.distanceTo(this.pos.clone().setY(mk.group.position.y)) < 1.6) {
        mk.take();
        this.hp = Math.min(MAX_HP, this.hp + 50);
        AudioSys.pickup();
        UI.updateHP(this);
        this.updateHpBar();
        spawnParticles(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 0x6bff8a, 14, 4);
        Net.send({ t: 'mk', i: medkits.indexOf(mk) });
      }
    }

    this.syncMesh();
    this.updateCamera(dt);
    this.lastSpeed = vel.length();
  }

  updateRemote(dt) {
    // интерполяция к последнему сетевому состоянию
    const k = 1 - Math.pow(0.0001, dt);
    const dx = this.netTarget.x - this.pos.x, dz = this.netTarget.z - this.pos.z;
    if (dx * dx + dz * dz > 64) { // телепорт (респаун)
      this.pos.x = this.netTarget.x; this.pos.z = this.netTarget.z;
      this.angle = this.netTarget.a;
    } else {
      this.pos.x += dx * k;
      this.pos.z += dz * k;
      // кратчайший поворот по углу
      let da = this.netTarget.a - this.angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      this.angle += da * k;
    }
    this.pos.y += ((this.netTarget.y || 0) - this.pos.y) * k;
    // присед — модель сжимается по вертикали (хитбокс сжимается вместе с ней)
    const sc = this.netTarget.cr ? 0.62 : 1;
    this.mesh.scale.y += (sc - this.mesh.scale.y) * Math.min(1, dt * 10);
    this.animateWalk(dt, this.netTarget.v);
    this.syncMesh();
  }

  animateWalk(dt, speed) {
    if (speed > 0.5) {
      this.walkPhase += dt * speed * 1.35;
      const sw = Math.sin(this.walkPhase) * 0.55;
      this.parts.legL.rotation.x = sw;
      this.parts.legR.rotation.x = -sw;
      this.bobY = Math.abs(Math.sin(this.walkPhase)) * 0.08;
    } else {
      this.parts.legL.rotation.x *= 0.85;
      this.parts.legR.rotation.x *= 0.85;
      this.bobY *= 0.8;
    }
  }

  updateCamera(dt) {
    if (this.control === 'mouse') {
      // от первого лица: камера в голове, поворот 1:1 без сглаживания
      const bob = Math.abs(Math.sin(this.walkPhase)) * 0.05;
      this.camera.position.set(this.pos.x, this.pos.y + 1.72 - 0.68 * this.crouchAmt + bob, this.pos.z);
      // наша модель смотрит вдоль (+sin a, +cos a); камера в three смотрит в -Z,
      // поэтому рыскание камеры = angle + PI
      this.camera.quaternion.setFromEuler(_euler.set(this.pitch, this.angle + Math.PI, 0, 'YXZ'));
      return;
    }
    const lerp = 1 - Math.pow(0.0005, dt);
    this.camera.position.lerp(this.camPosTarget(), lerp);
    const look = this.camLookTarget();
    const m = new THREE.Matrix4().lookAt(this.camera.position, look, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.camera.quaternion.slerp(q, lerp);
  }

  shoot(opponent) {
    this.cooldown = FIRE_COOLDOWN;
    this.recoil = 1;
    this.flashTime = 0.05;
    AudioSys.shot();

    const origin = new THREE.Vector3();
    const trOrigin = new THREE.Vector3(); // откуда рисуется трассер
    const spread = 0.012;
    const dir = new THREE.Vector3();

    if (this.control === 'mouse') {
      // от первого лица: луч из камеры по взгляду (с учётом вертикали)
      origin.copy(this.camera.position);
      const cp = Math.cos(this.pitch);
      dir.set(
        Math.sin(this.angle) * cp + (Math.random() - 0.5) * spread * 2,
        Math.sin(this.pitch) + (Math.random() - 0.5) * spread,
        Math.cos(this.angle) * cp + (Math.random() - 0.5) * spread * 2
      ).normalize();
      if (this.viewModel) this.viewModel.muzzle.getWorldPosition(trOrigin);
      else trOrigin.copy(origin);
    } else {
      this.parts.muzzle.getWorldPosition(origin);
      dir.set(
        Math.sin(this.angle) + (Math.random() - 0.5) * spread * 2,
        (Math.random() - 0.5) * spread,
        Math.cos(this.angle) + (Math.random() - 0.5) * spread * 2
      ).normalize();
      trOrigin.copy(origin);
    }

    raycaster.set(origin, dir);
    raycaster.far = 120;

    // позиция противника обновилась в этом кадре — матрица хитбокса ещё нет
    opponent.mesh.updateMatrixWorld(true);
    const targets = [...shootables, opponent.alive ? opponent.hitbox : null].filter(Boolean);
    const hits = raycaster.intersectObjects(targets, false);
    let end = origin.clone().addScaledVector(dir, 120);
    let hitOpponent = false;

    if (hits.length) {
      const hit = hits[0];
      end = hit.point;
      if (hit.object === opponent.hitbox) {
        hitOpponent = true;
        spawnParticles(end, 0xd12b2b, 12, 5);
      } else {
        spawnParticles(end, 0xa89a7a, 6, 4);
      }
    }
    spawnTracer(trOrigin, end);
    flashMuzzleLight(trOrigin);

    if (hitOpponent) { UI.hitmarker(this.id); AudioSys.marker(); }

    if (Game.mode === 'net') {
      Net.send({ t: 'shot', o: trOrigin.toArray(), e: end.toArray() });
      if (hitOpponent) Net.send({ t: 'hit', d: BULLET_DMG });
    } else if (hitOpponent) {
      opponent.takeDamage(BULLET_DMG, this);
    }
  }

  takeDamage(dmg, from) {
    if (!this.alive) return;
    this.hp -= dmg;
    AudioSys.hit();
    UI.updateHP(this);
    UI.flashDamage(this);
    this.updateHpBar();
    if (this.hp <= 0) this.die(from);
  }

  die(killer) {
    this.alive = false;
    this.hp = 0;
    this.respawnTimer = RESPAWN_TIME;
    this.mesh.visible = false;
    AudioSys.death();
    spawnParticles(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), this.colorHex, 26, 8);
    UI.killMessage(killer, this);
    if (Game.mode === 'net') {
      // счёт убийце начисляется на его стороне при получении события
      Net.send({ t: 'died' });
      UI.showRespawn(this, true);
    } else {
      killer.score++;
      UI.updateScore();
      UI.showRespawn(this, true);
      if (killer.score >= WIN_SCORE) Game.endMatch(killer);
    }
  }

  respawn(opponent) {
    let best = this.spawnPos, bestD = -1;
    for (const sp of SPAWN_POINTS) {
      const d = sp.distanceTo(opponent.pos);
      if (d > bestD) { bestD = d; best = sp; }
    }
    this.pos = best.clone();
    this.angle = Math.atan2(-this.pos.x, -this.pos.z);
    this.pitch = 0;
    this.hp = MAX_HP;
    this.alive = true;
    this.mesh.visible = !this.fpView;
    this.syncMesh();
    this.updateHpBar();
    UI.updateHP(this);
    UI.showRespawn(this, false);
    spawnParticles(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xffffff, 16, 5);
  }

  // применение сетевого состояния
  applyNetState(s) {
    this.netTarget = { x: s.x, z: s.z, a: s.a, v: s.v, y: s.y || 0, cr: s.cr || 0 };
    const wasAlive = this.alive;
    this.hp = s.hp;
    this.alive = s.al;
    this.score = s.sc;
    this.updateHpBar();
    if (wasAlive && !s.al) this.mesh.visible = false;
    if (!wasAlive && s.al) {
      this.mesh.visible = !this.fpView;
      this.pos.x = s.x; this.pos.z = s.z; this.angle = s.a;
      spawnParticles(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xffffff, 16, 5);
    }
    UI.updateScore();
  }
}

// ---------------------------------------------------------------------
//  Ввод
// ---------------------------------------------------------------------
const input = {};
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') {
    if (e.code === 'Enter') $('btn-join-go').click();
    return;
  }
  input[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') Game.togglePause();
});
window.addEventListener('keyup', e => { input[e.code] = false; });

// мышь (сетевой режим)
let mouseDX = 0;
let mouseDY = 0;
let mouseFire = false;
function consumeMouseDX() { const v = mouseDX; mouseDX = 0; return v; }
function consumeMouseDY() { const v = mouseDY; mouseDY = 0; return v; }

document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) { mouseDX += e.movementX; mouseDY += e.movementY; }
});
const FP_STATES = ['playing', 'warmup', 'countdown'];
canvas.addEventListener('mousedown', e => {
  if (Game.mode === 'net' && FP_STATES.includes(Game.state)) {
    if (document.pointerLockElement === canvas) {
      if (e.button === 0) mouseFire = true;
    } else {
      canvas.requestPointerLock();
    }
  }
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseFire = false; });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  $('click-hint').classList.toggle('hidden', locked || Game.mode !== 'net' || !FP_STATES.includes(Game.state));
});

// ---------------------------------------------------------------------
//  UI
// ---------------------------------------------------------------------
const $ = id => document.getElementById(id);
const UI = {
  updateHP(p) {
    const el = $(p.id === 1 ? 'hp1' : 'hp2').querySelector('.hp-fill');
    el.style.width = Math.max(0, p.hp) + '%';
    if (p.hp <= 30) el.style.background = 'linear-gradient(90deg,#ff4b4b,#c81e1e)';
    else el.style.background = '';
  },
  updateScore() {
    $('score-p1').textContent = Game.p1.score;
    $('score-p2').textContent = Game.p2.score;
  },
  flashDamage(p) {
    const el = $(p.id === 1 ? 'dmg1' : 'dmg2');
    el.style.opacity = 1;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = 0; }, 180);
  },
  showRespawn(p, show) {
    $(p.id === 1 ? 'respawn1' : 'respawn2').classList.toggle('hidden', !show);
  },
  hitmarker(id) {
    const el = $(id === 1 ? 'hm1' : 'hm2');
    if (!el) return;
    el.style.opacity = 1;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = 0; }, 90);
  },
  setCountdown(n) {
    const el = $('countdown-num');
    el.textContent = n;
    el.classList.remove('pop');
    void el.offsetWidth; // перезапуск CSS-анимации
    el.classList.add('pop');
  },
  killMessage(killer, victim) {
    const feed = $('killfeed');
    const div = document.createElement('div');
    div.className = 'kill-msg';
    const kName = killer.id === 1 ? '<span style="color:#5ea0ff">Синий</span>' : '<span style="color:#ff6a5e">Красный</span>';
    const vName = victim.id === 1 ? '<span style="color:#5ea0ff">Синего</span>' : '<span style="color:#ff6a5e">Красного</span>';
    div.innerHTML = `${kName} ликвидировал ${vName}`;
    feed.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  },
  show(id) { $(id).classList.remove('hidden'); },
  hide(id) { $(id).classList.add('hidden'); },
  setupHudLayout() {
    const hud = $('hud');
    if (Game.mode === 'net') {
      hud.classList.add('net');
      $('hud-p1').classList.toggle('off', Game.localPlayer.id !== 1);
      $('hud-p2').classList.toggle('off', Game.localPlayer.id !== 2);
    } else {
      hud.classList.remove('net');
      $('hud-p1').classList.remove('off');
      $('hud-p2').classList.remove('off');
    }
  },
};

// ---------------------------------------------------------------------
//  Сеть (PeerJS / WebRTC)
// ---------------------------------------------------------------------
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих символов
const codeToId = code => 'arena-duel-v1-' + code.toUpperCase();

// Без TURN за строгим NAT (CGNAT, мобильный интернет) WebRTC не пробивается
// и «Подключение…» висит вечно. Свежие TURN-креды запрашиваем у metered.ca;
// если их сервис недоступен — остаёмся на STUN (прямые соединения всё равно работают).
const METERED_DOMAIN = 'shtduo.metered.live';
const METERED_KEY = '51a66b98b04d7c30ce75036f62b2622ba94d';

const FALLBACK_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function fetchIceConfig() {
  if (!METERED_DOMAIN || !METERED_KEY) return { iceServers: FALLBACK_ICE };
  try {
    const r = await fetch(`https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_KEY}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(r.status);
    const servers = await r.json();
    return { iceServers: [...FALLBACK_ICE, ...servers] };
  } catch (e) {
    console.warn('TURN-креды недоступны, работаем только через STUN:', e);
    return { iceServers: FALLBACK_ICE };
  }
}

const Net = {
  peer: null,
  conn: null,
  isHost: false,
  sendTimer: 0,

  cleanup() {
    clearTimeout(this.joinTimer);
    if (this.conn) { try { this.conn.close(); } catch {} this.conn = null; }
    if (this.peer) { try { this.peer.destroy(); } catch {} this.peer = null; }
  },

  async host() {
    this.cleanup();
    this.isHost = true;
    const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    $('room-code').textContent = code;
    $('host-status').innerHTML = 'Подключение к серверу<span class="dots"></span>';

    const ice = await fetchIceConfig();
    this.peer = new Peer(codeToId(code), { config: ice });
    this.peer.on('open', () => {
      // сервер подтвердил код — хост сразу заходит на карту и ждёт в разминке
      UI.hide('net-screen');
      Game.startWarmup(code);
    });
    this.peer.on('connection', conn => {
      if (this.conn && this.conn.open) { conn.close(); return; } // уже играем
      if (this.conn) { try { this.conn.close(); } catch {} } // зависшая попытка — заменяем новой
      this.conn = conn;
      conn.on('open', () => Game.beginCountdown());
      this.wireConn(conn);
    });
    // если пропала связь с сигнальным сервером (например, вкладку свернули) — переподключаемся;
    // на уже установленное P2P-соединение это не влияет
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch {} });
    this.peer.on('error', err => {
      if (err.type === 'unavailable-id') { this.host(); return; } // код занят — новый
      if (err.type === 'network') return; // транзиентная ошибка сигналинга — reconnect разберётся
      if (Game.state === 'warmup') { this.onLost(); return; }
      $('host-status').textContent = 'Ошибка сети: ' + err.type;
    });
  },

  async join(code) {
    this.cleanup();
    this.isHost = false;
    $('join-status').textContent = 'Подключение к серверу…';
    // если за разумное время не соединились — говорим об этом, а не висим молча
    this.joinTimer = setTimeout(() => {
      if (!this.conn || !this.conn.open) {
        this.cleanup();
        $('join-status').textContent = 'Не получилось подключиться. Проверь код и попробуй ещё раз.';
      }
    }, 25000);
    const ice = await fetchIceConfig();
    this.peer = new Peer({ config: ice });
    this.peer.on('open', () => {
      $('join-status').textContent = 'Комната найдена, устанавливаем соединение…';
      const conn = this.peer.connect(codeToId(code), { reliable: true });
      this.conn = conn;
      conn.on('open', () => {
        clearTimeout(this.joinTimer);
        UI.hide('net-screen');
        Game.setupNetRoles(false);
        Game.beginCountdown();
      });
      this.wireConn(conn);
    });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch {} });
    this.peer.on('error', err => {
      if (err.type === 'peer-unavailable') $('join-status').textContent = 'Игра с таким кодом не найдена';
      else if (err.type !== 'network') $('join-status').textContent = 'Ошибка сети: ' + err.type;
    });
  },

  wireConn(conn) {
    conn.on('data', d => this.onMessage(d));
    conn.on('close', () => this.onLost());
    conn.on('error', () => this.onLost());
  },

  onLost() {
    const s = Game.state;
    if (Game.mode === 'net' && ['playing', 'paused', 'gameover', 'warmup', 'countdown'].includes(s)) {
      document.exitPointerLock?.();
      UI.hide('pause'); UI.hide('countdown'); UI.hide('warmup-banner');
      UI.show('net-lost');
      Game.state = 'netlost';
    } else if (s === 'menu') {
      // сорвалось ещё на этапе подключения — показываем на экране ввода кода
      $('join-status').textContent = 'Соединение сорвалось. Попробуй ещё раз.';
    }
    this.cleanup();
  },

  send(msg) {
    if (Game.mode === 'net' && this.conn && this.conn.open) this.conn.send(msg);
  },

  sendState(p) {
    this.send({
      t: 's',
      x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2),
      y: +p.pos.y.toFixed(2),
      a: +p.angle.toFixed(3),
      v: +(p.lastSpeed || 0).toFixed(1),
      cr: p.crouching ? 1 : 0,
      hp: p.hp, al: p.alive, sc: p.score,
    });
  },

  onMessage(d) {
    const local = Game.localPlayer, remote = Game.remotePlayer;
    if (!local || !remote) return;
    switch (d.t) {
      case 's':
        remote.applyNetState(d);
        break;
      case 'shot': {
        const o = new THREE.Vector3().fromArray(d.o);
        const e = new THREE.Vector3().fromArray(d.e);
        spawnTracer(o, e);
        spawnParticles(e, 0xa89a7a, 4, 3);
        flashMuzzleLight(o);
        remote.flashTime = 0.05;
        remote.recoil = 1;
        AudioSys.shot(true);
        break;
      }
      case 'hit':
        local.takeDamage(d.d, remote);
        break;
      case 'died': {
        // противник погиб от моей руки
        remote.alive = false;
        remote.hp = 0;
        remote.mesh.visible = false;
        AudioSys.death();
        spawnParticles(remote.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), remote.colorHex, 26, 8);
        local.score++;
        UI.updateScore();
        UI.killMessage(local, remote);
        if (local.score >= WIN_SCORE) {
          this.send({ t: 'win' });
          Game.endMatch(local);
        }
        break;
      }
      case 'mk':
        if (medkits[d.i]) medkits[d.i].take();
        break;
      case 'win':
        Game.endMatch(remote);
        break;
      case 'rematch':
        if (Game.state === 'gameover') Game.beginCountdown();
        break;
    }
  },
};

// ---------------------------------------------------------------------
//  Игра
// ---------------------------------------------------------------------
const Game = {
  state: 'menu', // menu | warmup | countdown | playing | paused | gameover | netlost
  mode: 'local', // local | net
  p1: null, p2: null,
  localPlayer: null, remotePlayer: null,
  countdownT: 0,
  lastCountdownN: 0,
  prePause: 'playing',

  init() {
    this.p1 = new Player(1, M.blue, M.blueDark, new THREE.Vector3(-22, 0, -22), Math.atan2(22, 22), 0x3f7bff);
    this.p2 = new Player(2, M.red, M.redDark, new THREE.Vector3(22, 0, 22), Math.atan2(-22, -22), 0xff5e3a);
  },

  resetMatch(nextState = 'playing') {
    this.p1.reset(true);
    this.p2.reset(true);
    for (const mk of medkits) mk.reset();
    UI.updateHP(this.p1); UI.updateHP(this.p2);
    UI.updateScore();
    UI.showRespawn(this.p1, false); UI.showRespawn(this.p2, false);
    $('killfeed').innerHTML = '';
    UI.hide('menu'); UI.hide('gameover'); UI.hide('pause'); UI.hide('net-screen'); UI.hide('net-lost'); UI.hide('countdown');
    UI.show('hud');
    this.state = nextState;
    resize(); // аспект камер зависит от режима (сплит / полный экран)
  },

  startLocal() {
    AudioSys.ensure();
    this.mode = 'local';
    this.p1.control = 'keys1';
    this.p2.control = 'keys2';
    this.localPlayer = null; this.remotePlayer = null;
    this.p1.hpBar.visible = false; this.p2.hpBar.visible = false;
    this.p1.fpView = false; this.p2.fpView = false;
    this.p1.viewModel = null; this.p2.viewModel = null;
    this.p1.camera.fov = 70; this.p2.camera.fov = 70;
    viewModel.group.removeFromParent();
    this.resetMatch();
    UI.setupHudLayout();
  },

  setupNetRoles(isHost) {
    AudioSys.ensure();
    this.mode = 'net';
    // хост — синий (p1), гость — красный (p2)
    this.localPlayer = isHost ? this.p1 : this.p2;
    this.remotePlayer = isHost ? this.p2 : this.p1;
    this.localPlayer.control = 'mouse';
    this.remotePlayer.control = 'remote';
    this.localPlayer.hpBar.visible = false;
    this.remotePlayer.hpBar.visible = true;
    // от первого лица: своя модель скрыта, оружие висит перед камерой
    this.localPlayer.fpView = true;
    this.remotePlayer.fpView = false;
    this.localPlayer.camera.fov = 75;
    this.localPlayer.camera.add(viewModel.group);
    this.localPlayer.viewModel = viewModel;
    scene.add(this.localPlayer.camera); // дети камеры рендерятся, только если она в сцене
    UI.setupHudLayout();
  },

  // хост бегает по карте один, пока не подключится второй игрок
  startWarmup(code) {
    this.setupNetRoles(true);
    this.resetMatch('warmup');
    this.remotePlayer.mesh.visible = false;
    this.remotePlayer.alive = false;
    this.remotePlayer.hpBar.visible = false;
    $('warmup-code').textContent = code;
    UI.show('warmup-banner');
    // запрос вне клика может не сработать — тогда останется подсказка
    $('click-hint').classList.remove('hidden');
    canvas.requestPointerLock?.();
  },

  // второй игрок подключился: телепорт по спаунам и отсчёт до боя
  beginCountdown() {
    this.resetMatch('countdown');
    this.countdownT = 5;
    this.lastCountdownN = 6;
    this.remotePlayer.hpBar.visible = true;
    UI.hide('warmup-banner');
    UI.setCountdown(5);
    UI.show('countdown');
    $('click-hint').classList.remove('hidden');
    canvas.requestPointerLock?.();
  },

  togglePause() {
    if (this.state === 'playing' || this.state === 'warmup') {
      this.prePause = this.state;
      this.state = 'paused';
      document.exitPointerLock?.();
      UI.show('pause');
    } else if (this.state === 'paused') {
      this.state = this.prePause || 'playing';
      UI.hide('pause');
      if (this.mode === 'net') canvas.requestPointerLock?.();
    }
  },

  endMatch(winner) {
    this.state = 'gameover';
    document.exitPointerLock?.();
    const wt = $('winner-text');
    if (this.mode === 'net') {
      const won = winner === this.localPlayer;
      wt.textContent = won ? 'Победа!' : 'Поражение';
      wt.style.color = won ? '#5ea0ff' : '#ff6a5e';
    } else if (winner.id === 1) { wt.textContent = 'Синий побеждает!'; wt.style.color = '#5ea0ff'; }
    else { wt.textContent = 'Красный побеждает!'; wt.style.color = '#ff6a5e'; }
    $('final-score').textContent = `${this.p1.score} : ${this.p2.score}`;
    UI.show('gameover');
  },

  quitToMenu() {
    Net.cleanup();
    document.exitPointerLock?.();
    viewModel.group.removeFromParent();
    this.p1.fpView = false; this.p2.fpView = false;
    this.p1.viewModel = null; this.p2.viewModel = null;
    this.p1.mesh.visible = true; this.p2.mesh.visible = true;
    this.state = 'menu';
    this.mode = 'local';
    UI.hide('hud'); UI.hide('pause'); UI.hide('gameover'); UI.hide('net-screen'); UI.hide('net-lost');
    UI.hide('warmup-banner'); UI.hide('countdown');
    $('click-hint').classList.add('hidden');
    UI.show('menu');
  },
};

// ---------------------------------------------------------------------
//  Кнопки меню
// ---------------------------------------------------------------------
document.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => b.blur()));

function showNetSub(which) {
  $('net-choice').classList.toggle('hidden', which !== 'choice');
  $('net-host').classList.toggle('hidden', which !== 'host');
  $('net-join').classList.toggle('hidden', which !== 'join');
}

$('btn-play').onclick = () => { AudioSys.click(); Game.startLocal(); };
$('btn-controls').onclick = () => { AudioSys.click(); UI.hide('menu'); UI.show('controls-screen'); };
$('btn-back').onclick = () => { AudioSys.click(); UI.hide('controls-screen'); UI.show('menu'); };
$('btn-resume').onclick = () => { AudioSys.click(); Game.togglePause(); };
$('btn-quit').onclick = () => { AudioSys.click(); Game.quitToMenu(); };
$('btn-rematch').onclick = () => {
  AudioSys.click();
  if (Game.mode === 'net') {
    if (Net.conn && Net.conn.open) { Net.send({ t: 'rematch' }); Game.beginCountdown(); }
    else Game.quitToMenu();
  } else Game.startLocal();
};
$('btn-menu').onclick = () => { AudioSys.click(); Game.quitToMenu(); };
$('btn-lost-menu').onclick = () => { AudioSys.click(); Game.quitToMenu(); };

$('btn-net').onclick = () => {
  AudioSys.click();
  UI.hide('menu'); UI.show('net-screen');
  showNetSub('choice');
};
$('btn-net-back').onclick = () => { AudioSys.click(); Net.cleanup(); UI.hide('net-screen'); UI.show('menu'); };
$('btn-host').onclick = () => { AudioSys.click(); showNetSub('host'); Net.host(); };
$('btn-host-cancel').onclick = () => { AudioSys.click(); Net.cleanup(); showNetSub('choice'); };
$('btn-join').onclick = () => { AudioSys.click(); showNetSub('join'); $('join-status').textContent = ''; setTimeout(() => $('join-code').focus(), 50); };
$('btn-join-cancel').onclick = () => { AudioSys.click(); Net.cleanup(); showNetSub('choice'); };
$('btn-join-go').onclick = () => {
  AudioSys.click();
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length < 4) { $('join-status').textContent = 'Введи код из 5 символов'; return; }
  Net.join(code);
};

// ---------------------------------------------------------------------
//  Рендер
// ---------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  for (const p of [Game.p1, Game.p2]) {
    if (!p) continue;
    p.camera.aspect = (Game.mode === 'net' ? w : w / 2) / h;
    p.camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);

const menuCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
const camWorld = new THREE.Vector3();

let last = performance.now();

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const t = now / 1000;

  for (const mk of medkits) mk.update(dt, t);
  updateEffects(dt);

  for (const c of clouds) {
    c.g.position.x += c.sp * dt;
    if (c.g.position.x > 150) c.g.position.x = -150;
  }

  // отсчёт перед боем: игроки заморожены, цифра тикает
  if (Game.state === 'countdown') {
    Game.countdownT -= dt;
    const n = Math.max(1, Math.ceil(Game.countdownT));
    if (n !== Game.lastCountdownN) { Game.lastCountdownN = n; UI.setCountdown(n); AudioSys.click(); }
    if (Game.countdownT <= 0) {
      Game.state = 'playing';
      UI.hide('countdown');
      AudioSys.pickup();
    }
  }

  const active = Game.state === 'playing' || Game.state === 'warmup' || (Game.state === 'paused' && Game.mode === 'net');
  if (active) {
    Game.p1.update(dt, Game.p2, t);
    Game.p2.update(dt, Game.p1, t);
    if (Game.mode === 'net') {
      Net.sendTimer -= dt;
      if (Net.sendTimer <= 0) {
        Net.sendTimer = NET_SEND_INTERVAL;
        Net.sendState(Game.localPlayer);
      }
      // полоска HP противника всегда смотрит в камеру
      const cam = Game.localPlayer.camera;
      cam.getWorldPosition(camWorld);
      Game.remotePlayer.hpBar.lookAt(camWorld);
    }
  }
}

// когда вкладка скрыта, rAF не работает — тикаем по таймеру, чтобы
// сетевая игра не замирала у противника
setInterval(() => { if (document.hidden) tick(performance.now()); }, 50);

function loop(now) {
  requestAnimationFrame(loop);
  tick(now);
  const t = now / 1000;
  const w = window.innerWidth, h = window.innerHeight;

  renderer.setScissorTest(true);

  if (Game.state === 'menu' || (Game.state === 'gameover' && Game.mode === 'local') || Game.state === 'netlost') {
    const a = t * 0.12;
    menuCamera.aspect = w / h;
    menuCamera.updateProjectionMatrix();
    // облёт центрального зала изнутри
    menuCamera.position.set(Math.cos(a) * 13, 5, Math.sin(a) * 13);
    menuCamera.lookAt(0, 1, 0);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(scene, menuCamera);
    return;
  }

  if (Game.mode === 'net' && Game.localPlayer) {
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(scene, Game.localPlayer.camera);
  } else {
    renderer.setViewport(0, 0, w / 2, h);
    renderer.setScissor(0, 0, w / 2, h);
    renderer.render(scene, Game.p1.camera);
    renderer.setViewport(w / 2, 0, w / 2, h);
    renderer.setScissor(w / 2, 0, w / 2, h);
    renderer.render(scene, Game.p2.camera);
  }
}

Game.init();
scene.updateMatrixWorld(true);
resize();
requestAnimationFrame(loop);

// отладка при локальной разработке
if (location.hostname === 'localhost') {
  window.ARENA = Game;
  window.__tick = tick;
}