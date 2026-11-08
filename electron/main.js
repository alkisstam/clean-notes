import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
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

app.whenReady().then(() => {
  try {
    server = fs.readFileSync(serverFile(), 'utf8').trim();
  } catch {}
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
  session.defaultSession.setPermissionCheckHandler(() => true);

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    autoHideMenuBar: true,
    icon: path.join(dist, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The page draws the menu so it matches the app; it asks back here for the edit itself.
  win.webContents.on('context-menu', (_e, p) => {
    if (p.isEditable) win.webContents.send('edit-menu', { x: p.x, y: p.y, flags: p.editFlags });
  });
  void win.loadURL('app://notes/index.html');
});

const roles = new Set(['cut', 'copy', 'paste', 'undo', 'redo', 'selectAll']);
ipcMain.on('edit', (e, role) => {
  if (roles.has(role)) e.sender[role]();
});

// A temp file, not a data: URL, because notes with images pass Chromium's URL size limit.
ipcMain.handle('print-pdf', async (e, html, name) => {
  const tmp = path.join(app.getPath('temp'), `clean-notes-${randomUUID()}.html`);
  const hidden = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    fs.writeFileSync(tmp, html, { mode: 0o600 });
    await hidden.loadFile(tmp);
    const pdf = await hidden.webContents.printToPDF({ printBackground: true });
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      defaultPath: name,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, pdf);
    return true;
  } finally {
    hidden.destroy();
    fs.rmSync(tmp, { force: true });
  }
});

app.on('window-all-closed', () => app.quit());
