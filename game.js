'use strict';
/* =====================================================================
   GAME ASIMETRIS 3D  (1 Killer vs 4 Survivor)  —  Three.js r128
   File ini berisi: konfigurasi, dunia/peta, "Rigidbody" Pawn (pergerakan
   + Lantai Licin + jatuh 3 detik), kamera third-person, input, dan loop.
   Karakter dibuat oleh chibi.js (createChibi) apa adanya dari file kamu.
   ===================================================================== */

/* ---------- 1. KONFIGURASI (semua angka bisa diatur di sini) ---------- */
const CFG = {
  walkSpeed: 4.2,      // kecepatan jalan standar Survivor (m/detik)
  runMul: 1.6,         // pengali saat tahan Shift
  crouchMul: 0.5,      // pengali saat tahan C
  killerMul: 1.15,     // Killer sedikit lebih cepat
  accel: 45,           // percepatan di lantai normal (besar = friksi tinggi, responsif)
  airAccel: 8,         // kontrol saat melayang di udara
  jumpSpeed: 6.2,      // kecepatan lompat awal
  gravity: 18,         // gravitasi
  // --- Lantai Licin ---
  iceAccel: 6,         // percepatan di es (kecil = susah belok/berhenti)
  iceFriction: 0.35,   // friksi es (mendekati 0 = meluncur terus)
  iceMaxSpeed: 9,      // batas kecepatan luncur
  iceChaos: 1.0,       // seberapa "liar" kontrolnya (0 = tidak liar)
  // --- Tabrakan & jatuh ---
  minImpact: 2.0,      // kecepatan benturan minimum agar karakter jatuh
  bounce: 0.35,        // pantulan dari dinding saat di es
  fallTime: 3.0,       // lama tidak bisa bergerak setelah jatuh (detik)
  getUpTime: 0.6,      // lama animasi berdiri
  radius: 0.38,        // radius kapsul tabrakan
  scale: 1.4           // skala model chibi (tinggi asli ± 1.25)
};

/* ---------- 2. DUNIA: lantai, zona es, dinding (kotak AABB) ---------- */
const ARENA = 40;                                   // arena = 80 x 80
const ICE = { x0: -12, x1: 12, z0: -12, z1: 12 };   // area Lantai Licin
const BOXES = [];                                   // semua penghalang padat
function addBox(cx, cz, w, d, h, color, scene) {
  const b = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h };
  BOXES.push(b);
  if (scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    m.position.set(cx, h / 2, cz); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
}
function inIce(x, z) { return x > ICE.x0 && x < ICE.x1 && z > ICE.z0 && z < ICE.z1; }

function buildWorld(scene) {
  // lantai biasa
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
    new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  scene.add(new THREE.GridHelper(ARENA * 2, 40, 0x6b7a60, 0x5d6b53));
  // lantai licin (es)
  const ice = new THREE.Mesh(new THREE.PlaneGeometry(ICE.x1 - ICE.x0, ICE.z1 - ICE.z0),
    new THREE.MeshStandardMaterial({ color: 0x9fe3ff, roughness: 0.04, metalness: 0.25 }));
  ice.rotation.x = -Math.PI / 2; ice.position.y = 0.02; ice.receiveShadow = true; scene.add(ice);
  // dinding luar
  const t = 1, H = 3.2, W = ARENA * 2 + 2 * t;
  addBox(0, -ARENA - t / 2, W, t, H, 0x39414f, scene); addBox(0, ARENA + t / 2, W, t, H, 0x39414f, scene);
  addBox(-ARENA - t / 2, 0, t, W, H, 0x39414f, scene); addBox(ARENA + t / 2, 0, t, W, H, 0x39414f, scene);
  // pilar & dinding di dalam zona es (untuk menabrak)
  [[-6, -6], [6, -6], [-6, 6], [6, 6]].forEach(([x, z]) => addBox(x, z, 2, 2, 3, 0x7a6a58, scene));
  addBox(0, 10.5, 9, 1, 3, 0x7a6a58, scene);
  addBox(-11.5, 0, 1, 7, 3, 0x7a6a58, scene);
  // rintangan di luar es
  [[22, 10, 4, 4], [-24, 16, 5, 3], [16, -26, 6, 3], [-20, -24, 3, 6], [0, -22, 12, 1]]
    .forEach(([x, z, w, d]) => addBox(x, z, w, d, 2.6, 0x6a5a7a, scene));
}

