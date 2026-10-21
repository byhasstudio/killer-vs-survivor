'use strict';
/* =====================================================================
   VISUAL.JS — peningkatan grafik & tekstur (suasana malam ala game horor populer)
   Dipasang di atas game.js tanpa mengubah logika game. Semua tekstur dibuat
   prosedural lewat canvas (tanpa file gambar), jadi tetap ringan untuk APK/EXE.
   Angka pencahayaan bisa diatur di objek VIS di bawah.
   Isi: langit malam + bulan + bintang, kabut hangat, tekstur tanah/bata/beton/kayu/es,
   rumah besar berpilar di kejauhan, pohon mati, tiang lampu, rumput, kabut tanah,
   debu melayang, lentera mengikuti pemain, vignette + grain film.
   ===================================================================== */
const VIS = {
  exposure: 1.2,                         // kecerahan keseluruhan (naikkan jika terlalu gelap)
  fogColor: 0x2b2118, fogNear: 22, fogFar: 125,
  hemiSky: 0x5b6f9a, hemiGround: 0x2a2118, hemiInt: 0.75,
  moonColor: 0x9fb4e8, moonInt: 0.9,
  lanternColor: 0xffc27a, lanternInt: 0.9, lanternDist: 16,   // cahaya hangat di dekat pemain
  mansionZ: -66                          // posisi rumah besar (di luar tembok utara)
};

