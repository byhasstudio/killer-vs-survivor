'use strict';
/* =====================================================================
   MECHANICS.JS — Mekanik "TABUNG GAS" ala game asimetris populer
   (Violence District / Dead by Daylight), dipasang di atas game.js tanpa
   mengubah game.js. Tabung gas menggantikan generator.

   ALUR PERMAINAN
   Survivor : tahan [F] di dekat tabung untuk mengisi (ada SKILL CHECK, tekan SPASI).
              Selesaikan tabung sebanyak MCFG.need -> 2 Gerbang Keluar menyala ->
              tahan [F] di gerbang sampai terbuka -> lari lewat gerbang = KABUR.
              Tahan [F] di dekat teman yang tumbang untuk membangunkannya.
              Tahan [F] di palet kayu untuk menjatuhkannya (menahan & menstun Killer).
   Killer   : Terkam (klik kiri / E) mengenai Survivor: Sehat -> Terluka -> Tumbang.
              Tahan [F] di tabung = tendang (kurangi isi), di palet jatuh = hancurkan,
              di Survivor tumbang = habisi. Tabung yang bocor terlihat sebagai aura merah.
   Menang   : Survivor menang jika ada yang kabur saat semua Survivor sudah selesai
              (kabur / gugur). Killer menang jika (hampir) semua gugur.

   SINKRON ONLINE (Firebase) : rooms/{kode}/game/...
     gas/{i}/c/{uid}  kontribusi isi tabung (tiap pemain hanya menulis miliknya)
     gas/{i}/sab      total sabotase Killer      gas/{i}/done  tabung selesai
     gas/{i}/leak     waktu kebocoran terakhir   gate/{g}/c/{uid} & gate/{g}/open
     sv/{uid}         { hp: 2 sehat | 1 terluka | 0 tumbang, out: 0 main | 1 gugur | 2 kabur }
     rev/{target}/{uid} detik membangunkan       exec/{target} perintah habisi (Killer)
     pal/{i}          0 berdiri | 1 jatuh | 2 hancur
   Semua angka bisa diatur di MCFG di bawah.
   ===================================================================== */
const MCFG = {
  gasRate: 2.2,          // % isi tabung per detik per Survivor (100% = ± 45 dtk sendirian)
  need: 4,               // jumlah tabung yang harus selesai agar gerbang menyala
  gateRate: 20,          // % per detik membuka gerbang (5 dtk sendirian)
  reach: 1.9,            // jarak interaksi ke tabung (m)
  gateReach: 2.8,
  skillMin: 3.5, skillMax: 8,        // jeda acak antar skill check (detik)
  skillFail: 12,         // % isi hilang bila skill check gagal (+ tabung bocor, Killer tahu)
  skillGood: 3, skillGreat: 5,       // bonus % isi bila berhasil / sempurna
  kickTime: 1.4, kickDamage: 35, kickCooldown: 9,   // tendangan Killer ke tabung
  execTime: 2.2,         // Killer menghabisi Survivor tumbang
  reviveTime: 4.5,       // detik total untuk membangunkan teman
  bleedOut: 70,          // detik sebelum Survivor tumbang kehabisan darah
  burstTime: 2.4, burstMul: 1.35,    // lari kencang sesaat setelah kena serangan
  crawlMul: 0.22,        // kecepatan merangkak saat tumbang
  palDropTime: 0.25, palBreakTime: 1.8, palStun: 2.2, palStunRadius: 2.6,
  leakTime: 5            // lama tanda kebocoran terlihat (detik)
};
const GAS_POS = [[-30, -16], [28, -2], [-34, 6], [-8, 18], [30, 24], [14, -15]];   // x, z
const GATE_POS = [[-34, 30], [34, -30]];
const PAL_POS = [[-18, 8, 0], [18, -8, 1], [-4, -18, 0], [24, 18, 1], [-28, -6, 1], [-14, 22, 0]];   // x, z, arah