/* ---------- 3. PAWN = karakter + "Rigidbody" + animasi ---------- */
// Titik spawn per slot: 0 = Killer, 1..4 = Survivor
const SPAWNS = [[0, -32], [-8, 24], [-3, 27], [3, 27], [8, 24]];
// Slot -> indeks karakter di CHARS (0 Kai, 5 Mika, 2 Leo, 7 Luna, 4 Akira)
const SLOT_CHAR = [4, 0, 5, 2, 7];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const easeOutBack = x => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

class Pawn {
  constructor(slot, scene, isLocal, name) {
    this.slot = slot; this.isLocal = isLocal;
    this.role = slot === 0 ? 'killer' : 'survivor';
    // --- state "Rigidbody" ---
    this.pos = new THREE.Vector3(SPAWNS[slot][0], 0, SPAWNS[slot][1]);
    this.vel = new THREE.Vector3();          // velocity (x,z = horizontal, y = vertikal)
    this.yaw = Math.PI;                      // arah hadap model
    this.grounded = true;
    // --- mekanik Lantai Licin ---
    this.isSlippery = false;                 // <<< VARIABEL BOOLEAN YANG DIMINTA
    this.slipOverride = false;               // debug: paksa licin di mana saja (tombol T)
    this.kickT = 0.5; this.chaosPhase = Math.random() * 10;
    // --- state jatuh ---
    this.state = 'normal';                   // 'normal' | 'fallen' | 'gettingUp'
    this.stateT = 0; this.tiltTarget = -Math.PI / 2; this.fallClock = 0;
    this.crouch = false; this.speed = 0; this.walkPhase = 0;
    // --- visual: pivot(posisi+yaw) -> tilt(rotasi jatuh) -> model chibi ---
    this.pivot = new THREE.Group(); this.tilt = new THREE.Group();
    this.model = createChibi(CHARS[SLOT_CHAR[slot]].o);
    this.model.scale.setScalar(CFG.scale);
    this.model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.tilt.add(this.model); this.pivot.add(this.tilt); scene.add(this.pivot);
    // untuk pemain jarak jauh (interpolasi)
    this.target = null;
    // papan nama di atas kepala (hanya pemain lain)
    if (!isLocal && name) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
      x.fillStyle = 'rgba(10,10,12,.78)'; x.fillRect(0, 8, 256, 48);
      x.fillStyle = this.role === 'killer' ? '#e11d2e' : '#f5f5f7'; x.fillRect(0, 8, 6, 48);
      x.font = '700 28px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#f5f5f7'; x.fillText('@' + name, 132, 33);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
      sp.scale.set(1.6, 0.4, 1); sp.position.y = 2.25; this.pivot.add(sp);
    }
  }

  /* ----- dipanggil tiap frame fisika untuk pemain LOKAL ----- */
  update(dt, inp, camYaw) {
    const v = this.vel, g = this.state === 'normal';
    const killer = this.role === 'killer';

    // (1) Tentukan isSlippery: hanya Survivor, saat menapak tanah di zona es
    if (this.grounded) this.isSlippery = !killer && (this.slipOverride || inIce(this.pos.x, this.pos.z));

    // (2) Arah input relatif kamera. forward = -z kamera, right = +x kamera
    let ix = g ? inp.x : 0, iz = g ? inp.z : 0;
    const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
    const inLen = Math.hypot(dx, dz);

    // (3) Kecepatan target
    this.crouch = g && inp.crouch;
    let sp = CFG.walkSpeed * (killer ? CFG.killerMul : 1);
    if (this.crouch) sp *= CFG.crouchMul; else if (inp.run) sp *= CFG.runMul;

    if (g && this.grounded && this.isSlippery) {
      /* ===== MODE LICIN (isSlippery = TRUE) =====
         - friksi hampir nol: kecepatan lama (momentum) terus terbawa
         - input W,A,S,D hanya menambah GAYA kecil, bukan mengatur kecepatan
         - arah input "dibengkokkan" noise + sentakan acak => kontrol liar */
      const fr = Math.exp(-CFG.iceFriction * dt); v.x *= fr; v.z *= fr;
      if (inLen > 0) {
        const t = performance.now() / 1000 + this.chaosPhase;
        const ang = (Math.sin(t * 2.3) * 0.7 + Math.sin(t * 5.1) * 0.4) * CFG.iceChaos;
        const c = Math.cos(ang), s = Math.sin(ang);
        const ux = dx / inLen, uz = dz / inLen;
        v.x += (ux * c - uz * s) * CFG.iceAccel * dt;
        v.z += (ux * s + uz * c) * CFG.iceAccel * dt;
      }
      this.kickT -= dt;                           // sentakan acak ke samping
      if (this.kickT < 0 && (inLen > 0 || Math.hypot(v.x, v.z) > 1)) {
        this.kickT = 0.5 + Math.random() * 0.8;
        const k = (Math.random() * 2 - 1) * 2.5 * CFG.iceChaos, h = Math.hypot(v.x, v.z) || 1;
        v.x += (-v.z / h) * k; v.z += (v.x / h) * k;
      }
      const h = Math.hypot(v.x, v.z);
      if (h > CFG.iceMaxSpeed) { v.x *= CFG.iceMaxSpeed / h; v.z *= CFG.iceMaxSpeed / h; }
    } else if (g) {
      /* ===== MODE NORMAL (isSlippery = FALSE): kecepatan langsung mengejar target ===== */
      const a = (this.grounded ? CFG.accel : CFG.airAccel) * dt;
      const tx = dx * sp, tz = dz * sp, ex = tx - v.x, ez = tz - v.z, el = Math.hypot(ex, ez);
      if (el <= a) { v.x = tx; v.z = tz; } else { v.x += ex / el * a; v.z += ez / el * a; }
    } else {
      // sedang jatuh/berdiri: tidak bisa dikontrol, hanya meluncur & melambat
      const fr = Math.exp(-1.8 * dt); v.x *= fr; v.z *= fr;
    }

    // (4) Lompat + gravitasi
    if (g && this.grounded && inp.jump) { v.y = CFG.jumpSpeed; this.grounded = false; }
    v.y -= CFG.gravity * dt;
    this.pos.y += v.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; v.y = 0; this.grounded = true; }

    // (5) Integrasi posisi + tabrakan dinding
    this.pos.x += v.x * dt; this.pos.z += v.z * dt;
    const hit = this.collide();

    // (6) Jika menabrak dinding saat licin & cukup kencang -> JATUH 3 DETIK
    if (hit && killer === false && this.state === 'normal' && this.isSlippery && hit.impact > CFG.minImpact) {
      this.fall(hit.nx, hit.nz);
    }

    // (7) Hadap ke arah gerak (bukan saat jatuh)
    if (g && (inLen > 0 || Math.hypot(v.x, v.z) > 0.5)) {
      const want = inLen > 0 ? Math.atan2(dx, dz) : Math.atan2(v.x, v.z);
      this.yaw += angDiff(this.yaw, want) * Math.min(1, dt * 12);
    }

    // (8) Timer state jatuh -> berdiri -> normal
    if (this.state !== 'normal') {
      this.stateT -= dt; this.fallClock += dt;
      if (this.state === 'fallen' && this.stateT <= 0) { this.state = 'gettingUp'; this.stateT = CFG.getUpTime; }
      else if (this.state === 'gettingUp' && this.stateT <= 0) { this.state = 'normal'; }
    }
    this.speed = Math.hypot(v.x, v.z);
  }

  /* Tabrakan lingkaran (kapsul) vs kotak dinding pada bidang XZ.
     Mengembalikan {impact, nx, nz} jika menabrak (nx,nz = normal dinding). */
  collide() {
    const r = CFG.radius, p = this.pos, v = this.vel; let res = null;
    for (const b of BOXES) {
      if (p.y >= b.h) continue;
      const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, pen;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
      else { // pusat di dalam kotak: dorong lewat sisi terdekat
        const l = p.x - b.x0, rr = b.x1 - p.x, tp = p.z - b.z0, bt = b.z1 - p.z, m = Math.min(l, rr, tp, bt);
        if (m === l) { nx = -1; nz = 0; pen = l + r; } else if (m === rr) { nx = 1; nz = 0; pen = rr + r; }
        else if (m === tp) { nx = 0; nz = -1; pen = tp + r; } else { nx = 0; nz = 1; pen = bt + r; }
      }
      p.x += nx * pen; p.z += nz * pen;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) {
        const e = this.isSlippery ? CFG.bounce : 0;       // memantul hanya di es
        v.x -= (1 + e) * vn * nx; v.z -= (1 + e) * vn * nz;
        if (!res || -vn > res.impact) res = { impact: -vn, nx, nz };
      }
    }
    return res;
  }

  /* Karakter terjatuh (ragdoll sederhana): roboh + anggota badan lemas */
  fall(nx, nz) {
    this.state = 'fallen'; this.stateT = CFG.fallTime; this.fallClock = 0;
    // menghadap dinding -> roboh ke belakang; membelakangi -> roboh ke depan
    const facing = Math.sin(this.yaw) * -nx + Math.cos(this.yaw) * -nz;
    this.tiltTarget = facing >= -0.3 ? -Math.PI / 2 : Math.PI / 2;
  }

  /* ----- pemain jarak jauh: terapkan data jaringan ----- */
  applyNet(d) { this.target = d; }
  updateRemote(dt) {
    const d = this.target; if (!d) return;
    const k = Math.min(1, dt * 12), ox = this.pos.x, oz = this.pos.z;
    this.pos.x = lerp(this.pos.x, d.x, k); this.pos.y = lerp(this.pos.y, d.y, k); this.pos.z = lerp(this.pos.z, d.z, k);
    this.yaw += angDiff(this.yaw, d.yaw) * k;
    this.speed = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-3);
    if (d.st !== undefined) {
      const m = ['normal', 'fallen', 'gettingUp'][d.st];
      if (m !== this.state && m === 'fallen') this.fallClock = 0;
      this.state = m; this.stateT = d.sT; this.tiltTarget = d.tt;
      this.crouch = !!d.cr; this.isSlippery = !!d.sl;
    }
    if (this.state !== 'normal') this.fallClock += dt;
  }

  /* ----- animasi visual (dipakai lokal & remote) ----- */
  animate(dt, t) {
    const J = this.model.userData.joints;
    this.model.userData.update(t);                       // idle + kedip bawaan file chibi
    this.pivot.position.copy(this.pos); this.pivot.rotation.y = this.yaw;
    let tilt = 0, wob = 0;
    // reset pose dasar tiap frame (supaya pose es/jatuh/lompat tidak "menempel")
    J.armL.rotation.z = -0.22; J.armR.rotation.z = 0.22;
    J.legL.rotation.x = J.legR.rotation.x = J.legL.rotation.z = J.legR.rotation.z = 0;
    J.kneeL.rotation.x = J.kneeR.rotation.x = 0; J.elbowL.rotation.x = J.elbowR.rotation.x = -0.15; J.head.rotation.x = 0;

    if (this.state === 'normal') {
      const amp = clamp(this.speed / 6, 0, 1.2);
      this.walkPhase += this.speed * dt * 2.2;
      const ph = this.walkPhase, s = Math.sin(ph);
      if (this.crouch) {                                 // jongkok
        J.hips.position.y -= 0.1;
        J.legL.rotation.x = J.legR.rotation.x = -0.9; J.kneeL.rotation.x = J.kneeR.rotation.x = 1.5;
        J.spine.rotation.x = 0.25;
      } else if (this.isSlippery && this.speed > 1) {    // meluncur di es: tangan terentang, goyah
        const f = Math.sin(t * 9) * 0.3;
        J.armL.rotation.z = -(0.22 + 0.9 + f); J.armR.rotation.z = 0.22 + 0.9 - f;
        J.legL.rotation.x = -0.35 + Math.sin(t * 8) * 0.15; J.legR.rotation.x = 0.3 - Math.sin(t * 8) * 0.15;
        J.legL.rotation.z = -0.25; J.legR.rotation.z = 0.25;
        J.spine.rotation.x = 0.15 + Math.sin(t * 6) * 0.1;
        tilt = 0; this.tilt.rotation.z = Math.sin(t * 7) * 0.14 * clamp(this.speed / 5, 0, 1);
      } else if (this.speed > 0.3) {                     // berjalan / berlari
        J.legL.rotation.x = s * amp * 0.9; J.legR.rotation.x = -s * amp * 0.9;
        J.kneeL.rotation.x = Math.max(0, -Math.cos(ph)) * 0.8 * amp; J.kneeR.rotation.x = Math.max(0, Math.cos(ph)) * 0.8 * amp;
        J.armL.rotation.x = -s * amp * 0.8; J.armR.rotation.x = s * amp * 0.8;
        J.elbowL.rotation.x = J.elbowR.rotation.x = -0.15 - amp * 0.8;
        J.spine.rotation.x = amp * 0.12;
      }
      if (!(this.isSlippery && this.speed > 1)) this.tilt.rotation.z = lerp(this.tilt.rotation.z, 0, Math.min(1, dt * 10));
      if (!this.grounded) { J.armL.rotation.z = -1.1; J.armR.rotation.z = 1.1; J.legL.rotation.x = -0.5; J.legR.rotation.x = 0.3; }
      this.tilt.rotation.x = lerp(this.tilt.rotation.x, 0, Math.min(1, dt * 12)); this.tilt.position.y = 0;
      return;
    }

    // --- jatuh / berdiri ---
    if (this.state === 'fallen') {
      const p = clamp(this.fallClock / 0.35, 0, 1);
      tilt = this.tiltTarget * easeOutBack(p);           // roboh dengan sedikit memantul
      wob = Math.exp(-3 * this.fallClock) * Math.sin(this.fallClock * 18);
    } else {                                             // gettingUp: bangun perlahan
      const p = clamp(this.stateT / CFG.getUpTime, 0, 1);
      tilt = this.tiltTarget * p * p;
    }
    this.tilt.rotation.x = tilt; this.tilt.rotation.z = 0;
    this.tilt.position.y = Math.abs(Math.sin(tilt)) * 0.16;   // tubuh rebah menempel lantai
    // anggota badan lemas (ragdoll-lite): menyebar + bergetar mereda
    J.armL.rotation.z = -(0.9 + wob * 0.4); J.armR.rotation.z = 0.9 + wob * 0.4;
    J.armL.rotation.x = wob * 0.5; J.armR.rotation.x = -wob * 0.5;
    J.legL.rotation.z = -0.25 - wob * 0.1; J.legR.rotation.z = 0.25 + wob * 0.1;
    J.legL.rotation.x = wob * 0.3; J.legR.rotation.x = -wob * 0.3;
    J.head.rotation.x = wob * 0.25;
  }

  /* data yang dikirim ke jaringan */
  netState() {
    return { x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(2),
      st: ['normal', 'fallen', 'gettingUp'].indexOf(this.state), sT: +this.stateT.toFixed(2), tt: this.tiltTarget,
      cr: this.crouch ? 1 : 0, sl: this.isSlippery ? 1 : 0 };
  }
}

