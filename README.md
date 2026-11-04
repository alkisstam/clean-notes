# Clean Notes

A local-first note-taking PWA with a three-column interface: notebooks, nested tags, daily notes, tasks, a rich-text editor with slash commands, images, and PDFs you can attach, read and search. Notes, images and PDFs are stored in the browser's IndexedDB. There is no account. An optional self-hosted server syncs devices (see [Sync](#sync)).

## Run it

```bash
npm install
npm run dev       # development, at http://localhost:5173
npm run build     # production build, in dist/
npm run preview   # serve that build, with the service worker, at http://localhost:4173
```

## Deploy it

`dist/` is plain static files, and asset paths are relative, so it works at a domain root or in a sub-folder. Installing and offline use need HTTPS (`localhost` also counts). Serve `sw.js` with `Cache-Control: no-cache` so updates reach people promptly. Existing users then see a "new version" prompt.

`./deploy.sh` builds and uploads the app to the Hetzner box (the `tkdraw` host in `~/.ssh/config`), copies `server/sync.mjs` there and restarts the sync service.

## Desktop app (Linux AppImage)

`npm run appimage` builds `release/Clean Notes-<version>.AppImage`, an Electron window around the bundled app (`electron/main.js`). Make it executable (`chmod +x`) and run it; Gear Lever or AppImageLauncher can add it to the app menu. It works fully offline and keeps its own data in `~/.config/Clean Notes`, separate from any browser copy. The desktop build has no server sync and no service worker; to share notes with other devices, use **Auto-backup to a file** in a cloud folder. To update, build and replace the AppImage.

## How it fits together

| Area | Where | Notes |
| --- | --- | --- |
| Data | `src/lib/db.ts`, `actions.ts` | Dexie tables: `notes`, `notebooks`, `files` (PDF metadata and text), `blobs` (PDF bytes), `images` (original image files) |
| Saving | `src/editor/NoteEditor.tsx`, `journalEdit` in `actions.ts` | Debounced to IndexedDB. Edits pending when a page closes also go to a synchronous localStorage journal, applied on next launch |
| Tags | `src/lib/tags.ts` | A tag is a path, such as `work/clients/acme`. The tree is derived from the notes |
| Tasks | `src/lib/tasks.ts`, `src/editor/TaskItemDue.ts` | The document is the source of truth. Tasks are read from `taskItem` nodes, each with a stable id and optional due date |
| Slash commands | `src/editor/slash.ts` | Add a command by adding one entry to `slashItems` |
| PDFs | `src/lib/pdf.ts`, `src/components/PdfViewer.tsx` | pdf.js. Text is extracted on import so global search can reach it. Its data files are copied to `public/pdfjs` at build time for offline use |
| Images | `src/lib/images.ts`, `src/editor/ImageBlock.tsx` | A block that points to a stored file, with its display width as a percentage of the column |
| Theme | `src/styles/tokens.css` | All colours are variables, with one block each for light and dark |
| Backup and merge | `src/lib/backup.ts` | `buildBackup` writes the JSON file. `mergeSnapshot` is the one merge used by restore, auto-backup and sync |
| Sync | `src/lib/sync.ts`, `server/sync.mjs` | A write hook in `db.ts` schedules a run about a minute after changes. Each run pulls the backup file, syncs with the server, then rewrites the file if anything changed |

## Backups

Settings → **Your data**:

- **Export backup** downloads one readable JSON file with every note, notebook, PDF and image (base64).
- **Restore backup** merges a backup into this device. For each note and notebook the newer edit wins, and a delete counts as an edit, so a note deleted since the backup was made stays deleted.
- **Auto-backup to a file** (desktop Chrome and Edge only) asks for a file once, then rewrites it about a minute after each change. After a reload, the browser asks you to allow access again: click **Resume** on the message that appears. In an installed app, Chrome can remember the permission.

Backups larger than about 500 MB cannot be restored in one go. The app warns you when a backup gets that big.

### Sync through a cloud folder

Put the auto-backup file in a Dropbox, Google Drive or Syncthing folder. On each other computer, choose **Auto-backup to a file** and pick the same file. Each computer merges the file before rewriting it, so changes from all of them end up in every copy. This only works in desktop Chrome and Edge.

## Sync

Server sync works in every browser, phones included. It needs the app opened from the server that runs the sync service, because the app calls `./api/` on its own address.

**On each device:** Settings → **Sync**, paste the sync token, then **Turn on sync**. After that, changes sync about a minute after you make them and whenever you come back to the app. **Sync now** runs a sync straight away. **Turn off** stops sync on that device and keeps its data.

**How conflicts are settled:** per note and notebook, the newer edit wins, judged by each device's clock. If one note is edited on two devices while both are offline, the older edit is lost. Notes in the Trash sync with their content, so Trash can be undone on every device.

**What the server keeps:** the latest version of every note and notebook, plus PDF and image files. Notes deleted forever leave only a tombstone (the id and delete time). PDFs and images that no note uses are removed after each sync. Data goes to the server over HTTPS and is stored unencrypted there.

**Using both auto-backup and sync:** that works. Changes made on a computer that only uses the file reach the server through any device that uses both.

### Server setup

The server is `server/sync.mjs`, written with Node's standard library only, for a single user. It needs Node 22 or later.

```bash
apt install nodejs
mkdir -p /opt/clean-notes-sync && cp server/sync.mjs /opt/clean-notes-sync/
umask 077 && echo "SYNC_TOKEN=$(openssl rand -hex 24)" > /etc/clean-notes-sync.env
cp server/clean-notes-sync.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now clean-notes-sync
```

Add the block from `server/nginx-location.conf` to the app's nginx `server` block, then run `nginx -t && systemctl reload nginx`. To see the token: `sed -n 's/^SYNC_TOKEN=//p' /etc/clean-notes-sync.env`. To change it, edit that file and run `systemctl restart clean-notes-sync`. Then, on each device, choose **Turn off**, paste the new token and choose **Turn on sync**.

Data lives in `/var/lib/clean-notes` (systemd keeps it at `/var/lib/private/clean-notes`): `records.json` plus a `blobs/` folder. To back it up:

```bash
tar -czf /root/clean-notes-data-$(date +%F).tar.gz -C /var/lib/private/clean-notes .
```

To restore it, run `systemctl stop clean-notes-sync`, unpack the archive into that folder, then run `systemctl start clean-notes-sync`. Every device also keeps a full copy of its data. If the server's data is lost, choose **Turn off** and then **Turn on sync** on one device that has everything. Turning sync on sends all of that device's data to the server.

## Tests

```bash
npm test                 # unit tests, including merge and client-to-server sync
node --test server/      # sync server tests
npm i -D playwright      # once, for the end-to-end check
npm run build && npx vite preview --port 4173 &
node e2e/smoke.cjs       # add a directory to save screenshots there
```