const Mech = (() => {
  const E = id => document.getElementById(id);
  const TAU = Math.PI * 2;

  /* ---------- STATE ---------- */
  let active = false, started = false, online = false, killerRole = false, myId = 'solo';
  let gateNoted = false, roster = [], ended = false, G = {}, gdb = null, flushT = 0, rosterSig = '';
  const mine = new Map(), pend = new Map();           // data milikku (diterapkan ulang setelah snapshot) & antrean tulis
  let hp = 2, out = 0, burstT = 0, bleedT = 0, revBase = 0, speedMulV = 1, execSeen = 0;
  let acting = null, holdT = 0, stunT = 0, flashT = 0;
  let fHeld = false, touchAct = false, scPressed = false, sc = null, scTimer = 5;
  const kdown = {}, kickCd = [], prevHp = {}, revSeen = {}, leakSeen = [], leakUntil = [], palSeen = [], palApplied = [], doneSeen = [];
  const pawnIds = new Map(), W = { gas: [], gate: [], pal: [] };
  const gateColl = [], palColl = [];

  /* ---------- util data ---------- */
  function setPath(o, path, val) {
    const k = path.split('/'); let c = o;
    for (let i = 0; i < k.length - 1; i++) { if (c[k[i]] == null || typeof c[k[i]] !== 'object') c[k[i]] = {}; c = c[k[i]]; }
    c[k[k.length - 1]] = val;
  }
  function gget(path, d) {
    let o = G;
    for (const k of path.split('/')) { if (o == null || typeof o !== 'object') return d; o = o[k]; }
    return o == null ? d : o;
  }
  const sumObj = o => { let s = 0; if (o && typeof o === 'object') for (const k in o) s += +o[k] || 0; return s; };
  function put(path, val, flush) {
    mine.set(path, val); setPath(G, path, val);
    if (online) { pend.set(path, val); if (flush) flushNow(); }
  }
  function flushNow() {
    if (!online || !gdb || !pend.size) return;
    const u = {}; pend.forEach((v, k) => u[k] = v); pend.clear();
    gdb.update(u).catch(() => { });
  }
  function onGame(data) {
    G = data || {};
    mine.forEach((v, k) => setPath(G, k, v));         // data milikku selalu menang atas snapshot lama
  }

  const gasDone = i => !!gget('gas/' + i + '/done', false);
  const gasFill = i => gasDone(i) ? 100 : clamp(sumObj(gget('gas/' + i + '/c', {})) - (+gget('gas/' + i + '/sab', 0) || 0), 0, 100);
  const gasCount = () => { let n = 0; for (let i = 0; i < GAS_POS.length; i++) if (gasFill(i) >= 100) n++; return n; };
  const powered = () => gasCount() >= MCFG.need;
  const gateOpen = g => !!gget('gate/' + g + '/open', false);
  const gateFill = g => gateOpen(g) ? 100 : clamp(sumObj(gget('gate/' + g + '/c', {})), 0, 100);
  const palState = i => +gget('pal/' + i, 0) || 0;
  const svOf = id => { const s = gget('sv/' + id, null); return { hp: s && s.hp != null ? +s.hp : 2, out: s && s.out != null ? +s.out : 0 }; };
  const nameOf = id => id === myId ? 'kamu' : ((online && Net.playerName(id)) || 'pemain');
  const pushSv = () => put('sv/' + myId, { hp, out }, true);

  /* ---------- SUARA (WebAudio sintetis, tanpa file) ---------- */
  const SFX = (() => {
    let ac = null, hg = null;
    const ctx = () => {
      if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
      if (ac.state === 'suspended') ac.resume().catch(() => { });
      return ac;
    };
    const tone = (f1, f2, d, type, v) => {
      const a = ctx(); if (!a) return; const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
      o.type = type || 'sine'; o.frequency.setValueAtTime(f1, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(v || .15, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + .03);
    };
    const noiseBuf = a => { const b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
    return {
      init: ctx,
      ding: () => { tone(880, 0, .25, 'sine', .18); setTimeout(() => tone(1320, 0, .35, 'sine', .15), 90); },
      great: () => { tone(1040, 0, .2, 'triangle', .2); setTimeout(() => tone(1560, 0, .3, 'triangle', .18), 70); },
      fail: () => { tone(220, 90, .5, 'sawtooth', .22); },
      hit: () => { tone(140, 40, .35, 'square', .3); },
      alarm: () => { tone(660, 0, .18, 'square', .12); setTimeout(() => tone(660, 0, .18, 'square', .12), 220); setTimeout(() => tone(880, 0, .3, 'square', .12), 440); },
      tick: () => tone(1800, 0, .05, 'square', .07),
      hiss(on) {
        const a = ctx(); if (!a) return;
        if (!hg) {
          const src = a.createBufferSource(); src.buffer = noiseBuf(a); src.loop = true;
          const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = .6;
          hg = a.createGain(); hg.gain.value = 0; src.connect(f); f.connect(hg); hg.connect(a.destination); src.start();
        }
        hg.gain.setTargetAtTime(on ? .05 : 0, a.currentTime, .06);
      }
    };
  })();

  /* ---------- TEKSTUR PROSEDURAL ---------- */
  function ctex(w, h, draw, rep) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  const glowTex = (a, b) => ctex(64, 64, g => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const TX = {};
  function makeTextures() {
    TX.tank = ctex(256, 256, (g, w, h) => {              // cat merah terkelupas, label putih, karat di bawah
      g.fillStyle = '#a32d1f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { g.globalAlpha = .05 + Math.random() * .11; g.fillStyle = Math.random() < .5 ? '#2a0a06' : '#e07a5a'; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 7); }
      g.globalAlpha = 1; g.fillStyle = '#e9e4d6'; g.fillRect(0, h * .36, w, h * .24);
      g.fillStyle = '#15110e'; g.font = '700 40px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('GAS LPG', w * .25, h * .45); g.fillText('GAS LPG', w * .75, h * .45);
      g.font = '700 16px system-ui, sans-serif'; g.fillText('! MUDAH TERBAKAR !', w * .25, h * .55); g.fillText('! MUDAH TERBAKAR !', w * .75, h * .55);
      g.strokeStyle = 'rgba(20,12,8,.55)'; g.lineWidth = 1;
      for (let i = 0; i < 28; i++) { g.globalAlpha = .3 + Math.random() * .4; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 40, y + (Math.random() - .5) * 14); g.stroke(); }
      g.globalAlpha = 1;
      const rg = g.createLinearGradient(0, h * .72, 0, h); rg.addColorStop(0, 'rgba(70,35,12,0)'); rg.addColorStop(1, 'rgba(50,28,12,.7)'); g.fillStyle = rg; g.fillRect(0, h * .72, w, h * .28);
    });
    TX.decal = ctex(256, 256, (g, w, h) => {              // lingkaran garis bahaya di lantai
      g.clearRect(0, 0, w, h); g.translate(w / 2, h / 2);
      const rg = g.createRadialGradient(0, 0, 40, 0, 0, 126); rg.addColorStop(0, 'rgba(8,6,4,.75)'); rg.addColorStop(1, 'rgba(8,6,4,0)'); g.fillStyle = rg; g.fillRect(-128, -128, 256, 256);
      for (let i = 0; i < 24; i++) {
        const a0 = i * Math.PI / 12, a1 = (i + 1) * Math.PI / 12;
        g.beginPath(); g.arc(0, 0, 118, a0, a1); g.arc(0, 0, 100, a1, a0, true); g.closePath(); g.fillStyle = i % 2 ? '#141210' : '#d9a90d'; g.globalAlpha = .85; g.fill();
      }
    });
    TX.metal = ctex(128, 128, (g, w, h) => {
      g.fillStyle = '#3a3f46'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1200; i++) { g.globalAlpha = .08 + Math.random() * .14; g.fillStyle = Math.random() < .5 ? '#14171b' : '#7c828b'; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 5); }
      g.globalAlpha = .5; g.fillStyle = '#6b3b1c'; for (let i = 0; i < 30; i++) g.fillRect(Math.random() * w, h * (.55 + Math.random() * .45), 2 + Math.random() * 6, 2 + Math.random() * 8);
    }, true);
    TX.wood = ctex(128, 128, (g, w, h) => {
      for (let i = 0; i < 4; i++) { g.fillStyle = 'hsl(' + (26 + Math.random() * 6) + ',34%,' + (24 + Math.random() * 10) + '%)'; g.fillRect(i * 32, 0, 32, h); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(i * 32, 0, 2, h); }
      for (let i = 0; i < 70; i++) { g.strokeStyle = 'rgba(20,10,0,' + (.1 + Math.random() * .2) + ')'; const x = Math.random() * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - .5) * 6, h); g.stroke(); }
    }, true);
    TX.glow = glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  }

  /* ---------- DUNIA: tabung gas, gerbang, palet ---------- */
  const cRed = new THREE.Color(0xff3b2e), cAmb = new THREE.Color(0xffb020), cGrn = new THREE.Color(0x3dff8a), cTmp = new THREE.Color();
  const progColor = f => f < 50 ? cTmp.copy(cRed).lerp(cAmb, f / 50) : cTmp.copy(cAmb).lerp(cGrn, (f - 50) / 50);

  function buildGas(i, x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.random() * TAU;
    const prof = [[0, 0], [.28, 0], [.34, .03], [.37, .09], [.38, .2], [.38, 1.1], [.37, 1.24], [.33, 1.36], [.25, 1.44], [.15, 1.49], [.1, 1.5], [0, 1.5]].map(p => new THREE.Vector2(p[0], p[1]));
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ map: TX.tank, roughness: .55, metalness: .45 }));
    body.castShadow = body.receiveShadow = true; g.add(body);
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: .4, metalness: .85 });
    const foot = new THREE.Mesh(new THREE.TorusGeometry(.31, .04, 8, 22), steel); foot.rotation.x = Math.PI / 2; foot.position.y = .05; g.add(foot);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.24, .028, 8, 18), steel); collar.rotation.x = Math.PI / 2; collar.position.y = 1.5; g.add(collar);
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3, p = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .22, 6), steel); p.position.set(Math.cos(a) * .24, 1.4, Math.sin(a) * .24); g.add(p); }
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, .16, 12), steel); valve.position.y = 1.58; g.add(valve);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(.09, .015, 6, 14), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: .6, roughness: .4 })); wheel.rotation.x = Math.PI / 2; wheel.position.y = 1.7; g.add(wheel);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.388, .388, .07, 28), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3b2e, emissiveIntensity: .7, roughness: .5 }));
    band.position.y = .22; g.add(band);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: TX.decal, transparent: true, depthWrite: false, fog: true }));
    decal.rotation.x = -Math.PI / 2; decal.position.set(x, .05, z);
    const gauge = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: 0xff3b2e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    gauge.scale.set(1.1, 1.1, 1); gauge.position.set(0, 1.75, 0); g.add(gauge);
    const lc = document.createElement('canvas'); lc.width = 128; lc.height = 24;
    const lt = new THREE.CanvasTexture(lc), label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false }));
    label.scale.set(1.6, .3, 1); label.position.set(0, 2.2, 0); g.add(label);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 34, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x44ff99, transparent: true, opacity: .32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.set(x, 17, z); beam.visible = false;
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: 0xff2a2a, transparent: true, opacity: .8, depthTest: false, depthWrite: false, fog: false }));
    aura.renderOrder = 999; aura.position.set(0, .8, 0); aura.scale.set(2.6, 2.6, 1); aura.visible = false; g.add(aura);
    const puffs = [];
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: 0xdfe8ea, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      s.userData = { ph: k / 6 }; s.visible = false; g.add(s); puffs.push(s);
    }
    scene.add(g, decal, beam);
    addBox(x, z, .9, .9, 1.5, 0x444444, null);                  // tabung jadi penghalang padat
    W.gas[i] = { g, band, gauge, label, lc, lt, beam, aura, puffs, lastPct: -1 };
    drawLabel(W.gas[i], 0, false);
  }
  function drawLabel(o, pct, done) {
    const c = o.lc.getContext('2d'); c.clearRect(0, 0, 128, 24);
    c.fillStyle = 'rgba(10,10,12,.78)'; c.fillRect(0, 5, 128, 14);
    c.fillStyle = done ? '#3dff8a' : '#ffb020'; c.fillRect(2, 7, 124 * pct / 100, 10);
    o.lt.needsUpdate = true; o.lastPct = pct;
  }

  function buildGate(gi, x, z) {
    const steel = new THREE.MeshStandardMaterial({ map: TX.metal, roughness: .6, metalness: .6 });
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    [-2.1, 2.1].forEach(px => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(.9, 5.2, .9), steel); p.position.set(px, 2.6, 0); p.castShadow = true; g.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.2, .3, 1.2), steel); cap.position.set(px, 5.3, 0); g.add(cap);
      addBox(x + px, z, .9, .9, 5.2, 0x444444, null);
    });
    const top = new THREE.Mesh(new THREE.BoxGeometry(5.4, .5, .8), steel); top.position.set(0, 5.3, 0); g.add(top);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b2e });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 10), lampMat); lamp.position.set(0, 5.8, 0); g.add(lamp);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: 0xff3b2e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.set(5, 5, 1); glow.position.set(0, 5.8, 0); g.add(glow);
    const door = new THREE.Group(); g.add(door);
    for (let k = 0; k < 8; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.12, 4.4, .12), steel); b.position.set(-1.5 + k * (3 / 7), 2.2, 0); door.add(b); }
    [.6, 2.2, 3.9].forEach(y => { const r = new THREE.Mesh(new THREE.BoxGeometry(3.3, .14, .14), steel); r.position.set(0, y, 0); door.add(r); });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.2, .5), steel); panel.position.set(-2.1, .6, 1.0); g.add(panel);
    const panelLamp = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .05), lampMat); panelLamp.position.set(-2.1, 1.1, 1.26); g.add(panelLamp);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.4, 1.7, 32), new THREE.MeshBasicMaterial({ color: 0x3dff8a, transparent: true, opacity: .0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, .06, 0); g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x44ff99, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.set(0, 20, 0); beam.visible = false; g.add(beam);
    const lc = document.createElement('canvas'); lc.width = 128; lc.height = 24;
    const lt = new THREE.CanvasTexture(lc), label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false }));
    label.scale.set(2.4, .45, 1); label.position.set(0, 6.8, 0); g.add(label);
    gateColl[gi] = (addBox(x, z, 3.2, .4, 4.5, 0x444444, null), BOXES[BOXES.length - 1]);   // pintu terkunci = dinding tak terlihat
    W.gate[gi] = { g, door, lampMat, glow, ring, beam, lc, lt, lastPct: -1, x, z };
  }

  function buildPal(i, x, z, o) {
    const wood = new THREE.MeshStandardMaterial({ map: TX.wood, roughness: .95 });
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = o ? Math.PI / 2 : 0; scene.add(g);
    [-1.3, 1.3].forEach(px => { const p = new THREE.Mesh(new THREE.BoxGeometry(.14, 1.6, .14), wood); p.position.set(px, .8, -.12); p.castShadow = true; g.add(p); });
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, .14, .14), wood); top.position.set(0, 1.6, -.12); g.add(top);
    const hinge = new THREE.Group(); hinge.position.set(0, .05, .1); g.add(hinge);
    for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.5, .26, .07), wood); b.position.set(0, .15 + k * .3, 0); b.castShadow = true; hinge.add(b); }
    hinge.rotation.x = -.38;
    W.pal[i] = { g, hinge, ang: -.38, x, z, o };
  }

  function buildWorld() {
    makeTextures();
    GAS_POS.forEach((p, i) => buildGas(i, p[0], p[1]));
    GATE_POS.forEach((p, i) => buildGate(i, p[0], p[1]));
    PAL_POS.forEach((p, i) => buildPal(i, p[0], p[1], p[2]));
  }

  /* ---------- HUD ---------- */
  function buildHUD() {
    const css = document.createElement('style');
    css.textContent = `
    #mx{position:fixed;inset:0;z-index:4;pointer-events:none;font-family:system-ui,sans-serif;color:#f5f5f7;text-shadow:0 2px 4px #000}
    #mxObj{position:absolute;top:10px;left:50%;transform:translateX(-50%);text-align:center}
    #mxObjT{font:400 22px Impact,sans-serif;letter-spacing:.1em}
    #mxCells{display:flex;gap:5px;justify-content:center;margin:5px 0}
    #mxCells i{display:block;width:40px;height:9px;background:rgba(0,0,0,.55);border:1px solid #2c2c33;position:relative}
    #mxCells b{position:absolute;left:0;top:0;bottom:0;width:0;background:#ffb020}
    #mxGateT{font:700 12px system-ui;letter-spacing:.08em;color:#ffb4ba}
    #mxRoster{position:absolute;top:10px;right:12px;display:grid;gap:5px;min-width:150px}
    .mxR{display:flex;justify-content:space-between;gap:10px;background:rgba(10,10,12,.7);border-left:4px solid #f5f5f7;padding:4px 9px;font:700 12px system-ui}
    .mxR.hurt{border-left-color:#ffb020}.mxR.down{border-left-color:#e11d2e}.mxR.esc{border-left-color:#3dff8a}.mxR.dead{border-left-color:#555;opacity:.6}
    #mxPrompt{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);text-align:center;display:none;font:700 14px system-ui}
    #mxBar{width:200px;height:8px;margin:6px auto 0;background:rgba(0,0,0,.6);border:1px solid #444}
    #mxBar i{display:block;height:100%;width:0;background:#f5f5f7}
    #mxSC{position:absolute;left:50%;top:50%;width:160px;height:160px;margin:-80px 0 0 -80px;display:none;pointer-events:auto;filter:drop-shadow(0 0 12px #000)}
    #mxFeed{position:absolute;top:96px;left:50%;transform:translateX(-50%);display:grid;gap:4px;justify-items:center}
    .mxN{background:rgba(10,10,12,.78);border-left:4px solid #e11d2e;padding:5px 12px;font:700 13px system-ui;animation:mxIn .2s ease-out}
    .mxN.good{border-left-color:#3dff8a}
    @keyframes mxIn{from{opacity:0;transform:translateY(-8px)}}
    #mxHurt{position:absolute;inset:0;transition:box-shadow .4s}
    #mxFlash{position:absolute;inset:0;background:#e11d2e;opacity:0;transition:opacity .35s}
    #mxEnd{position:absolute;inset:0;background:rgba(0,0,0,.78);display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:auto;text-align:center}
    #mxEnd h1{margin:0;font:400 clamp(40px,10vw,80px) Impact,sans-serif;letter-spacing:.06em}
    #mxEnd p{margin:0;color:#c8c8d0;font:600 16px system-ui}
    .act.aksi{background:rgba(245,245,247,.85);color:#111}`;
    document.head.appendChild(css);
    const d = document.createElement('div'); d.id = 'mx';
    d.innerHTML = '<div id="mxHurt"></div><div id="mxFlash"></div>' +
      '<div id="mxObj"><div id="mxObjT"></div><div id="mxCells"></div><div id="mxGateT"></div></div>' +
      '<div id="mxRoster"></div><div id="mxFeed"></div>' +
      '<div id="mxPrompt"><span id="mxPromptT"></span><div id="mxBar"><i></i></div></div>' +
      '<canvas id="mxSC" width="160" height="160"></canvas>' +
      '<div id="mxEnd"><h1 id="mxEndT"></h1><p id="mxEndS"></p></div>';
    document.body.appendChild(d);
    const cells = E('mxCells'); for (let i = 0; i < GAS_POS.length; i++) cells.insertAdjacentHTML('beforeend', '<i><b></b></i>');
    const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'Keluar ke menu';
    btn.onclick = () => E('btnLeave').click(); E('mxEnd').appendChild(btn);
    E('mxSC').addEventListener('pointerdown', e => { e.preventDefault(); scPressed = true; });
    if ('ontouchstart' in window) {
      const b = document.createElement('button'); b.className = 'act aksi'; b.id = 'bAct'; b.textContent = 'Aksi';
      b.style.bottom = '244px'; b.style.right = '24px'; E('touch').appendChild(b);
      b.addEventListener('touchstart', e => { e.preventDefault(); touchAct = true; SFX.init(); });
      b.addEventListener('touchend', () => touchAct = false); b.addEventListener('touchcancel', () => touchAct = false);
    }
  }
  function note(msg, good) {
    const f = E('mxFeed'); if (!f) return;
    const n = document.createElement('div'); n.className = 'mxN' + (good ? ' good' : ''); n.textContent = msg; f.appendChild(n);
    while (f.children.length > 4) f.firstChild.remove();
    setTimeout(() => n.remove(), 4200);
  }
  function drawSC() {
    const c = E('mxSC'), g = c.getContext('2d'); g.clearRect(0, 0, 160, 160);
    if (!sc) { c.style.display = 'none'; return; }
    c.style.display = 'block';
    const cx = 80, cy = 80, r = 56, o = -Math.PI / 2;
    g.lineWidth = 14; g.strokeStyle = 'rgba(10,10,12,.8)'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    g.strokeStyle = '#f5f5f7'; g.beginPath(); g.arc(cx, cy, r, o + sc.zs, o + sc.zs + sc.zl); g.stroke();
    g.strokeStyle = '#e11d2e'; g.beginPath(); g.arc(cx, cy, r, o + sc.zs, o + sc.zs + .22); g.stroke();
    g.lineWidth = 4; g.strokeStyle = '#ffd24a'; g.beginPath(); g.moveTo(cx + Math.cos(o + sc.a) * (r - 12), cy + Math.sin(o + sc.a) * (r - 12)); g.lineTo(cx + Math.cos(o + sc.a) * (r + 12), cy + Math.sin(o + sc.a) * (r + 12)); g.stroke();
    g.fillStyle = '#f5f5f7'; g.font = '700 13px system-ui'; g.textAlign = 'center'; g.fillText('SPASI', cx, cy + 5);
  }

  /* ---------- INTERAKSI ---------- */
  function pickTarget() {
    const p = me.pos; let best = null, bd = 1e9;
    const consider = (kind, i, x, z, reach, label) => { const d = Math.hypot(p.x - x, p.z - z); if (d < reach && d < bd) { bd = d; best = { kind, i, x, z, label }; } };
    const now = performance.now();
    if (!killerRole) {
      for (let i = 0; i < GAS_POS.length; i++) if (gasFill(i) < 100) consider('gas', i, GAS_POS[i][0], GAS_POS[i][1], MCFG.reach, 'Isi tabung gas');
      if (powered()) for (let g = 0; g < GATE_POS.length; g++) if (!gateOpen(g)) consider('gate', g, GATE_POS[g][0], GATE_POS[g][1], MCFG.gateReach, 'Buka gerbang');
      others.forEach((o, id) => { if (o.role === 'survivor') { const s = svOf(id); if (s.hp === 0 && s.out === 0) consider('rev', id, o.pos.x, o.pos.z, 1.8, 'Bangunkan @' + nameOf(id)); } });
      for (let i = 0; i < PAL_POS.length; i++) if (palState(i) === 0) consider('pal', i, PAL_POS[i][0], PAL_POS[i][1], 1.5, 'Jatuhkan palet');
    } else {
      for (let i = 0; i < GAS_POS.length; i++) if (gasFill(i) < 100 && gasFill(i) > 4 && now > (kickCd[i] || 0)) consider('kick', i, GAS_POS[i][0], GAS_POS[i][1], MCFG.reach, 'Tendang tabung');
      others.forEach((o, id) => { if (o.role === 'survivor') { const s = svOf(id); if (s.hp === 0 && s.out === 0) consider('exec', id, o.pos.x, o.pos.z, 1.8, 'Habisi @' + nameOf(id)); } });
      for (let i = 0; i < PAL_POS.length; i++) if (palState(i) === 1) consider('break', i, PAL_POS[i][0], PAL_POS[i][1], 1.8, 'Hancurkan palet');
    }
    return best;
  }

  function startSC() { sc = { a: 0, zs: 1.3 + Math.random() * 3.9, zl: .75, sp: 4.4 + Math.random() * 1.1 }; SFX.tick(); }
  function updateSC(dt, i) {
    sc.a += sc.sp * dt;
    const c = +gget('gas/' + i + '/c/' + myId, 0) || 0;
    if (scPressed || sc.a > TAU) {
      const hit = scPressed && sc.a >= sc.zs && sc.a <= sc.zs + sc.zl, great = hit && sc.a <= sc.zs + .22;
      if (hit) {
        put('gas/' + i + '/c/' + myId, Math.min(100, c + (great ? MCFG.skillGreat : MCFG.skillGood)));
        great ? SFX.great() : SFX.ding(); if (great) note('SKILL CHECK SEMPURNA!', true);
      } else {
        put('gas/' + i + '/c/' + myId, Math.max(0, c - MCFG.skillFail));
        const v = Date.now(); leakSeen[i] = v; put('gas/' + i + '/leak', v, true); leakUntil[i] = performance.now() + MCFG.leakTime * 1000;
        SFX.fail(); flashT = .35; note('Skill check gagal! Tabung bocor — Killer bisa mendengar!');
      }
      sc = null; scPressed = false; scTimer = MCFG.skillMin + Math.random() * (MCFG.skillMax - MCFG.skillMin);
    }
  }

  function act(tg, dt) {
    if (!acting || acting.kind !== tg.kind || acting.i !== tg.i) { holdT = 0; sc = null; scPressed = false; }
    acting = tg;
    const want = Math.atan2(tg.x - me.pos.x, tg.z - me.pos.z);
    me.yaw += angDiff(me.yaw, want) * Math.min(1, dt * 10);
    let prog = 0;
    if (tg.kind === 'gas') {
      const i = tg.i, cur = +gget('gas/' + i + '/c/' + myId, 0) || 0;
      put('gas/' + i + '/c/' + myId, Math.min(100, cur + MCFG.gasRate * dt));
      if (gasFill(i) >= 100 && !gasDone(i)) put('gas/' + i + '/done', true, true);
      if (!sc) { scTimer -= dt; if (scTimer <= 0) startSC(); } else updateSC(dt, i);
      prog = gasFill(i);
    } else if (tg.kind === 'gate') {
      const g = tg.i, cur = +gget('gate/' + g + '/c/' + myId, 0) || 0;
      put('gate/' + g + '/c/' + myId, Math.min(100, cur + MCFG.gateRate * dt));
      if (gateFill(g) >= 100 && !gateOpen(g)) put('gate/' + g + '/open', true, true);
      prog = gateFill(g);
    } else if (tg.kind === 'rev') {
      const cur = +gget('rev/' + tg.i + '/' + myId, 0) || 0;
      put('rev/' + tg.i + '/' + myId, cur + dt);
      prog = clamp((sumObj(gget('rev/' + tg.i, {})) - (revSeen[tg.i] || 0)) / MCFG.reviveTime * 100, 0, 100);
    } else {
      holdT += dt;
      const need = tg.kind === 'pal' ? MCFG.palDropTime : tg.kind === 'break' ? MCFG.palBreakTime : tg.kind === 'kick' ? MCFG.kickTime : MCFG.execTime;
      prog = clamp(holdT / need * 100, 0, 100);
      if (holdT >= need) {
        holdT = 0;
        if (tg.kind === 'pal') { put('pal/' + tg.i, 1, true); SFX.hit(); }
        else if (tg.kind === 'break') { put('pal/' + tg.i, 2, true); SFX.hit(); note('Palet dihancurkan'); }
        else if (tg.kind === 'kick') {
          const sum = sumObj(gget('gas/' + tg.i + '/c', {})), sab = +gget('gas/' + tg.i + '/sab', 0) || 0;
          const v = Date.now(); leakSeen[tg.i] = v; leakUntil[tg.i] = performance.now() + MCFG.leakTime * 1000;
          put('gas/' + tg.i + '/sab', Math.min(sum, sab + MCFG.kickDamage), true); put('gas/' + tg.i + '/leak', v, true);
          kickCd[tg.i] = performance.now() + MCFG.kickCooldown * 1000; SFX.fail(); note('Tabung ditendang!');
        } else if (tg.kind === 'exec') { put('exec/' + tg.i, Date.now(), true); SFX.hit(); note('Survivor dihabisi'); }
        acting = null;
      }
    }
    return prog;
  }
  function stopAct() { acting = null; holdT = 0; sc = null; scPressed = false; }

  /* ---------- LOGIKA PER FRAME ---------- */
  function die(msg) { out = 1; hp = 0; pushSv(); note(msg); SFX.fail(); }

  function trackOthers() {
    others.forEach((o, id) => {
      if (o.role !== 'survivor') return;
      const s = svOf(id), was = prevHp[id];
      if (was !== undefined && s.hp < was) {
        if (killerRole) { note('Serangan mengenai @' + nameOf(id) + (s.hp === 0 ? ' — TUMBANG' : ''), true); SFX.hit(); }
        else if (s.hp === 0) note('@' + nameOf(id) + ' tumbang! Bangunkan dia.');
      }
      if (s.hp === 0 && was !== 0) revSeen[id] = sumObj(gget('rev/' + id, {}));
      if (s.out === 2 && prevHp[id + ':o'] !== 2) note('@' + nameOf(id) + ' berhasil kabur!', !killerRole);
      prevHp[id] = s.hp; prevHp[id + ':o'] = s.out;
    });
  }

  function syncWorld(now, t) {
    // tabung
    for (let i = 0; i < GAS_POS.length; i++) {
      const o = W.gas[i], f = gasFill(i), done = f >= 100, pc = Math.round(f);
      if (pc !== o.lastPct) drawLabel(o, pc, done);
      progColor(f); o.band.material.emissive.copy(cTmp); o.band.material.emissiveIntensity = .55 + .35 * Math.sin(t * 4 + i);
      o.gauge.material.color.copy(cTmp); o.gauge.scale.setScalar(.9 + .25 * Math.sin(t * 5 + i));
      o.beam.visible = done;
      if (done && !doneSeen[i]) { doneSeen[i] = true; const n = gasCount(); note('Tabung #' + (i + 1) + ' selesai (' + Math.min(n, MCFG.need) + '/' + MCFG.need + ')', true); SFX.ding(); if (n >= MCFG.need && !gateNoted) { gateNoted = true; note('GERBANG KELUAR MENYALA! Cari gerbang & buka.', true); SFX.alarm(); } }
      const lv = +gget('gas/' + i + '/leak', 0) || 0;
      if (lv && lv !== leakSeen[i]) { leakSeen[i] = lv; leakUntil[i] = now + MCFG.leakTime * 1000; if (killerRole) { note('Kebocoran gas di tabung #' + (i + 1) + '!'); SFX.alarm(); } }
      const leaking = leakUntil[i] > now && !done;
      o.aura.visible = killerRole && !done && (f > 0 || leaking);
      if (o.aura.visible) { o.aura.material.color.setHex(leaking ? 0xff2a2a : 0xff9a3a); o.aura.scale.setScalar(2.2 + (leaking ? .8 * Math.abs(Math.sin(t * 8)) : .3)); }
      o.puffs.forEach(s => {
        if (!leaking) { s.visible = false; return; }
        s.visible = true; const ph = (t * .7 + s.userData.ph) % 1;
        s.position.set(Math.sin(ph * 9 + s.userData.ph * 20) * .35, 1.6 + ph * 1.8, Math.cos(ph * 7 + s.userData.ph * 20) * .35);
        s.scale.setScalar(.5 + ph * 1.2); s.material.opacity = (1 - ph) * .45;
      });
    }
    // gerbang
    const pw = powered();
    for (let g = 0; g < GATE_POS.length; g++) {
      const o = W.gate[g], open = gateOpen(g), f = gateFill(g);
      const col = open ? 0x3dff8a : pw ? 0xffb020 : 0xff3b2e;
      o.lampMat.color.setHex(col); o.glow.material.color.setHex(col); o.glow.scale.setScalar(4.5 + (pw ? Math.sin(t * 6) * .8 : 0));
      o.door.position.y = lerp(o.door.position.y, open ? 4.8 : 0, .12);
      if (open) gateColl[g].h = 0;
      o.ring.material.opacity = open ? .5 + .2 * Math.sin(t * 3) : 0; o.beam.visible = open;
      const pc = Math.round(open ? 100 : pw ? f : 0);
      if (pc !== o.lastPct) { const c = o.lc.getContext('2d'); c.clearRect(0, 0, 128, 24); if (pw || open) { c.fillStyle = 'rgba(10,10,12,.78)'; c.fillRect(0, 5, 128, 14); c.fillStyle = open ? '#3dff8a' : '#ffb020'; c.fillRect(2, 7, 124 * pc / 100, 10); } o.lt.needsUpdate = true; o.lastPct = pc; }
    }
    // palet
    for (let i = 0; i < PAL_POS.length; i++) {
      const o = W.pal[i], st = palState(i);
      if (st === 1 && !palApplied[i]) {
        palApplied[i] = 1; const p = PAL_POS[i];
        addBox(p[0], p[1], p[2] ? .6 : 2.8, p[2] ? 2.8 : .6, 1.15, 0x444444, null); palColl[i] = BOXES[BOXES.length - 1];
        if (killerRole && me && Math.hypot(me.pos.x - p[0], me.pos.z - p[1]) < MCFG.palStunRadius) { stunT = MCFG.palStun; SFX.hit(); note('Kamu terkena palet! Stun ' + MCFG.palStun + ' dtk'); }
      }
      if (st === 2 && palApplied[i] !== 2) { palApplied[i] = 2; if (palColl[i]) palColl[i].h = 0; o.g.visible = false; }
      o.ang = lerp(o.ang, st === 1 ? 1.2 : -.38, .16); o.hinge.rotation.x = o.ang;
    }
  }

  function roleLogic(dt, t) {
    let prompt = '', prog = -1;
    if (!killerRole) {
      if (out) { stopAct(); speedMulV = 0; }
      else {
        if (hp === 0) {
          bleedT -= dt;
          if (sumObj(gget('rev/' + myId, {})) - revBase >= MCFG.reviveTime) { hp = 1; burstT = MCFG.burstTime; pushSv(); note('Kamu dibangunkan! Lari!', true); SFX.ding(); }
          else if ((+gget('exec/' + myId, 0) || 0) > execSeen) die('Kamu dihabisi Killer');
          else if (bleedT <= 0) die('Kamu kehabisan darah');
        }
        burstT = Math.max(0, burstT - dt);
        speedMulV = hp === 0 ? MCFG.crawlMul : burstT > 0 ? MCFG.burstMul : 1;
        if (!out && hp > 0) for (let g = 0; g < GATE_POS.length; g++) {
          if (gateOpen(g) && Math.hypot(me.pos.x - GATE_POS[g][0], me.pos.z - GATE_POS[g][1]) < 1.7) { out = 2; pushSv(); stopAct(); note('KAMU BERHASIL KABUR!', true); SFX.great(); }
        }
      }
    } else { stunT = Math.max(0, stunT - dt); speedMulV = stunT > 0 ? 0 : 1; }

    const can = !out && me.state === 'normal' && (killerRole ? stunT <= 0 && !me.lungeActive : hp > 0);
    const held = fHeld || touchAct;
    const tg = can ? pickTarget() : null;
    if (tg) {
      const key = 'ontouchstart' in window ? 'Tahan AKSI' : 'Tahan [F]';
      prompt = key + ' — ' + tg.label;
      if (held) prog = act(tg, dt); else { stopAct(); }
    } else stopAct();
    SFX.hiss(!!acting && acting.kind === 'gas');
    if (killerRole && stunT > 0) prompt = 'TERSTUN ' + stunT.toFixed(1) + ' dtk';
    if (!killerRole && hp === 0 && !out) prompt = 'TUMBANG — merangkak, minta teman membangunkan (' + Math.max(0, bleedT).toFixed(0) + ' dtk)';
    if (!killerRole && out === 2) prompt = 'Kamu sudah kabur — tunggu hasil akhir';
    if (!killerRole && out === 1) prompt = 'Kamu gugur — tunggu hasil akhir';
    const pr = E('mxPrompt');
    pr.style.display = prompt ? 'block' : 'none'; E('mxPromptT').textContent = prompt;
    E('mxBar').style.display = prog >= 0 ? 'block' : 'none';
    if (prog >= 0) E('mxBar').firstChild.style.width = prog + '%';
  }

  function updateHUD(now) {
    const n = gasCount(), pw = powered(), cells = E('mxCells').children;
    E('mxObjT').textContent = 'TABUNG GAS ' + Math.min(n, MCFG.need) + ' / ' + MCFG.need;
    for (let i = 0; i < cells.length; i++) { const f = gasFill(i); cells[i].firstChild.style.width = f + '%'; cells[i].firstChild.style.background = f >= 100 ? '#3dff8a' : '#ffb020'; }
    let any = false; for (let g = 0; g < GATE_POS.length; g++) if (gateOpen(g)) any = true;
    E('mxGateT').textContent = any ? 'GERBANG TERBUKA — KABUR!' : pw ? 'GERBANG AKTIF — tahan [F] untuk membuka' : 'Gerbang terkunci';
    E('mxGateT').style.color = any ? '#3dff8a' : pw ? '#ffd24a' : '#ffb4ba';
    // daftar survivor
    let sig = '', rows = [];
    roster.forEach(id => {
      const s = svOf(id), gone = online && !Net.party.players[id], st = gone ? 'GUGUR' : s.out === 2 ? 'KABUR' : s.out === 1 ? 'GUGUR' : s.hp === 0 ? 'TUMBANG' : s.hp === 1 ? 'TERLUKA' : 'SEHAT';
      const cls = st === 'KABUR' ? 'esc' : st === 'GUGUR' ? 'dead' : st === 'TUMBANG' ? 'down' : st === 'TERLUKA' ? 'hurt' : '';
      sig += id + st; rows.push([id === myId ? 'Kamu' : '@' + nameOf(id), st, cls]);
    });
    if (sig !== rosterSig) {
      rosterSig = sig; const r = E('mxRoster'); r.replaceChildren();
      rows.forEach(x => { const d = document.createElement('div'); d.className = 'mxR ' + x[2]; d.innerHTML = '<span></span><span></span>'; d.children[0].textContent = x[0]; d.children[1].textContent = x[1]; r.appendChild(d); });
    }
    // efek luka & kilatan
    const hurt = !killerRole && (hp === 0 && !out ? .55 : hp === 1 ? .22 : 0);
    E('mxHurt').style.boxShadow = hurt ? 'inset 0 0 ' + (110 + 40 * Math.sin(now / 250)) + 'px rgba(225,29,46,' + hurt + ')' : 'none';
    E('mxFlash').style.opacity = flashT > 0 ? .35 : 0;
    drawSC();
  }

  function checkEnd() {
    if (ended || !roster.length) return;
    let inGame = 0, esc = 0;
    roster.forEach(id => { const gone = online && !Net.party.players[id], s = svOf(id); if (gone) return; if (s.out === 0) inGame++; else if (s.out === 2) esc++; });
    if (inGame > 0) return;
    ended = true;
    const mineOut = out, total = roster.length, killerWin = esc < Math.ceil(total / 2);
    let title, sub;
    if (killerRole) { title = killerWin ? 'KILLER MENANG' : 'KILLER KALAH'; sub = esc + ' dari ' + total + ' Survivor berhasil kabur'; }
    else { title = mineOut === 2 ? 'KAMU KABUR!' : 'KAMU GUGUR'; sub = esc + ' dari ' + total + ' Survivor berhasil kabur'; }
    E('mxEndT').textContent = title; E('mxEndT').style.color = (killerRole ? killerWin : mineOut === 2) ? '#3dff8a' : '#e11d2e';
    E('mxEndS').textContent = sub; E('mxEnd').style.display = 'flex';
    SFX.hiss(false);
  }

  function tick(dt, t) {
    if (!active || !me) return;
    pawnIds.clear(); others.forEach((p, id) => pawnIds.set(p, id));
    const now = performance.now();
    flushT += dt; if (flushT > .25) { flushT = 0; flushNow(); }
    flashT = Math.max(0, flashT - dt);
    trackOthers(); syncWorld(now, t);
    if (!ended) roleLogic(dt, t); else { stopAct(); SFX.hiss(false); }
    updateHUD(now); checkEnd();
  }

  /* ---------- API yang dipakai patch Pawn ---------- */
  function filter(inp) {
    if (!active) return inp;
    const o = Object.assign({}, inp);
    const lock = out || stunT > 0 || (acting && !ended);
    if (lock) { o.x = 0; o.z = 0; o.run = false; o.jump = false; o.crouch = false; o.lunge = false; }
    else if (!killerRole && hp === 0) { o.run = false; o.jump = false; o.crouch = false; }
    return o;
  }
  function onHit() {                                    // dipanggil saat Terkam Killer mengenai kita
    if (!active || killerRole || out || hp <= 0 || ended) return;
    hp--; SFX.hit(); flashT = .35;
    if (hp === 1) { burstT = MCFG.burstTime; note('Kamu terluka! Lari!'); }
    else { hp = 0; bleedT = MCFG.bleedOut; revBase = sumObj(gget('rev/' + myId, {})); stopAct(); note('Kamu TUMBANG! Minta teman membangunkanmu'); }
    pushSv();
  }
  function pose(p, t) {
    const J = p.model && p.model.userData && p.model.userData.joints; if (!J || p.role !== 'survivor') return;
    const id = p === me ? myId : pawnIds.get(p); if (id === undefined) return;
    const s = svOf(id);
    if (s.out) { p.pivot.visible = false; return; }
    p.pivot.visible = true;
    if (s.hp === 0) {                                   // tumbang: tergeletak & merangkak
      p.tilt.rotation.x = -1.45; p.tilt.rotation.z = 0; p.tilt.position.y = .22;
      const w = Math.sin(t * 4);
      J.armL.rotation.x = -2.5 + w * .5; J.armR.rotation.x = -2.5 - w * .5; J.legL.rotation.x = w * .4; J.legR.rotation.x = -w * .4; J.head.rotation.x = -.5;
    } else if (p === me && acting && acting.kind !== 'pal') {
      J.armL.rotation.x = J.armR.rotation.x = -1.0 + Math.sin(t * 10) * .15; J.spine.rotation.x = .35;
    }
  }

  function start(slot, isOnline) {
    if (started) return; started = true;
    online = !!isOnline && !!Net.room && typeof firebase !== 'undefined';
    killerRole = slot === 0; myId = online && Net.me ? Net.me.uid : 'solo';
    roster = killerRole ? [] : [myId];
    if (online) {
      roster = Object.keys(Net.party.players).filter(id => Net.gslot(id) >= 1);
      gdb = firebase.database().ref('rooms/' + Net.room + '/game'); gdb.on('value', s => onGame(s.val()));
    }
    buildWorld(); buildHUD(); active = true;
    E('help').textContent = killerRole
      ? 'WASD gerak · Shift lari · klik layar untuk kamera · Klik kiri / E = TERKAM · tahan F = tendang tabung / hancurkan palet / habisi Survivor tumbang'
      : 'WASD gerak · Shift lari · Spasi lompat · C jongkok · tahan F = isi tabung / buka gerbang / bangunkan teman / jatuhkan palet · SPASI saat skill check';
    if (!killerRole) pushSv();
    addEventListener('keydown', e => { if (e.code === 'KeyF') fHeld = true; if (e.code === 'Space' && sc) scPressed = true; SFX.init(); });
    addEventListener('keyup', e => { if (e.code === 'KeyF') fHeld = false; });
    addEventListener('blur', () => { fHeld = false; });
    addEventListener('pointerdown', () => SFX.init(), { once: true });
    let last = performance.now();
    (function loop() {
      requestAnimationFrame(loop);
      const n = performance.now(), dt = Math.min((n - last) / 1000, .05); last = n;
      try { tick(dt, n / 1000); } catch (e) { if (!loop.err) { loop.err = 1; console.error('Mech.tick', e); } }
    })();
  }

  return { start, filter, onHit, pose, get active() { return active; }, get speedMul() { return speedMulV; } };
})();