/* ---------- 4. SCENE, KAMERA THIRD-PERSON, INPUT ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e2531); scene.fog = new THREE.Fog(0x1e2531, 40, 110);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xdde8ff, 0x3a4636, 0.9));
const sun = new THREE.DirectionalLight(0xfff0dc, 1.0); sun.position.set(30, 50, 20); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, far: 150 }); scene.add(sun);
buildWorld(scene);

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// kamera orbit: camYaw (kiri-kanan), camPitch (atas-bawah)
const cam = { yaw: 0, pitch: 0.35, dist: 5.5 };
const keys = {}; const touch = { x: 0, z: 0, jump: false, run: false, crouch: false };
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'KeyT' && me) me.slipOverride = !me.slipOverride; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => keys[e.code] = false);
renderer.domElement.addEventListener('click', () => { if (!('ontouchstart' in window)) renderer.domElement.requestPointerLock?.(); });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  cam.yaw -= e.movementX * 0.0025; cam.pitch = clamp(cam.pitch + e.movementY * 0.0025, -0.15, 1.2);
});

// kontrol sentuh (untuk APK): joystick kiri, geser kanan = kamera, tombol aksi
if ('ontouchstart' in window) {
  document.getElementById('touch').style.display = 'block';
  const joy = document.getElementById('joy'), knob = document.getElementById('knob'); let jid = null, jx = 0, jy = 0, cid = null, cx = 0, cy = 0;
  addEventListener('touchstart', e => { for (const t of e.changedTouches) {
    const r = joy.getBoundingClientRect();
    if (jid === null && t.clientX < innerWidth * 0.4 && t.clientY > innerHeight * 0.4) { jid = t.identifier; jx = r.left + r.width / 2; jy = r.top + r.height / 2; }
    else if (cid === null && t.clientX > innerWidth * 0.4 && !t.target.closest?.('.act')) { cid = t.identifier; cx = t.clientX; cy = t.clientY; } } });
  addEventListener('touchmove', e => { for (const t of e.changedTouches) {
    if (t.identifier === jid) { let x = (t.clientX - jx) / 50, y = (t.clientY - jy) / 50; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      touch.x = x; touch.z = -y; knob.style.transform = `translate(${x * 40}px,${y * 40}px)`; }
    else if (t.identifier === cid) { cam.yaw -= (t.clientX - cx) * 0.006; cam.pitch = clamp(cam.pitch + (t.clientY - cy) * 0.004, -0.15, 1.2); cx = t.clientX; cy = t.clientY; } } });
  const end = e => { for (const t of e.changedTouches) { if (t.identifier === jid) { jid = null; touch.x = touch.z = 0; knob.style.transform = ''; } if (t.identifier === cid) cid = null; } };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  [['bJump', 'jump'], ['bRun', 'run'], ['bCrouch', 'crouch']].forEach(([id, k]) => {
    const b = document.getElementById(id);
    b.addEventListener('touchstart', e => { e.preventDefault(); touch[k] = true; }); b.addEventListener('touchend', () => touch[k] = false); });
}

function readInput() {
  const k = keys;
  return {
    x: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + touch.x,
    z: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + touch.z,
    run: !!(k.ShiftLeft || k.ShiftRight) || touch.run, jump: !!k.Space || touch.jump, crouch: !!k.KeyC || touch.crouch
  };
}

function updateCamera(dt) {
  const tx = me.pos.x, ty = me.pos.y + 1.5, tz = me.pos.z;
  const cp = Math.cos(cam.pitch), dirx = Math.sin(cam.yaw) * cp, diry = Math.sin(cam.pitch), dirz = Math.cos(cam.yaw) * cp;
  let d = cam.dist;
  for (; d > 1.2; d -= 0.25) {                           // mundurkan kamera jika tembus dinding
    const px = tx + dirx * d, py = ty + diry * d, pz = tz + dirz * d;
    if (!BOXES.some(b => py < b.h + 0.3 && px > b.x0 - 0.3 && px < b.x1 + 0.3 && pz > b.z0 - 0.3 && pz < b.z1 + 0.3)) break;
  }
  const want = new THREE.Vector3(tx + dirx * d, Math.max(0.4, ty + diry * d), tz + dirz * d);
  camera.position.lerp(want, Math.min(1, dt * 14)); camera.lookAt(tx, ty - 0.2, tz);
}

/* ---------- 5. LOOP UTAMA + HUD + LOBBY ---------- */
let me = null; const others = new Map(); let netAcc = 0, online = false;
const hudState = document.getElementById('state'), hudRole = document.getElementById('role');

