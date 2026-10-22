# Killer vs Survivor 3D (Three.js)

⬇ **[Unduh game (ZIP)](https://github.com/byhasstudio/killer-vs-survivor/archive/refs/heads/main.zip)** — ekstrak, lalu jalankan lewat server lokal (mis. `python -m http.server`) atau pasang di GitHub Pages.

Proyek web statis (tanpa build): hosting di GitHub Pages, lalu bungkus jadi APK/EXE.

## File
- `index.html` — tampilan (tema merah-hitam-putih): login, username, menu party & teman, HUD
- `ui.js`      — alur layar: Google login → username → menu (party + teman + undangan)
- `net.js`     — Firebase: Auth Google, username unik, teman, undangan, party, sinkron posisi
- `game.js`    — fisika Rigidbody, Lantai Licin (`isSlippery`), jatuh 3 detik, kamera third-person
- `visual.js`  — suasana malam, rumah besar, tekstur prosedural, pencahayaan
- `mechanics.js` — mekanik **Tabung Gas** (objektif, gerbang, palet, skill check, status Survivor, HUD, suara)
- `chibi.js`   — createChibi() + 10 karakter (disalin apa adanya dari chibi_characters.html)
- `database.rules.json` — aturan keamanan Realtime Database (WAJIB dipasang, termasuk blok `game`)

Urutan script di `index.html`: `chibi.js` → `net.js` → `game.js` → `visual.js` → `mechanics.js` → `ui.js`.
`mechanics.js` dipasang di atas `game.js` tanpa mengubahnya (membungkus `Pawn.update/animate/fall` dan `startGame`).

## Alur pemain
1. Masuk dengan Google → ketik username unik (seperti Roblox).
2. Tab **Tambah**: ketik username teman → kirim permintaan. Teman menerima di tab **Permintaan**.
3. Setelah berteman: **Buat Party** → tekan **Undang** pada teman yang online → teman menerima undangan.
4. Host menekan **Mulai Game**. Killer dipilih acak (min. 2 pemain), sisanya Survivor. Maks 5 pemain.
Hanya teman yang bisa diundang, dan rules database menolak masuk room tanpa undangan host.

## Mekanik Tabung Gas
Tabung gas menggantikan generator pada game asimetris sejenis.

**Survivor**
- Tahan **F** di dekat tabung untuk mengisinya. Muncul **skill check**: tekan **Spasi** saat jarum di zona putih
  (zona merah kecil = sempurna). Gagal = isi berkurang dan tabung bocor (Killer melihat aura merahnya).
- Selesaikan **4 dari 6 tabung** → 2 **gerbang keluar** menyala. Tahan **F** di gerbang sampai terbuka, lalu lari lewat gerbang untuk **kabur**.
- Terkena Terkam Killer: **Sehat → Terluka** (lari kencang sesaat) **→ Tumbang** (merangkak, kehabisan darah dalam 70 dtk).
  Teman menahan **F** di dekat Survivor tumbang untuk membangunkannya.
- Tahan **F** di **palet kayu** untuk menjatuhkannya: jadi penghalang dan menstun Killer yang terlalu dekat.

**Killer**
- **Terkam** (klik kiri / **E**) untuk melukai Survivor.
- Tahan **F** di tabung = tendang (isi berkurang), di palet jatuh = hancurkan, di Survivor tumbang = habisi.
- Tabung yang sedang diisi / bocor terlihat sebagai aura lewat dinding.

**Menang**: Survivor menang bila setidaknya setengahnya berhasil kabur saat semua Survivor sudah selesai (kabur atau gugur); selain itu Killer menang.
Latihan Solo Survivor bisa dipakai untuk mencoba tabung, skill check, gerbang, dan palet (tanpa Killer).

Semua angka (laju isi, jumlah tabung, waktu, kecepatan) ada di objek `MCFG` di atas `mechanics.js`;
posisi tabung/gerbang/palet di `GAS_POS`, `GATE_POS`, `PAL_POS`.

## Sinkron online (data game)
Disimpan di `rooms/{kode}/game/...` dan diatur oleh blok `game` di `database.rules.json`:
`gas/{i}/c/{uid}` (isi per pemain), `gas/{i}/sab|done|leak`, `gate/{g}/c/{uid}|open`, `sv/{uid}` (`hp`, `out`),
`rev/{target}/{uid}`, `exec/{target}`, `pal/{i}`. Tiap pemain hanya menulis datanya sendiri; sabotase & habisi hanya Killer.

## Setup Firebase (sekali)
1. Authentication → Sign-in method → aktifkan **Google**.
   Settings → **Authorized domains** → tambahkan `byhasstudio.github.io`.
2. Realtime Database → buat → tab Rules → tempel isi `database.rules.json` → Publish
   (**ulangi setiap kali file ini berubah**, kalau tidak mekanik online akan ditolak).
3. Project settings → Web app → salin config ke `firebaseConfig` di `net.js`.

## Kontrol
WASD · Shift lari · Spasi lompat (juga skill check) · C jongkok · **F tahan = interaksi** · klik layar = kamera · T = paksa licin (tes).
Killer: klik kiri / E = Terkam.
Mobile: joystick kiri, geser kanan = kamera, tombol Lompat/Lari/Jongkok/**Aksi** (Terkam untuk Killer); ketuk lingkaran skill check.

## Tuning Lantai Licin
Objek `CFG` di atas `game.js` (iceFriction, iceAccel, iceChaos, minImpact, fallTime).

## Jadi APK / EXE
- **EXE**: Electron (`electron-builder`) membungkus folder ini. Login popup Google berjalan normal.
- **APK**: Capacitor. PENTING: `signInWithPopup` TIDAK jalan di WebView Android. Pakai plugin
  `@capacitor-firebase/authentication` untuk login Google native, lalu tukar credential-nya
  ke Firebase JS SDK. Simpan three.js & firebase SDK secara lokal agar tidak bergantung CDN.
- Daftar file yang disalin workflow build harus menyertakan `mechanics.js`.