/* ---------- PASANG KE game.js (tanpa mengubah file aslinya) ---------- */
(() => {
  const upd = Pawn.prototype.update, anim = Pawn.prototype.animate, fall = Pawn.prototype.fall;
  let inUpd = false;
  Pawn.prototype.update = function (dt, inp, camYaw) {
    if (!Mech.active || this !== me) return upd.call(this, dt, inp, camYaw);
    const w = CFG.walkSpeed; CFG.walkSpeed = w * Mech.speedMul; inUpd = true;
    try { return upd.call(this, dt, Mech.filter(inp), camYaw); } finally { CFG.walkSpeed = w; inUpd = false; }
  };
  // jatuh karena Terkam (dipanggil dari luar update) = terkena serangan; jatuh karena menabrak di es tetap normal
  Pawn.prototype.fall = function (nx, nz) {
    if (Mech.active && this === me && !inUpd && this.role === 'survivor') { Mech.onHit(); return; }
    return fall.call(this, nx, nz);
  };
  Pawn.prototype.animate = function (dt, t) { anim.call(this, dt, t); if (Mech.active) Mech.pose(this, t); };
  const _startGame = startGame;
  startGame = function (slot, isOnline) {
    _startGame(slot, isOnline);
    try { Mech.start(slot, isOnline); } catch (e) { console.error('Mech.start gagal', e); }
  };
})();
