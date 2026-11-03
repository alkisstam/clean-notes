import { flushEditor } from './actions';
import { imageIdsIn, pdfIdsIn } from './doc';
import { mergeSnapshot, pullFromFile, pushToFile } from './backup';
import { db, getMeta, setMeta, writeListeners } from './db';
import { store } from './store';
import type { Note, NoteImage, Notebook, PdfBlob, PdfFile, Tombstone } from './types';

interface SyncRecord {
  table: 'notes' | 'notebooks' | 'tombstones' | 'files' | 'images';
  id: string;
  time: number;
  data: unknown;
}

class SyncError extends Error {}

/** Same server as the app, at ./api. Off until a token is saved. */
async function api(path: string, init: RequestInit = {}) {
  const token = await getMeta<string>('syncToken');
  const res = await fetch(`api/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  if (res.status === 401) throw new SyncError('The sync server did not accept the token.');
  if (!res.ok && res.status !== 404) throw new SyncError(`The sync server answered ${res.status}.`);
  return res;
}

async function uploadBlob(id: string, blob: Blob | undefined) {
  if (!blob || (await api(`blob/${id}`, { method: 'HEAD' })).ok) return;
  await api(`blob/${id}`, { method: 'PUT', body: blob });
}

async function downloadBlob(id: string, type: string): Promise<Blob | null> {
  const res = await api(`blob/${id}`);
  return res.ok ? new Blob([await res.blob()], { type }) : null;
}

/** Sends what changed here since the last sync and merges what other devices sent. */
async function serverSync(): Promise<boolean> {
  if (!(await getMeta<string>('syncToken'))) return false;
  const since = (await getMeta<number>('serverSeq')) ?? 0;
  const pushFrom = (await getMeta<number>('lastPushAt')) ?? 0;
  const startedAt = Date.now();
  flushEditor();
  const [notes, notebooks, tombstones, files, images] = await Promise.all([
    db.notes.where('updatedAt').above(pushFrom).toArray(),
    db.notebooks.filter((nb) => (nb.updatedAt ?? nb.createdAt) > pushFrom).toArray(),
    db.tombstones.filter((t) => t.deletedAt > pushFrom).toArray(),
    db.files.where('createdAt').above(pushFrom).toArray(),
    db.images.filter((i) => i.createdAt > pushFrom).toArray(),
  ]);
  // The server drops PDFs and images no note uses, so send each pushed note's own along with it, in case they were dropped.
  const has = new Set([...files, ...images].map((f) => f.id));
  const fileIds = [...new Set(notes.flatMap((n) => pdfIdsIn(n.content)))].filter((id) => !has.has(id));
  const imageIds = [...new Set(notes.flatMap((n) => imageIdsIn(n.content)))].filter((id) => !has.has(id));
  files.push(...(await db.files.bulkGet(fileIds)).filter((f) => !!f));
  images.push(...(await db.images.bulkGet(imageIds)).filter((i) => !!i));
  // Bytes go first, so no device ever sees a file record whose bytes are missing.
  for (const f of files) await uploadBlob(f.id, (await db.blobs.get(f.id))?.blob);
  for (const i of images) await uploadBlob(i.id, i.blob);
  const records: SyncRecord[] = [
    ...notes.map((n) => ({ table: 'notes' as const, id: n.id, time: n.updatedAt, data: n })),
    ...notebooks.map((nb) => ({ table: 'notebooks' as const, id: nb.id, time: nb.updatedAt ?? nb.createdAt, data: nb })),
    ...tombstones.map((t) => ({ table: 'tombstones' as const, id: t.id, time: t.deletedAt, data: t })),
    ...files.map((f) => ({ table: 'files' as const, id: f.id, time: f.createdAt, data: f })),
    ...images.map(({ blob, ...meta }) => ({ table: 'images' as const, id: meta.id, time: meta.createdAt, data: { ...meta, type: blob.type } })),
  ];
  const res = await api('sync', { method: 'POST', body: JSON.stringify({ since, records }) });
  const { seq, records: incoming } = (await res.json()) as { seq: number; records: SyncRecord[] };

  const rows = <T>(table: SyncRecord['table']) => incoming.filter((r) => r.table === table).map((r) => r.data as T);
  const haveFiles = new Set(await db.files.toCollection().primaryKeys());
  const haveImages = new Set(await db.images.toCollection().primaryKeys());
  const newFiles: PdfFile[] = [];
  const blobs: PdfBlob[] = [];
  for (const f of rows<PdfFile>('files').filter((f) => !haveFiles.has(f.id))) {
    const blob = await downloadBlob(f.id, 'application/pdf');
    if (!blob) continue;
    newFiles.push(f);
    blobs.push({ id: f.id, blob });
  }
  const newImages: NoteImage[] = [];
  for (const { type, ...meta } of rows<Omit<NoteImage, 'blob'> & { type: string }>('images').filter((i) => !haveImages.has(i.id))) {
    const blob = await downloadBlob(meta.id, type);
    if (blob) newImages.push({ ...meta, blob });
  }
  const r = await mergeSnapshot({
    notes: rows<Note>('notes'),
    notebooks: rows<Notebook>('notebooks'),
    tombstones: rows<Tombstone>('tombstones'),
    files: newFiles,
    blobs,
    images: newImages,
  });
  await setMeta('serverSeq', seq);
  // A restore or file merge during this sync may have moved the marker back; keep that.
  if (((await getMeta<number>('lastPushAt')) ?? 0) >= pushFrom) await setMeta('lastPushAt', startedAt);
  await setMeta('syncedAt', Date.now());
  return r.added + r.updated + r.deleted > 0;
}

export async function enableServerSync(token: string) {
  await setMeta('syncToken', token.trim());
  await Promise.all([setMeta('serverSeq', 0), setMeta('lastPushAt', 0)]);
  await syncNow();
}

export const disableServerSync = () =>
  Promise.all(['syncToken', 'serverSeq', 'lastPushAt', 'syncedAt'].map((k) => setMeta(k, undefined)));

const DELAY = 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let running: Promise<void> | null = null;
let again = false;

writeListeners.add(() => {
  dirty = true;
  // Counted from the first change, so steady typing cannot put the backup off forever.
  timer ??= setTimeout(() => void syncNow(), DELAY);
});

/** Pulls from the backup file and the sync server, then writes the file back if anything changed. `force` writes regardless. */
export function syncNow(force = false): Promise<void> {
  if (force) dirty = true;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      let changed = await step('Auto-backup', () => pullFromFile(() => void syncNow(true)));
      // Writes made by the file merge are already in what gets pushed, so they need no second round.
      changed ||= dirty;
      dirty = false;
      clearTimeout(timer);
      timer = undefined;
      if (await step('Sync', serverSync)) changed = true;
      if (changed) await step('Auto-backup', () => pushToFile(() => void syncNow(true)).then(() => false));
    } finally {
      running = null;
      if (again) {
        again = false;
        void syncNow();
      }
    }
  })();
  return running;
}

async function step(what: string, run: () => Promise<boolean>): Promise<boolean> {
  try {
    return await run();
  } catch (err) {
    console.error(err);
    dirty = true;
    // A plain network failure, as on a phone that is offline, is retried quietly on the next change or focus.
    if (!(err instanceof TypeError)) {
      const detail = err instanceof SyncError ? ` ${err.message}` : '';
      store.getState().showToast({ message: `${what} failed.${detail} It will try again after the next change.` });
    }
    return false;
  }
}

export function startAutoSync() {
  void syncNow();
  window.addEventListener('focus', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) void syncNow();
  });
}
