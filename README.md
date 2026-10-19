# Killer vs Survivor 3D (Three.js)

⬇ **[Unduh game (ZIP)](https://github.com/byhasstudio/killer-vs-survivor/archive/refs/heads/main.zip)** — ekstrak, lalu jalankan lewat server lokal (mis. `python -m http.server`) atau pasang di GitHub Pages.

Proyek web statis (tanpa build): hosting di GitHub Pages, lalu bungkus jadi APK/EXE.

## File
- `index.html` — tampilan (tema merah-hitam-putih): login, username, menu party & teman, HUD
- `ui.js`      — alur layar: Google login → username → menu (party + teman + undangan)
- `net.js`     — Firebase: Auth Google, username unik, teman, undangan, party, sinkron posisi
- `game.js`    — fisika Rigidbody, Lantai Licin (`isSlippery`), jatuh 3 detik, kamera third-person
- `chibi.js`   — createChibi() + 10 karakter (disalin apa adanya dari chibi_characters.html)
- `database.rules.json` — aturan keamanan Realtime Database (WAJIB dipasang)

## Alur pemain
1. Masuk dengan Google → ketik username unik (seperti Roblox).
2. Tab **Tambah**: ketik username teman → kirim permintaan. Teman menerima di tab **Permintaan**.
3. Setelah berteman: **Buat Party** → tekan **Undang** pada teman yang online → teman menerima undangan.
4. Host menekan **Mulai Game**. Killer dipilih acak (min. 2 pemain), sisanya Survivor. Maks 5 pemain.
Hanya teman yang bisa diundang, dan rules database menolak masuk room tanpa undangan host.

## Setup Firebase (sekali)
1. Authentication → Sign-in method → aktifkan **Google**.
   Settings → **Authorized domains** → tambahkan `byhasstudio.github.io`.
2. Realtime Database → buat → tab Rules → tempel isi `database.rules.json` → Publish.
3. Project settings → Web app → salin config ke `firebaseConfig` di `net.js`.

## Kontrol
WASD · Shift lari · Spasi lompat · C jongkok · klik layar = kamera · T = paksa licin (tes).
Mobile: joystick kiri, geser kanan = kamera, tombol Lompat/Lari/Jongkok.

## Tuning Lantai Licin
Objek `CFG` di atas `game.js` (iceFriction, iceAccel, iceChaos, minImpact, fallTime).

## Jadi APK / EXE
- **EXE**: Electron (`electron-builder`) membungkus folder ini. Login popup Google berjalan normal.
- **APK**: Capacitor. PENTING: `signInWithPopup` TIDAK jalan di WebView Android. Pakai plugin
  `@capacitor-firebase/authentication` untuk login Google native, lalu tukar credential-nya
  ke Firebase JS SDK. Simpan three.js & firebase SDK secara lokal agar tidak bergantung CDN.
