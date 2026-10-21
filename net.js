'use strict';
/* =====================================================================
   NET: akun + teman + party + sinkron posisi, semuanya lewat Firebase
   (Authentication Google + Realtime Database, SDK compat).

   LANGKAH SETUP (sekali saja):
   1. Firebase Console > Build > Authentication > Sign-in method > aktifkan "Google".
      Di tab Settings > Authorized domains tambahkan domain GitHub Pages kamu
      (mis. namakamu.github.io).
   2. Build > Realtime Database > buat database, lalu tempel isi
      database.rules.json ke tab Rules.
   3. Project settings > Your apps (Web) > salin config ke firebaseConfig di bawah.

   STRUKTUR DATA
     usernames/{huruf_kecil}   = uid pemilik (menjamin username unik)
     users/{uid}               = { username, lower }
     presence/{uid}            = true selama online
     friends/{uid}/{teman}     = true (dua arah setelah diterima)
     friendRequests/{tujuan}/{pengirim} = { username, ts }
     invites/{tujuan}/{pengirim}        = { room, username, ts }
     rooms/{kode}/meta         = { host, killer, started }
     rooms/{kode}/allowed/{uid}= true  (hanya yang diundang host bisa masuk)
     rooms/{kode}/slots/{0..4} = uid
     rooms/{kode}/players/{uid}= { name, slot }
     rooms/{kode}/state/{uid}  = posisi & status (dikirim ~10x/detik)
   ===================================================================== */
const firebaseConfig = {
  apiKey: 'AIzaSyA2V6BcpJjHGmtdqqpdzpG_Bcm_nehB5c8',
  authDomain: 'survivor-vs-killer.firebaseapp.com',
  databaseURL: 'https://survivor-vs-killer-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'survivor-vs-killer',
  storageBucket: 'survivor-vs-killer.firebasestorage.app',
  messagingSenderId: '141981157843',
  appId: '1:141981157843:web:ed0affe891344ea6c28726'
};

