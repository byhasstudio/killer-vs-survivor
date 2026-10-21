'use strict';
// Pembungkus desktop (Electron): memuat game dari GitHub Pages supaya login Firebase
// (domain resmi) dan konten (game.js dkk) otomatis ter-update tiap dibuka.
// Jika offline / halaman belum ada -> pakai salinan lokal (app/).
const { app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const SITE = 'https://byhasstudio.github.io/killer-vs-survivor/';

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 720, backgroundColor: '#0b0b0d', autoHideMenuBar: true, title: 'Killer VS Survivor' });
  const local = () => win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && url.startsWith('http')) local(); });
  win.webContents.on('did-navigate', (e, url, code) => { if (url.startsWith('http') && code >= 400) local(); });
  win.loadURL(SITE);
}

app.whenReady().then(() => {
  createWindow();
  // Konten game sudah otomatis ter-update sendiri (dimuat live dari GitHub Pages).
  // Ini untuk update "cangkang" Electron itu sendiri: cek rilis baru & pasang otomatis di background.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
app.on('window-all-closed', () => app.quit());