function startGame(slot, isOnline) {
  online = !!isOnline;
  me = new Pawn(slot, scene, true);
  hudRole.textContent = (slot === 0 ? 'KILLER' : 'SURVIVOR ' + slot) + (online ? ' · ONLINE' : ' · LATIHAN SOLO');
  document.getElementById('ui').style.display = 'none'; document.getElementById('hud').style.display = 'block';
  const clock = new THREE.Clock(); camera.position.set(me.pos.x, 3, me.pos.z + 6);
  (function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    const inp = readInput(); let rem = dt;
    while (rem > 0) { const s = Math.min(rem, 1 / 60); me.update(s, inp, cam.yaw); rem -= s; }   // sub-step agar tidak tembus dinding
    me.animate(dt, t);
    others.forEach(p => { p.updateRemote(dt); p.animate(dt, t); });
    updateCamera(dt);
    // HUD
    hudState.textContent = me.state === 'fallen' ? `JATUH! Bangun dalam ${Math.max(0, me.stateT).toFixed(1)} dtk`
      : me.state === 'gettingUp' ? 'Berdiri...' : me.isSlippery ? 'LANTAI LICIN!' : 'Normal';
    hudState.className = me.state !== 'normal' ? 'bad' : me.isSlippery ? 'ice' : '';
    // kirim state ~10x/detik
    netAcc += dt; if (online && netAcc > 0.1) { netAcc = 0; Net.send(me.netState()); }
    renderer.render(scene, camera);
  })();
}

// Sinkron pemain lain: data = rooms/{kode}/state  ->  { uid: {x,y,z,yaw,st,...} }
function onPlayers(data) {
  Object.keys(data).forEach(id => {
    if (Net.me && id === Net.me.uid) return;
    if (!others.has(id)) {
      const slot = Net.gslot(id), p = new Pawn(slot, scene, false, Net.playerName(id));
      p.pos.set(data[id].x, data[id].y, data[id].z); others.set(id, p);
    }
    others.get(id).applyNet(data[id]);
  });
  others.forEach((p, id) => { if (!(id in data)) { scene.remove(p.pivot); others.delete(id); } });   // pemain keluar
}

// tombol keluar di HUD: tinggalkan party lalu kembali ke menu
document.getElementById('btnLeave').onclick = async () => {
  try { await Net.leaveParty(); } catch (e) { }
  location.reload();
};
