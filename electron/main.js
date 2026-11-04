import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.join(import.meta.dirname, '..', 'dist');

// pdf.js fetches its worker and cmaps, which fails on file://. A secure custom scheme also gives IndexedDB a stable origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
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

app.on('window-all-closed', () => app.quit());
