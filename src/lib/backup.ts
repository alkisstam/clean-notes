import { flushEditor } from './actions';
import { db } from './db';
import { dateKey } from './dates';
import { saveBlob } from './pdf';
import { store } from './store';
import type { Note, NoteImage, Notebook, PdfFile } from './types';

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

/** Writes a single readable JSON file holding every note, notebook, PDF and image. */
export async function exportBackup() {
  flushEditor();
  const [notes, notebooks, files, blobs, images] = await Promise.all([
    db.notes.toArray(),
    db.notebooks.toArray(),
    db.files.toArray(),
    db.blobs.toArray(),
    db.images.toArray(),
  ]);
  // Built as parts so large PDF libraries never become one giant string.
  const parts: BlobPart[] = [
    `{"format":${JSON.stringify(FORMAT)},"version":2,"exportedAt":${Date.now()},"notes":${JSON.stringify(notes)},"notebooks":${JSON.stringify(notebooks)},"files":${JSON.stringify(files)},"blobs":[`,
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
  const backup = new Blob(parts, { type: 'application/json' });
  saveBlob(backup, `clean-notes-backup-${dateKey()}.json`);
  if (backup.size > MAX_RESTORE_BYTES) {
    store.getState().showToast({
      message: `This backup is ${Math.round(backup.size / 1024 / 1024)} MB, too large to restore in one file. Keep it, and remove large PDFs to make a restorable one.`,
      sticky: true,
    });
  }
}

interface Backup {
  format: string;
  notes: Note[];
  notebooks: Notebook[];
  files: PdfFile[];
  blobs: { id: string; data: string }[];
  /** Absent from backups made before images existed. */
  images?: (Omit<NoteImage, 'blob'> & { type: string; data: string })[];
}

/** Merges a backup into this device. When both copies of a note exist, the newer wins. */
export async function importBackup(file: File): Promise<{ added: number; updated: number; skipped: number }> {
  if (file.size > MAX_RESTORE_BYTES) throw new Error('That backup is too large for this browser to restore.');
  let data: Backup;
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
  const blobs = (data.blobs ?? []).map((b) => ({ id: b.id, blob: fromBase64(b.data) }));
  const images: NoteImage[] = (data.images ?? []).map(({ data: b64, type, ...meta }) => ({
    ...meta,
    blob: fromBase64(b64, type),
  }));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  await db.transaction('rw', [db.notes, db.notebooks, db.files, db.blobs, db.images], async () => {
    // Notebooks carry no edit time, so a local rename beats the backup's name.
    const have = new Set(await db.notebooks.toCollection().primaryKeys());
    await db.notebooks.bulkAdd((data.notebooks ?? []).filter((b) => !have.has(b.id)));
    await db.files.bulkPut(data.files ?? []);
    await db.blobs.bulkPut(blobs);
    await db.images.bulkPut(images);
    for (const note of data.notes) {
      const cur = await db.notes.get(note.id);
      if (!cur) added++;
      else if (note.updatedAt > cur.updatedAt) updated++;
      else {
        skipped++;
        continue;
      }
      await db.notes.put(note);
    }
  });
  return { added, updated, skipped };
}
