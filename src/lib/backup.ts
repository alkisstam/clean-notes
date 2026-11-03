import { collectOrphanFiles, flushEditor } from './actions';
import { db, getMeta, setMeta } from './db';
import { dateKey } from './dates';
import { saveBlob } from './pdf';
import { store } from './store';
import type { Note, NoteImage, Notebook, PdfBlob, PdfFile, Tombstone } from './types';

const FORMAT = 'clean-notes-backup';
// Restore reads the file as one string, and Chrome strings stop at about 512 million characters.
const MAX_RESTORE_BYTES = 500 * 1024 * 1024;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function fromBase64(b64: string, type = 'application/pdf'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** A single readable JSON file holding every note, notebook, PDF and image. */
export async function buildBackup(): Promise<Blob> {
  flushEditor();
  const [notes, notebooks, files, blobs, images, tombstones] = await Promise.all([
    db.notes.toArray(),
    db.notebooks.toArray(),
    db.files.toArray(),
    db.blobs.toArray(),
    db.images.toArray(),
    db.tombstones.toArray(),
  ]);
  // Built as parts so large PDF libraries never become one giant string.
  const parts: BlobPart[] = [
    `{"format":${JSON.stringify(FORMAT)},"version":3,"exportedAt":${Date.now()},"notes":${JSON.stringify(notes)},"notebooks":${JSON.stringify(notebooks)},"tombstones":${JSON.stringify(tombstones)},"files":${JSON.stringify(files)},"blobs":[`,
  ];
  for (let i = 0; i < blobs.length; i++) {
    parts.push(`${i ? ',' : ''}{"id":${JSON.stringify(blobs[i].id)},"data":"`, await toBase64(blobs[i].blob), '"}');
  }
  parts.push('],"images":[');
  for (let i = 0; i < images.length; i++) {
    const { blob, ...meta } = images[i];
    parts.push(`${i ? ',' : ''}${JSON.stringify({ ...meta, type: blob.type })}`.slice(0, -1), ',"data":"', await toBase64(blob), '"}');
  }
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

const warnIfTooLarge = (size: number) => {
  if (size <= MAX_RESTORE_BYTES) return;
  store.getState().showToast({
    message: `This backup is ${Math.round(size / 1024 / 1024)} MB, too large to restore in one file. Keep it, and remove large PDFs to make a restorable one.`,
    sticky: true,
  });
};

export async function exportBackup() {
  const backup = await buildBackup();
  saveBlob(backup, `clean-notes-backup-${dateKey()}.json`);
  warnIfTooLarge(backup.size);
}

export interface Snapshot {
  notes: Note[];
  notebooks?: Notebook[];
  /** Absent from backups made before sync existed. */
  tombstones?: Tombstone[];
  files?: PdfFile[];
  blobs?: PdfBlob[];
  images?: NoteImage[];
}

export interface MergeResult {
  added: number;
  updated: number;
  skipped: number;
  deleted: number;
}

const editTime = (row: Note | Notebook) => row.updatedAt ?? row.createdAt;

/** Merges another device's data into this one. Per row the newer edit wins, and a delete counts as an edit. */
export async function mergeSnapshot(data: Snapshot): Promise<MergeResult> {
  const r: MergeResult = { added: 0, updated: 0, skipped: 0, deleted: 0 };
  await db.transaction('rw', [db.notes, db.notebooks, db.files, db.blobs, db.images, db.tombstones], async () => {
    const dead = new Map((await db.tombstones.toArray()).map((t) => [t.id, t]));
    const diedAt = (id: string) => dead.get(id)?.deletedAt ?? -1;
    const incoming = (data.tombstones ?? []).filter((t) => t.deletedAt > diedAt(t.id));
    await db.tombstones.bulkPut(incoming);
    incoming.forEach((t) => dead.set(t.id, t));
    const alive = (row: Note | Notebook) => diedAt(row.id) < editTime(row);

    for (const nb of data.notebooks ?? []) {
      if (!alive(nb)) continue;
      const cur = await db.notebooks.get(nb.id);
      if (!cur || editTime(nb) > editTime(cur)) await db.notebooks.put(nb);
    }
    await db.files.bulkPut(data.files ?? []);
    await db.blobs.bulkPut(data.blobs ?? []);
    await db.images.bulkPut(data.images ?? []);
    for (const note of data.notes) {
      const cur = await db.notes.get(note.id);
      if (!alive(note) || (cur && note.updatedAt <= cur.updatedAt)) {
        r.skipped++;
        continue;
      }
      if (cur) r.updated++;
      else r.added++;
      await db.notes.put(note);
    }
    for (const t of incoming) {
      const table = t.table === 'notes' ? db.notes : db.notebooks;
      const cur = await table.get(t.id);
      if (cur && !alive(cur)) {
        await table.delete(t.id);
        r.deleted++;
      }
    }
  });
  if (r.deleted) await collectOrphanFiles();
  return r;
}

interface BackupFile {
  format: string;
  notes: Note[];
  notebooks: Notebook[];
  tombstones?: Tombstone[];
  files: PdfFile[];
  blobs: { id: string; data: string }[];
  /** Absent from backups made before images existed. */
  images?: (Omit<NoteImage, 'blob'> & { type: string; data: string })[];
}

/** Merges a backup file into this device. */
export async function importBackup(file: File): Promise<MergeResult> {
  if (file.size > MAX_RESTORE_BYTES) throw new Error('That backup is too large for this browser to restore.');
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const validNote = (n: Note) =>
    typeof n?.id === 'string' && n.content?.type === 'doc' && Array.isArray(n.tags) && typeof n.updatedAt === 'number';
  if (data?.format !== FORMAT || !Array.isArray(data.notes) || !data.notes.every(validNote)) {
    throw new Error('That file is not a Clean Notes backup.');
  }
  return mergeSnapshot({
    notes: data.notes,
    notebooks: data.notebooks,
    tombstones: data.tombstones,
    files: data.files,
    blobs: (data.blobs ?? []).map((b) => ({ id: b.id, blob: fromBase64(b.data) })),
    images: (data.images ?? []).map(({ data: b64, type, ...meta }) => ({ ...meta, blob: fromBase64(b64, type) })),
  });
}

// File System Access API, Chromium desktop only. Its permission methods are missing from TypeScript's DOM types.
type BackupHandle = FileSystemFileHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
};

export const autoBackupSupported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/** Asks for the file to keep updated. Choosing an existing backup, like one in a shared cloud folder, merges it first. */
export async function chooseBackupFile() {
  const picker = (window as unknown as { showSaveFilePicker(o: object): Promise<BackupHandle> }).showSaveFilePicker;
  const handle = await picker({
    suggestedName: 'clean-notes-backup.json',
    types: [{ description: 'Clean Notes backup', accept: { 'application/json': ['.json'] } }],
  });
  await setMeta('backupFile', handle);
  await setMeta('backupWrittenAt', 0);
}

export const stopAutoBackup = () => Promise.all([setMeta('backupFile', undefined), setMeta('backupWrittenAt', undefined)]);

let askedToResume = false;

/** The handle, if this tab may write to it. After a reload the browser wants a click before granting that again. */
async function backupHandle(onResume: () => void): Promise<BackupHandle | null> {
  const handle = await getMeta<BackupHandle>('backupFile');
  if (!handle) return null;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return handle;
  if (!askedToResume) {
    askedToResume = true;
    store.getState().showToast({
      message: 'Auto-backup is paused until you allow access to the file again.',
      sticky: true,
      action: {
        label: 'Resume',
        run: () => void handle.requestPermission({ mode: 'readwrite' }).then((p) => p === 'granted' && onResume()),
      },
    });
  }
  return null;
}

/** Merges the file if another device changed it since this one last wrote it. */
export async function pullFromFile(onResume: () => void): Promise<boolean> {
  const handle = await backupHandle(onResume);
  if (!handle) return false;
  const file = await handle.getFile();
  if (!file.size || file.lastModified <= ((await getMeta<number>('backupWrittenAt')) ?? 0)) return false;
  const r = await importBackup(file);
  return r.added + r.updated + r.deleted > 0;
}

export async function pushToFile(onResume: () => void) {
  const handle = await backupHandle(onResume);
  if (!handle) return;
  const backup = await buildBackup();
  const w = await handle.createWritable();
  await w.write(backup);
  await w.close();
  await setMeta('backupWrittenAt', (await handle.getFile()).lastModified);
  await setMeta('backupWrittenTime', Date.now());
  if (!warnedLarge && backup.size > MAX_RESTORE_BYTES) {
    warnedLarge = true;
    warnIfTooLarge(backup.size);
  }
}

let warnedLarge = false;
