import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.join(import.meta.dirname, '..', 'dist');

// pdf.js fetches its worker and cmaps, which fails on file://. A secure custom scheme also gives IndexedDB a stable origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// The sync server's address, kept outside the page so its requests can be forwarded from the first launch on.
const serverFile = () => path.join(app.getPath('userData'), 'sync-server.txt');
let server = '';

// Reminders only fire while the page runs, so by default closing the window leaves the app in the tray.
const prefsFile = () => path.join(app.getPath('userData'), 'desktop.json');
let prefs = { background: true };
const autostartFile = () => path.join(app.getPath('appData'), 'autostart', 'sheaf-notes.desktop');
let win = null;
let tray = null;
let quitting = false;

// A second launch, from the menu or at login, shows the running window instead of opening another.
if (!app.requestSingleInstanceLock()) app.exit();
app.on('second-instance', () => showWindow());

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function setTray(on) {
  if (on && !tray) {
    tray = new Tray(path.join(dist, 'icons', 'icon-192.png'));
    tray.setToolTip('Sheaf Notes');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Sheaf Notes', click: showWindow },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } else if (!on && tray) {
    tray.destroy();
    tray = null;
  }
}

// Linux has no login item API, so start at login is a desktop entry in ~/.config/autostart. It starts hidden, in the tray.
function autostart() {
  if (process.platform !== 'linux') return app.getLoginItemSettings().openAtLogin;
  return fs.existsSync(autostartFile());
}
function setAutostart(on) {
  if (process.platform !== 'linux') return app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  if (!on) return fs.rmSync(autostartFile(), { force: true });
  // An AppImage runs from a temporary mount, so its own file is what starts it again.
  const exe = process.env.APPIMAGE || process.execPath;
  fs.mkdirSync(path.dirname(autostartFile()), { recursive: true });
  fs.writeFileSync(autostartFile(), `[Desktop Entry]\nType=Application\nName=Sheaf Notes\nExec="${exe}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
}

app.whenReady().then(() => {
  try {
    server = fs.readFileSync(serverFile(), 'utf8').trim();
  } catch {}
  try {
    prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) };
  } catch {}
  ipcMain.handle('desktop-prefs', () => ({ background: prefs.background, autostart: autostart() }));
  ipcMain.handle('set-desktop-prefs', (_e, next) => {
    if (typeof next.background === 'boolean') {
      prefs.background = next.background;
      fs.writeFileSync(prefsFile(), JSON.stringify(prefs));
      setTray(prefs.background);
    }
    if (typeof next.autostart === 'boolean') setAutostart(next.autostart);
  });
  ipcMain.on('show-window', showWindow);
  // Electron's notifications have no buttons on Linux; notify-send waits and prints the action picked, or nothing.
  ipcMain.handle('notify', (_e, { title, body }) => {
    if (process.platform !== 'linux') throw new Error('Linux only');
    const args = ['-a', 'Sheaf Notes', '-i', path.join(dist, 'icons', 'icon-192.png'), '-A', 'default=Open', '-A', 'done=Done', '-A', 'dismiss=Dismiss', '--', String(title), String(body)];
    return new Promise((resolve, reject) => execFile('notify-send', args, (err, out) => (err ? reject(err) : resolve(out.trim()))));
  });
  ipcMain.handle('sync-server', () => server);
  ipcMain.handle('set-sync-server', (_e, url) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('The server address must start with https://');
    server = new URL(u.pathname.endsWith('/') ? u.href : u.href + '/').href;
    fs.writeFileSync(serverFile(), server);
  });

  protocol.handle('app', (req) => {
    const { pathname, search } = new URL(req.url);
    // The page syncs with ./api like the web app; here that means the server set in Settings, which also avoids CORS.
    if (pathname.startsWith('/api/')) {
      if (!server) return new Response(null, { status: 404 });
      return net.fetch(new URL(pathname.slice(1) + search, server).href, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        duplex: 'half',
      });
    }
    const file = path.join(dist, decodeURIComponent(new URL(req.url).pathname));
    if (!file.startsWith(dist + path.sep)) return new Response(null, { status: 403 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response(null, { status: 404 }));
  });

  // Electron forgets file grants on restart, which pauses auto-backup. Only bundled code runs here, so grant checks.
  session.defaultSession.setPermissionCheckHandler((_wc, _perm, origin) => origin.startsWith('app://'));

  win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: !process.argv.includes('--hidden'),
    autoHideMenuBar: true,
    icon: path.join(dist, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel):/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // A dropped link or file would otherwise load in this window with the desktop bridge.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  // The page draws the menu so it matches the app; it asks back here for the edit itself.
  win.webContents.on('context-menu', (_e, p) => {
    if (p.isEditable) win.webContents.send('edit-menu', { x: p.x, y: p.y, flags: p.editFlags });
  });
  win.on('close', (e) => {
    if (prefs.background && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  setTray(prefs.background);
  void win.loadURL('app://notes/index.html');
});

app.on('before-quit', () => (quitting = true));

const roles = new Set(['cut', 'copy', 'paste', 'undo', 'redo', 'selectAll']);
ipcMain.on('edit', (e, role) => {
  if (roles.has(role)) e.sender[role]();
});

// A temp file, not a data: URL, because notes with images pass Chromium's URL size limit.
async function renderPdf(html) {
  const tmp = path.join(app.getPath('temp'), `clean-notes-${randomUUID()}.html`);
  const hidden = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    fs.writeFileSync(tmp, html, { mode: 0o600 });
    await hidden.loadFile(tmp);
    return await hidden.webContents.printToPDF({ printBackground: true });
  } finally {
    hidden.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

ipcMain.handle('print-pdf', async (e, html, name) => {
  const pdf = await renderPdf(html);
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: name,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, pdf);
  return true;
});

// Linux has no share sheet, so the file is left where the user can drag it into any app.
function revealShared(bytes, name) {
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'clean-notes-share-'));
  const file = path.join(dir, path.basename(String(name)));
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  shell.showItemInFolder(file);
}

ipcMain.handle('share-pdf', async (_e, html, name) => revealShared(await renderPdf(html), name));
ipcMain.handle('share-file', (_e, bytes, name) => revealShared(Buffer.from(bytes), name));

app.on('window-all-closed', () => {
  if (!prefs.background) app.quit();
});
