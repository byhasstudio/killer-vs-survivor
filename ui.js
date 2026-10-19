'use strict';
/* =====================================================================
   UI MENU: login Google -> buat username -> menu (party + teman).
   Semua data berasal dari Net (net.js); file ini hanya menggambar layar
   dan memanggil fungsi Net saat tombol ditekan.
   ===================================================================== */
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const button = (label, cls, fn) => { const b = el('button', 'btn ' + (cls || ''), label); b.onclick = fn; return b; };
  const SCREENS = ['sLogin', 'sName', 'sMenu'];
  const show = id => SCREENS.forEach(s => $(s).style.display = s === id ? 'flex' : 'none');

  // ---------- toast (notifikasi kecil) ----------
  function toast(msg, good) {
    const t = el('div', 'toast' + (good ? ' good' : ''), msg); $('toasts').append(t); setTimeout(() => t.remove(), 3800);
  }
  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || String(e)); } };

  // ---------- LAYAR LOGIN ----------
  $('btnSoloLogin').onclick = () => startGame(1, false);
  $('pSurv').onclick = () => startGame(1, false);
  $('pKill').onclick = () => startGame(0, false);
  $('btnGoogle').onclick = guard(async () => {
    $('btnGoogle').disabled = true;
    try { await Net.loginGoogle(); } finally { $('btnGoogle').disabled = false; }
  });

  // ---------- LAYAR USERNAME ----------
  $('btnName').onclick = async () => {
    $('nameErr').textContent = ''; $('btnName').disabled = true;
    try { await Net.setUsername($('nameIn').value); }
    catch (e) { $('nameErr').textContent = e.message; }
    $('btnName').disabled = false;
  };
  $('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnName').click(); });
  $('btnLogout').onclick = guard(() => Net.logout());

  // ---------- PANEL PARTY ----------
  function renderParty() {
    const b = $('partyBody'); b.replaceChildren();
    if (!Net.room) {
      b.append(el('p', 'muted', 'Belum ada party. Buat party lalu undang temanmu dari daftar teman. Hanya teman yang bisa diundang.'),
        el('div', '', ''), button('Buat Party', 'big', guard(() => Net.createParty())));
      b.lastChild.style.marginTop = '14px'; return;
    }
    const P = Net.party, meta = P.meta || {}, host = Net.isHost();
    const head = el('div', 'row'); head.append(el('span', 'muted', 'Kode party'), el('span', 'code', Net.room));
    const slots = el('div', 'slots');
    const bySlot = {}; Object.keys(P.players).forEach(id => bySlot[P.players[id].slot] = id);
    for (let i = 0; i < 5; i++) {
      const id = bySlot[i];
      if (!id) { slots.append(el('div', 'slot empty', 'Menunggu pemain...')); continue; }
      const s = el('div', 'slot'), nm = P.players[id].name || '?';
      s.append(el('div', 'av' + (id === meta.host ? '' : ' w'), nm[0].toUpperCase()), el('b', '', '@' + nm));
      if (id === meta.host) s.append(el('span', 'badge', 'HOST'));
      if (Net.me && id === Net.me.uid) s.append(el('span', 'badge w', 'KAMU'));
      slots.append(s);
    }
    const foot = el('div', 'row');
    if (host) foot.append(button('Mulai Game', 'big', guard(() => Net.start())));
    else foot.append(el('span', 'muted', 'Menunggu host memulai game...'));
    foot.append(button('Keluar Party', 'ghost', guard(() => Net.leaveParty())));
    b.append(head, slots, foot, el('p', 'muted', 'Killer dipilih acak saat game dimulai (butuh minimal 2 pemain). Maks 1 Killer + 4 Survivor.'));
    b.lastChild.style.marginTop = '12px';
  }

  // ---------- PANEL TEMAN ----------
  let tab = 'list', reqs = {};
  document.querySelectorAll('.tabs button').forEach(t => t.onclick = () => {
    tab = t.dataset.tab; document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === t)); renderFriends();
  });
  function renderFriends() {
    const b = $('friendBody'); b.replaceChildren();
    const n = Object.keys(reqs).length; $('reqBadge').textContent = n ? n : '';
    if (tab === 'list') {
      const ids = Net.friends().sort((x, y) => Net.isOnline(y) - Net.isOnline(x));
      if (!ids.length) { b.append(el('p', 'muted', 'Belum ada teman. Buka tab Tambah dan masukkan username temanmu.')); return; }
      const list = el('div', 'list');
      ids.forEach(id => {
        const r = el('div', 'fr'), nm = el('b', '', '@' + Net.nameOf(id)), on = Net.isOnline(id);
        nm.append(Object.assign(el('small', '', on ? 'Online' : 'Offline')));
        r.append(el('span', 'dot' + (on ? ' on' : '')), nm);
        if (Net.room && Net.isHost()) {
          r.append(button('Undang', 'sm', guard(async () => { await Net.invite(id); toast('Undangan dikirim ke @' + Net.nameOf(id), true); })));
          r.lastChild.disabled = !on;
        }
        r.append(button('✕', 'ghost sm', guard(async () => { if (confirm('Hapus @' + Net.nameOf(id) + ' dari teman?')) await Net.removeFriend(id); })));
        list.append(r);
      });
      b.append(list);
    } else if (tab === 'req') {
      const ids = Object.keys(reqs);
      if (!ids.length) { b.append(el('p', 'muted', 'Tidak ada permintaan pertemanan.')); return; }
      const list = el('div', 'list');
      ids.forEach(id => {
        const r = el('div', 'fr'); r.append(el('span', 'dot on'), el('b', '', '@' + (reqs[id].username || '?')));
        r.append(button('Terima', 'sm', guard(() => Net.accept(id))), button('Tolak', 'ghost sm', guard(() => Net.decline(id))));
        list.append(r);
      });
      b.append(list);
    } else {
      const inp = el('input', 'txt'); inp.placeholder = 'Username teman'; inp.maxLength = 17; inp.autocapitalize = 'off';
      const msg = el('div', 'err');
      const send = async () => {
        msg.className = 'err'; msg.textContent = '';
        try { const r = await Net.sendRequest(inp.value); msg.className = 'okm'; msg.textContent = r === 'accepted' ? 'Kalian sekarang berteman!' : 'Permintaan terkirim. Tunggu dia menerima.'; inp.value = ''; }
        catch (e) { msg.textContent = e.message; }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      b.append(inp, msg, button('Kirim Permintaan', '', send),
        el('p', 'muted', Net.me ? 'Username kamu: @' + Net.me.username : ''));
      b.lastChild.style.marginTop = '12px';
    }
  }

  // ---------- UNDANGAN MASUK ----------
  function inviteToast(from, v) {
    const t = el('div', 'toast good'); t.append(el('div', '', '@' + v.username + ' mengundangmu ke party'));
    const row = el('div', 'row');
    row.append(button('Terima', 'sm', async () => {
      t.remove(); try { await Net.dismissInvite(from); await Net.joinParty(v.room); toast('Berhasil masuk party', true); } catch (e) { toast(e.message); }
    }), button('Tolak', 'ghost sm', () => { t.remove(); Net.dismissInvite(from); }));
    t.append(row); $('toasts').append(t); setTimeout(() => t.remove(), 60000);
  }

  // ---------- HUBUNGKAN KE Net ----------
  const refresh = () => { renderParty(); renderFriends(); };
  Net.cb.auth = me => {
    if (!me) { show('sLogin'); return; }
    if (!me.username) { show('sName'); return; }
    $('meName').textContent = '@' + me.username; show('sMenu'); refresh();
  };
  Net.cb.friends = renderFriends;
  Net.cb.requests = r => { reqs = r; renderFriends(); };
  Net.cb.invite = inviteToast;
  Net.cb.party = refresh;
  Net.cb.partyEnded = () => toast('Host membubarkan party');
  Net.cb.start = () => { startGame(Net.gslot(Net.me.uid), true); Net.watchState(onPlayers); };   // game dimulai oleh host

  show('sLogin');
  if (Net.configured()) Net.init();
  else { $('cfgWarn').style.display = 'block'; $('btnGoogle').disabled = true; }
})();