const Net = (() => {
  let db, auth, me = null;                 // me = { uid, username, photo }
  const cb = {};                           // callback dari UI: auth, friends, requests, invite, party, start, partyEnded
  const emit = (k, ...a) => cb[k] && cb[k](...a);
  const names = {}, online = {}, presenceRefs = {};
  let friendIds = [], sessionRefs = [];
  let room = null, mySlot = -1, partyRefs = [], stateRef = null;
  let party = { meta: null, players: {} }, frozen = {};
  const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

  const API = {
    cb,
    get me() { return me; }, get party() { return party; }, get room() { return room; },
    configured: () => !!firebaseConfig.databaseURL && typeof firebase !== 'undefined',
    isHost: () => !!me && !!party.meta && party.meta.host === me.uid,
    isOnline: id => !!online[id], nameOf: id => names[id] || '...',
    friends: () => friendIds.slice(),
    playerName: id => (party.players[id] && party.players[id].name) || '',

    /* ---------- Akun ---------- */
    init() {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database(); auth = firebase.auth();
      auth.onAuthStateChanged(async u => {
        if (!u) { stopSession(); me = null; emit('auth', null); return; }
        const v = (await db.ref('users/' + u.uid).once('value')).val();
        me = { uid: u.uid, username: v && v.username || null, photo: u.photoURL };
        if (me.username) { names[me.uid] = me.username; startSession(); }
        emit('auth', me);
      });
    },
    loginGoogle: () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()),
    async logout() { await API.leaveParty(); stopSession(); await auth.signOut(); },

    // Klaim username unik (seperti Roblox): usernames/{lower} = uid
    async setUsername(name) {
      name = name.trim();
      if (!NAME_RE.test(name)) throw new Error('Username 3-16 karakter: huruf, angka, atau _');
      const lower = name.toLowerCase();
      const r = await db.ref('usernames/' + lower).transaction(c => (c ? undefined : me.uid));
      if (!r.committed && r.snapshot.val() !== me.uid) throw new Error('Username sudah dipakai orang lain');
      await db.ref('users/' + me.uid).set({ username: name, lower });
      me.username = name; names[me.uid] = name; startSession(); emit('auth', me);
    },

    /* ---------- Teman ---------- */
    async sendRequest(input) {
      const lower = input.trim().replace(/^@/, '').toLowerCase();
      if (!NAME_RE.test(lower)) throw new Error('Format username tidak valid');
      const t = (await db.ref('usernames/' + lower).once('value')).val();
      if (!t) throw new Error('Username tidak ditemukan');
      if (t === me.uid) throw new Error('Itu akunmu sendiri');
      if (friendIds.includes(t)) throw new Error('Kalian sudah berteman');
      // jika dia sudah lebih dulu mengirim permintaan ke kita -> langsung jadi teman
      if ((await db.ref(`friendRequests/${me.uid}/${t}`).once('value')).exists()) { await API.accept(t); return 'accepted'; }
      await db.ref(`friendRequests/${t}/${me.uid}`).set({ username: me.username, ts: Date.now() });
      return 'sent';
    },
    accept: from => db.ref().update({
      [`friends/${me.uid}/${from}`]: true, [`friends/${from}/${me.uid}`]: true, [`friendRequests/${me.uid}/${from}`]: null }),
    decline: from => db.ref(`friendRequests/${me.uid}/${from}`).remove(),
    removeFriend: id => db.ref().update({ [`friends/${me.uid}/${id}`]: null, [`friends/${id}/${me.uid}`]: null }),

    /* ---------- Party ---------- */
    async createParty() {
      if (room) await API.leaveParty();
      const r = Math.random().toString(36).slice(2, 8).toUpperCase();
      await db.ref().update({ [`rooms/${r}/meta`]: { host: me.uid, started: false }, [`rooms/${r}/allowed/${me.uid}`]: true });
      await enter(r);
    },
    async joinParty(r) {
      if (room) await API.leaveParty();
      const m = (await db.ref(`rooms/${r}/meta`).once('value')).val();
      if (!m) throw new Error('Party sudah bubar');
      if (m.started) throw new Error('Game sudah berjalan');
      await enter(r);
    },
    // Hanya host yang bisa mengundang, dan hanya ke teman
    async invite(friendId) {
      if (!API.isHost()) throw new Error('Hanya host yang bisa mengundang');
      await db.ref().update({ [`rooms/${room}/allowed/${friendId}`]: true,
        [`invites/${friendId}/${me.uid}`]: { room, username: me.username, ts: Date.now() } });
    },
    dismissInvite: from => db.ref(`invites/${me.uid}/${from}`).remove(),
    async leaveParty() {
      if (!room) return;
      const r = room, host = API.isHost(); room = null;
      partyRefs.forEach(x => x.off()); partyRefs = []; if (stateRef) { stateRef.off(); stateRef = null; }
      const u = { [`rooms/${r}/slots/${mySlot}`]: null, [`rooms/${r}/players/${me.uid}`]: null, [`rooms/${r}/state/${me.uid}`]: null };
      if (host) u[`rooms/${r}/meta`] = null;               // host keluar = party bubar
      try { await db.ref().update(u); } catch (e) { }
      party = { meta: null, players: {} }; frozen = {}; emit('party');
    },
    // Host memulai: Killer dipilih acak jika pemain >= 2
    async start() {
      if (!API.isHost()) return;
      const ids = Object.keys(party.players);
      const killer = ids.length >= 2 ? ids[Math.floor(Math.random() * ids.length)] : null;
      await db.ref(`rooms/${room}/meta`).update({ killer, started: true });
    },
    // Slot permainan: 0 = Killer, 1..4 = Survivor (dibekukan saat game mulai)
    gslot(uid) { return uid in frozen ? frozen[uid] : calcSlot(uid); },

    /* ---------- Sinkron posisi saat game ---------- */
    watchState(fn) { stateRef = db.ref(`rooms/${room}/state`); stateRef.on('value', s => fn(s.val() || {})); },
    send(st) { if (room && me) db.ref(`rooms/${room}/state/${me.uid}`).set(st); }
  };

  function calcSlot(uid) {
    const k = party.meta && party.meta.killer; if (uid === k) return 0;
    const list = Object.keys(party.players).filter(x => x !== k).sort((a, b) => party.players[a].slot - party.players[b].slot);
    return Math.min(4, Math.max(0, list.indexOf(uid)) + 1);
  }

  // masuk ke room: rebut slot kosong pertama (transaction anti-bentrok)
  async function enter(r) {
    let slot = -1;
    for (let i = 0; i < 5 && slot < 0; i++) {
      const res = await db.ref(`rooms/${r}/slots/${i}`).transaction(c => (c ? undefined : me.uid));
      if (res.committed) { slot = i; res.snapshot.ref.onDisconnect().remove(); }
    }
    if (slot < 0) throw new Error('Party penuh (maks 5 pemain)');
    room = r; mySlot = slot; party = { meta: null, players: {} }; frozen = {};
    const pr = db.ref(`rooms/${r}/players/${me.uid}`);
    await pr.set({ name: me.username, slot }); pr.onDisconnect().remove();
    db.ref(`rooms/${r}/state/${me.uid}`).onDisconnect().remove();
    const mr = db.ref(`rooms/${r}/meta`), pl = db.ref(`rooms/${r}/players`);
    mr.on('value', s => {
      if (room !== r) return; const m = s.val();
      if (!m) { API.leaveParty(); emit('partyEnded'); return; }
      const was = party.meta && party.meta.started; party.meta = m;
      if (m.host === me.uid) mr.onDisconnect().remove();
      if (m.started && !was) { frozen = {}; Object.keys(party.players).forEach(id => frozen[id] = calcSlot(id)); emit('start'); }
      emit('party');
    });
    pl.on('value', s => { if (room === r) { party.players = s.val() || {}; emit('party'); } });
    partyRefs = [mr, pl];
  }

  // presence, daftar teman, permintaan, undangan (aktif setelah punya username)
  function startSession() {
    stopSession();
    const conn = db.ref('.info/connected');
    conn.on('value', s => { if (s.val()) { const p = db.ref('presence/' + me.uid); p.onDisconnect().remove(); p.set(true); } });
    const fr = db.ref('friends/' + me.uid);
    fr.on('value', s => {
      const ids = Object.keys(s.val() || {}); friendIds = ids;
      ids.forEach(id => {
        if (!names[id]) db.ref(`users/${id}/username`).once('value').then(x => { names[id] = x.val(); emit('friends'); });
        if (!presenceRefs[id]) { const r = db.ref('presence/' + id); r.on('value', x => { online[id] = !!x.val(); emit('friends'); }); presenceRefs[id] = r; }
      });
      Object.keys(presenceRefs).forEach(id => { if (!ids.includes(id)) { presenceRefs[id].off(); delete presenceRefs[id]; delete online[id]; } });
      emit('friends');
    });
    const rq = db.ref('friendRequests/' + me.uid);
    rq.on('value', s => emit('requests', s.val() || {}));
    const iv = db.ref('invites/' + me.uid);
    iv.on('child_added', s => { const v = s.val(); if (!v || Date.now() - v.ts > 300000) { s.ref.remove(); return; } emit('invite', s.key, v); });
    sessionRefs = [conn, fr, rq, iv];
  }
  function stopSession() {
    sessionRefs.forEach(r => r.off()); sessionRefs = [];
    Object.values(presenceRefs).forEach(r => r.off()); Object.keys(presenceRefs).forEach(k => delete presenceRefs[k]);
    friendIds = [];
    if (db && me) db.ref('presence/' + me.uid).remove().catch(() => { });
  }
  return API;
})();