(() => {
  // pengacak berbenih supaya tampilan konsisten di setiap perangkat
  const R0 = (() => { let a = 20261021; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);

  /* ---------- helper tekstur canvas ---------- */
  function ctex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    return t;
  }
  const wrap9 = (w, h, x, y, fn) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(x + ox, y + oy); };
  const glowTex = (inner, outer) => ctex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });

  const T = {};
  T.ground = ctex(512, 512, (g, w, h) => {            // tanah + rumput kering + kerikil
    g.fillStyle = '#3a3123'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 80; i++) {
      const x = R0() * w, y = R0() * h, r = 24 + R0() * 70, dark = R0() < .5;
      wrap9(w, h, x, y, (cx, cy) => {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, dark ? 'rgba(18,14,9,.38)' : 'rgba(92,78,52,.26)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
      });
    }
    const cols = ['#3f4a2a', '#4b5530', '#2f3a20', '#5a4a2e', '#6b5a3a', '#2b2a1c'];
    for (let i = 0; i < 5200; i++) { g.globalAlpha = .25 + R0() * .5; g.fillStyle = cols[(R0() * cols.length) | 0]; g.fillRect(R0() * w, R0() * h, 1 + R0() * 2, 2 + R0() * 5); }
    for (let i = 0; i < 260; i++) { g.globalAlpha = .55; g.fillStyle = R0() < .5 ? '#6e675a' : '#2a261e'; g.beginPath(); g.ellipse(R0() * w, R0() * h, 1 + R0() * 2.5, 1 + R0() * 1.8, R0() * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  });
  T.brick = ctex(256, 256, (g, w, h) => {              // bata tua berlumut (tembok luar)
    g.fillStyle = '#2b2522'; g.fillRect(0, 0, w, h);
    const bh = 32, bw = 64;
    for (let row = 0; row * bh < h; row++) {
      const off = (row % 2) * bw / 2;
      for (let x = -bw; x < w + bw; x += bw) {
        g.fillStyle = 'hsl(' + (12 + R0() * 10) + ',' + (26 + R0() * 14) + '%,' + (24 + R0() * 18) + '%)';
        g.fillRect(x + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
    for (let i = 0; i < 900; i++) { g.globalAlpha = .12 + R0() * .15; g.fillStyle = R0() < .5 ? '#000' : '#8a6a55'; g.fillRect(R0() * w, R0() * h, 1 + R0() * 3, 1 + R0() * 3); }
    const mg = g.createLinearGradient(0, h * .55, 0, h); mg.addColorStop(0, 'rgba(40,70,30,0)'); mg.addColorStop(1, 'rgba(40,74,30,.5)');
    g.globalAlpha = 1; g.fillStyle = mg; g.fillRect(0, h * .55, w, h * .45);
  });
  T.concrete = ctex(256, 256, (g, w, h) => {          // beton retak (pilar zona es)
    g.fillStyle = '#6a6a66'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.globalAlpha = .08 + R0() * .12; g.fillStyle = R0() < .5 ? '#2a2a28' : '#a8a8a2'; g.fillRect(R0() * w, R0() * h, 1 + R0() * 3, 1 + R0() * 3); }
    g.globalAlpha = 1; g.strokeStyle = 'rgba(25,25,22,.6)'; g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) { let x = R0() * w, y = R0() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R0() - .5) * 40; y += R0() * 30; g.lineTo(x, y); } g.stroke(); }
    const sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, 'rgba(0,0,0,.25)'); sg.addColorStop(.4, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(30,50,25,.3)');
    g.fillStyle = sg; g.fillRect(0, 0, w, h);
  });
  T.wood = ctex(256, 256, (g, w, h) => {              // papan kayu tua (rintangan luar)
    const pw = 32;
    for (let i = 0; i < w / pw; i++) {
      g.fillStyle = 'hsl(' + (24 + R0() * 8) + ',' + (34 + R0() * 12) + '%,' + (22 + R0() * 12) + '%)'; g.fillRect(i * pw, 0, pw, h);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(i * pw, 0, 2, h);
      for (let k = 0; k < 14; k++) { g.strokeStyle = 'rgba(20,10,0,' + (.1 + R0() * .2) + ')'; g.lineWidth = 1; const x = i * pw + 3 + R0() * (pw - 6); g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 4, h * .3, x - 4, h * .6, x + 2, h); g.stroke(); }
      g.fillStyle = '#1b1510'; g.fillRect(i * pw + 6, 10, 3, 3); g.fillRect(i * pw + pw - 9, 10, 3, 3); g.fillRect(i * pw + 6, h - 14, 3, 3); g.fillRect(i * pw + pw - 9, h - 14, 3, 3);
    }
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, h * .46, w, 14); g.fillRect(0, 0, w, 5);
  });
  T.ice = ctex(512, 512, (g, w, h) => {               // es retak berkilau
    const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#b9ecfa'); bg.addColorStop(1, '#8fd3ea');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = R0() * w, y = R0() * h, r = 20 + R0() * 60;
      wrap9(w, h, x, y, (cx, cy) => { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2); });
    }
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) { g.strokeStyle = 'rgba(255,255,255,' + (.15 + R0() * .3) + ')'; g.lineWidth = .6 + R0() * 1.2; const x = R0() * w, y = R0() * h, a = R0() * 6.28, l = 20 + R0() * 80; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(40,110,140,.55)'; g.lineWidth = 1; let x = R0() * w, y = R0() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (R0() - .5) * 60; y += (R0() - .2) * 50; g.lineTo(x, y); } g.stroke(); }
  });
  T.bark = ctex(128, 256, (g, w, h) => {              // kulit pohon
    g.fillStyle = '#2c231b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.strokeStyle = R0() < .5 ? 'rgba(10,6,3,.55)' : 'rgba(96,80,62,.35)'; g.lineWidth = 1 + R0() * 2; const x = R0() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6 * (R0() - .5), h * .3, x + 8 * (R0() - .5), h * .7, x + 4 * (R0() - .5), h); g.stroke(); }
  });

  /* ---------- UV dunia untuk kotak (tekstur tidak melar di dinding panjang) ---------- */
  function worldUV(mesh, tile) {
    const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const ox = mesh.position.x, oy = mesh.position.y, oz = mesh.position.z;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
      let u, v;
      if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = x; v = z; } else { u = x; v = y; }
      uv.setXY(i, u / tile, v / tile);
    }
    uv.needsUpdate = true;
  }

  /* ---------- 1. restyle dunia bawaan game.js ---------- */
  const floorW = ARENA * 2, iceW = ICE.x1 - ICE.x0, toRemove = [];
  scene.children.slice().forEach(o => {
    if (o.type === 'GridHelper') { toRemove.push(o); return; }
    if (!o.isMesh) return;
    const gt = o.geometry.type;
    if (gt === 'PlaneGeometry') {
      const wd = o.geometry.parameters.width;
      if (wd === floorW) {
        T.ground.repeat.set(10, 10);
        o.material = new THREE.MeshStandardMaterial({ map: T.ground, roughness: 1, metalness: 0 });
      } else if (wd === iceW) {
        T.ice.repeat.set(3, 3);
        o.material = new THREE.MeshStandardMaterial({ map: T.ice, color: 0xffffff, roughness: .08, metalness: .2, emissive: 0x0b3340, emissiveIntensity: .6 });
      }
    } else if (gt === 'BoxGeometry') {
      const col = o.material.color.getHex();
      const kind = col === 0x39414f ? 'brick' : col === 0x7a6a58 ? 'concrete' : 'wood';
      worldUV(o, kind === 'concrete' ? 4 : 3);
      o.material = new THREE.MeshStandardMaterial({ map: T[kind], bumpMap: T[kind], bumpScale: kind === 'brick' ? 1.5 : 1, roughness: .95, metalness: 0 });
    }
  });
  toRemove.forEach(o => scene.remove(o));

  // tanah luar arena (supaya tidak ada "kehampaan" di balik tembok)
  T.ground2 = T.ground.clone(); T.ground2.repeat.set(75, 75); T.ground2.needsUpdate = true;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: T.ground2, roughness: 1, color: 0x8c8c8c }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.1; outer.receiveShadow = true; scene.add(outer);

  /* ---------- 2. render, kabut, cahaya ---------- */
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = VIS.exposure;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.fog = new THREE.Fog(VIS.fogColor, VIS.fogNear, VIS.fogFar);
  scene.background = new THREE.Color(VIS.fogColor);
  camera.far = 600; camera.updateProjectionMatrix();
  const hemi = scene.children.find(o => o.isHemisphereLight);
  if (hemi) { hemi.color.setHex(VIS.hemiSky); hemi.groundColor.setHex(VIS.hemiGround); hemi.intensity = VIS.hemiInt; }
  sun.color.setHex(VIS.moonColor); sun.intensity = VIS.moonInt; sun.position.set(-40, 70, -30); sun.shadow.bias = -0.0004;

  /* ---------- 3. langit malam: gradasi, bintang, bulan ---------- */
  const sky = new THREE.Group(); scene.add(sky);
  const skyTex = ctex(8, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#04060c'); gr.addColorStop(.35, '#0b1020'); gr.addColorStop(.47, '#2a1d17'); gr.addColorStop(.5, '#5a3a22'); gr.addColorStop(.53, '#1a120d'); gr.addColorStop(1, '#0a0705');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  skyTex.wrapS = skyTex.wrapT = THREE.ClampToEdgeWrapping;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10; sky.add(dome);
  {
    const n = 420, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = R0() * 6.283, e = .08 + R0() * 1.2, r = 300; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sky.add(new THREE.Points(gm, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: .8, fog: false, depthWrite: false })));
  }
  const moonTex = ctex(128, 128, g => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, 'rgba(255,255,255,1)'); gr.addColorStop(.24, 'rgba(190,205,245,.35)'); gr.addColorStop(1, 'rgba(140,160,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, transparent: true, opacity: .9 }));
  moon.scale.set(60, 60, 1); moon.position.copy(sun.position).normalize().multiplyScalar(280); sky.add(moon);

  /* ---------- 4. tiang lampu (cahaya semu: bohlam + glow + kolam cahaya) ---------- */
  const warmGlow = glowTex('rgba(255,190,110,1)', 'rgba(255,150,60,0)');
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex('rgba(255,180,90,.55)', 'rgba(255,150,60,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: .6, metalness: .6 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  [[-30, -8], [30, -12], [-18, 32], [18, 32]].forEach(([x, z]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 3.8, 8), lampMat); pole.position.set(x, 1.9, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.7, .08, .08), lampMat); arm.position.set(x + .3, 3.75, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.34, .2, .34), lampMat); head.position.set(x + .6, 3.65, z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), bulbMat); bulb.position.set(x + .6, 3.5, z);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: warmGlow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: .9 }));
    sp.scale.set(3.2, 3.2, 1); sp.position.copy(bulb.position);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), poolMat); pool.rotation.x = -Math.PI / 2; pool.position.set(x + .6, .08, z);
    scene.add(pole, arm, head, bulb, sp, pool);
    addBox(x, z, .4, .4, 4, 0x222222, null);          // tiang ikut jadi penghalang (tanpa mesh tambahan)
  });

  /* ---------- 5. rumah besar berpilar di luar tembok utara ---------- */
  const mansionMat = (() => {
    const Z = VIS.mansionZ, W = 56, H = 15, D = 14;
    const lit = []; for (let r = 0; r < 2; r++) for (let k = 0; k < 11; k++) lit.push(R0() < .38);
    const drawFacade = (g, w, h, emissive) => {
      if (emissive) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
      else {
        g.fillStyle = '#c4bfae'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 160; i++) { g.globalAlpha = .06 + R0() * .08; g.fillStyle = '#2a2620'; g.fillRect(R0() * w, 0, 1 + R0() * 4, h * (.3 + R0() * .7)); }
        g.globalAlpha = 1;
        const gr = g.createLinearGradient(0, h * .6, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(25,30,20,.55)'); g.fillStyle = gr; g.fillRect(0, h * .6, w, h * .4);
        g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, h * .5 - 4, w, 6);
      }
      const n = 11, ww = 56, wh = 90, m = 50, step = (w - 2 * m - ww) / (n - 1);
      [30, 150].forEach((y, r) => {
        for (let k = 0; k < n; k++) {
          const x = m + k * step;
          if (r === 1 && k === 5) {                       // pintu utama
            if (!emissive) { g.fillStyle = '#e6e2d6'; g.fillRect(x - 14, y - 6, ww + 28, 126); g.fillStyle = '#3a2a1e'; g.fillRect(x - 6, y + 2, ww + 12, 118); g.fillStyle = '#ffcf7a'; g.fillRect(x + 6, y + 14, ww - 12, 30); }
            else { g.fillStyle = '#ffb35a'; g.fillRect(x + 6, y + 14, ww - 12, 30); }
            continue;
          }
          const on = lit[r * n + k];
          if (!emissive) {
            g.fillStyle = '#233028'; g.fillRect(x - 20, y, 16, wh); g.fillRect(x + ww + 4, y, 16, wh);   // daun jendela
            g.fillStyle = '#e9e6dc'; g.fillRect(x - 5, y - 5, ww + 10, wh + 10);
            g.fillStyle = on ? '#e8c27a' : '#0b0f18'; g.fillRect(x, y, ww, wh);
            g.fillStyle = '#e9e6dc'; g.fillRect(x + ww / 2 - 2, y, 4, wh); g.fillRect(x, y + wh / 2 - 2, ww, 4);
          } else if (on) {
            g.fillStyle = '#ffb35a'; g.fillRect(x, y, ww, wh);
            g.fillStyle = '#000'; g.fillRect(x + ww / 2 - 2, y, 4, wh); g.fillRect(x, y + wh / 2 - 2, ww, 4);
          }
        }
      });
    };
    const fTex = ctex(1024, 280, (g, w, h) => drawFacade(g, w, h, false));
    const eTex = ctex(1024, 280, (g, w, h) => drawFacade(g, w, h, true));
    [fTex, eTex].forEach(t => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; });
    const side = new THREE.MeshStandardMaterial({ color: 0x8a8576, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 1 });
    const white = new THREE.MeshStandardMaterial({ color: 0xdcd8cc, roughness: .9 });
    const front = new THREE.MeshStandardMaterial({ map: fTex, emissive: 0xffffff, emissiveMap: eTex, emissiveIntensity: .9, roughness: .95 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); scene.add(m); return m; };
    add(new THREE.BoxGeometry(W, H, D), [side, side, dark, dark, front, side], 0, H / 2, Z);
    add(new THREE.BoxGeometry(W + 3, 1.2, D + 3), dark, 0, H + .6, Z);                // atap
    const gable = new THREE.Shape(); gable.moveTo(-12, 0); gable.lineTo(12, 0); gable.lineTo(0, 6.5); gable.closePath();
    add(new THREE.ExtrudeGeometry(gable, { depth: 1.2, bevelEnabled: false }), white, 0, H + 1.2, Z + D / 2 - .3);   // gable depan
    add(new THREE.BoxGeometry(2, 5, 2), dark, -14, H + 3, Z); add(new THREE.BoxGeometry(2, 5, 2), dark, 14, H + 3, Z);   // cerobong
    const pz = Z + D / 2 + 3;                                                         // teras berpilar
    add(new THREE.BoxGeometry(50, .6, 7), white, 0, .3, pz);
    add(new THREE.BoxGeometry(50, .8, 7), white, 0, 9.4, pz);
    for (let i = 0; i < 10; i++) add(new THREE.CylinderGeometry(.5, .56, 9, 14), white, -22.5 + i * 5, 4.8, pz + 2.6);
    for (let i = 0; i < 3; i++) { const h = (i + 1) * .2; add(new THREE.BoxGeometry(10, h, 1), white, 0, h / 2, pz + 4.4 - i * .5); }   // tangga
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: warmGlow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: .8 }));
    lamp.scale.set(7, 7, 1); lamp.position.set(0, 3.4, pz + 3.2); scene.add(lamp);
    // sorotan hangat ke fasad (seperti di referensi)
    const spot = new THREE.SpotLight(0xffb870, 1.6, 150, .95, .6, 1);
    spot.position.set(0, 1.2, -45); spot.target.position.set(0, 9, Z + 7); scene.add(spot, spot.target);
    return front;
  })();

  /* ---------- 6. pohon mati (digabung jadi 1 geometri per pohon agar ringan) ---------- */
  function mergeGeos(geos) {
    const P = [], N = [], U = [];
    geos.forEach(g => { const n = g.index ? g.toNonIndexed() : g; P.push(n.attributes.position.array); N.push(n.attributes.normal.array); U.push(n.attributes.uv.array); });
    const cat = arr => { const out = new Float32Array(arr.reduce((a, b) => a + b.length, 0)); let o = 0; arr.forEach(a => { out.set(a, o); o += a.length; }); return out; };
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(cat(P), 3));
    m.setAttribute('normal', new THREE.BufferAttribute(cat(N), 3));
    m.setAttribute('uv', new THREE.BufferAttribute(cat(U), 2));
    return m;
  }
  function treeGeo(seed, H) {
    let a = seed; const R = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const parts = [], up = new THREE.Vector3(0, 1, 0);
    const grow = (base, dir, len, r, depth) => {
      const g = new THREE.CylinderGeometry(r * .62, r, len, 6, 1); g.translate(0, len / 2, 0);
      g.applyMatrix4(new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromUnitVectors(up, dir), new THREE.Vector3(1, 1, 1)));
      parts.push(g);
      if (depth <= 0) return;
      const end = base.clone().addScaledVector(dir, len), n = depth === 3 ? 4 : 2 + (R() < .5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const d = new THREE.Vector3(dir.x + (R() - .5) * 1.5, dir.y * .55 + .25 + R() * .35, dir.z + (R() - .5) * 1.5).normalize();
        grow(end, d, len * (.66 + R() * .16), r * .64, depth - 1);
      }
    };
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3((R() - .5) * .12, 1, (R() - .5) * .12).normalize(), H * .36, .5, 3);
    return mergeGeos(parts);
  }
  const treeGeos = [treeGeo(11, 12), treeGeo(23, 12), treeGeo(37, 12)];
  const barkMat = new THREE.MeshStandardMaterial({ map: T.bark, color: 0x8a7a6a, roughness: 1 });
  [[34, -48, 15], [-38, -50, 12], [-48, -50, 12], [60, -30, 11], [-62, -20, 13], [63, -2, 10], [-58, 18, 11], [60, 24, 12],
   [-50, 52, 12], [52, 58, 10], [-70, -48, 13], [70, -50, 12], [0, 60, 11], [-20, 66, 12], [22, 64, 10], [46, -64, 12]]
    .forEach(([x, z, H], i) => {
      const m = new THREE.Mesh(treeGeos[i % 3], barkMat), s = H / 12 * (.9 + R0() * .25);
      m.position.set(x, 0, z); m.rotation.y = R0() * 6.28; m.scale.set(s, s, s); scene.add(m);
    });

  /* ---------- 7. rumput liar + bercak tanah (memecah pengulangan tekstur) ---------- */
  {
    const N = 1500, g = new THREE.ConeGeometry(.07, .55, 4); g.translate(0, .275, 0);
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
    let k = 0, tries = 0;
    while (k < N && tries++ < N * 6) {
      const x = (R0() * 2 - 1) * 90, z = (R0() * 2 - 1) * 90;
      if (inIce(x, z)) continue;
      if (BOXES.some(b => x > b.x0 - .3 && x < b.x1 + .3 && z > b.z0 - .3 && z < b.z1 + .3)) continue;
      if (Math.abs(x) < 34 && z < -52 && z > -76) continue;          // di bawah teras rumah
      const sc = .7 + R0() * 1.1; e.set((R0() - .5) * .35, R0() * 6.28, (R0() - .5) * .35); q.setFromEuler(e);
      p.set(x, 0, z); s.set(sc, sc * (.8 + R0() * .8), sc); im.setMatrixAt(k, m.compose(p, q, s));
      c.setHSL(.2 + R0() * .08, .35 + R0() * .2, .1 + R0() * .1); im.setColorAt(k, c); k++;
    }
    im.count = k; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
    const bMat = new THREE.MeshBasicMaterial({ map: glowTex('rgba(10,8,5,.55)', 'rgba(10,8,5,0)'), transparent: true, depthWrite: false, opacity: .5 });
    for (let i = 0; i < 34; i++) {
      const x = (R0() * 2 - 1) * 38, z = (R0() * 2 - 1) * 38; if (inIce(x, z)) continue;
      const sz = 7 + R0() * 12, b = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), bMat);
      b.rotation.x = -Math.PI / 2; b.position.set(x, .03, z); scene.add(b);
    }
  }

  /* ---------- 8. atmosfer: kabut tanah, debu melayang, lentera pemain ---------- */
  const fogTex = glowTex('rgba(200,185,160,.5)', 'rgba(200,185,160,0)'), fogs = [];
  for (let i = 0; i < 12; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, transparent: true, depthWrite: false, opacity: .1 + R0() * .08, fog: false }));
    const s = 22 + R0() * 16; sp.scale.set(s, s * .35, 1); sp.position.set((R0() * 2 - 1) * 45, 1 + R0() * 1.5, (R0() * 2 - 1) * 45);
    sp.userData = { bx: sp.position.x, ph: R0() * 6.28, sp: .05 + R0() * .08 }; fogs.push(sp); scene.add(sp);
  }
  const dust = (() => {
    const n = 220, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (R0() - .5) * 28; pos[i * 3 + 1] = R0() * 8; pos[i * 3 + 2] = (R0() - .5) * 28; }
    const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(gm, new THREE.PointsMaterial({ color: 0xffe0a8, size: .07, transparent: true, opacity: .5, depthWrite: false, fog: false }));
  })();
  scene.add(dust);
  const lantern = new THREE.PointLight(VIS.lanternColor, VIS.lanternInt, VIS.lanternDist, 2); scene.add(lantern);

  // vignette + grain film (hanya saat bermain)
  const css = document.createElement('style');
  css.textContent = '#fxVig,#fxGrain{display:none;position:fixed;inset:0;z-index:3;pointer-events:none}' +
    '#fxVig{background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.55) 100%)}' +
    '#fxGrain{opacity:.07;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'.85\' numOctaves=\'2\' stitchTiles=\'stitch\'/></filter><rect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/></svg>")}';
  document.head.appendChild(css);
  const vig = document.createElement('div'); vig.id = 'fxVig';
  const grain = document.createElement('div'); grain.id = 'fxGrain';
  document.body.append(vig, grain);

  let t0 = performance.now(), frame = 0;
  (function loop() {
    requestAnimationFrame(loop);
    const now = performance.now(), t = now / 1000, dt = Math.min((now - t0) / 1000, .05); t0 = now;
    sky.position.copy(camera.position);
    dust.position.set(camera.position.x, Math.sin(t * .3) * .3, camera.position.z); dust.rotation.y += dt * .03;
    fogs.forEach(s => { const u = s.userData; s.position.x = u.bx + Math.sin(t * u.sp + u.ph) * 6; });
    mansionMat.emissiveIntensity = .85 + .1 * Math.sin(t * 7) * Math.sin(t * 2.3);       // lampu jendela berkedip halus
    const on = typeof me !== 'undefined' && !!me;
    vig.style.display = grain.style.display = on ? 'block' : 'none';
    if (on) lantern.position.set(me.pos.x, me.pos.y + 3.2, me.pos.z);
    if (on && (frame++ & 3) === 0) grain.style.backgroundPosition = ((Math.random() * 160) | 0) + 'px ' + ((Math.random() * 160) | 0) + 'px';
  })();
})();
