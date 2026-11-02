import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { baseNote, deleteForever, getOrCreateDaily, restoreNote, trashNote } from '../src/lib/actions';
import { importBackup } from '../src/lib/backup';
import { db } from '../src/lib/db';
import type { Note } from '../src/lib/types';

const withPdf = (fileId: string): Partial<Note> => ({
  content: { type: 'doc', content: [{ type: 'pdfAttachment', attrs: { fileId, name: 'a.pdf' } }] },
});
const pdfMeta = (id: string) => ({ id, name: 'a.pdf', size: 1, pageCount: 1, pageTexts: [''], thumb: null, encrypted: false, createdAt: 0 });
const backupFile = (notes: Note[], notebooks: unknown[] = []) =>
  new File([JSON.stringify({ format: 'clean-notes-backup', notes, notebooks, files: [], blobs: [], images: [] })], 'b.json');

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('data', () => {
  it('keeps a PDF until no note uses it', async () => {
    const a = baseNote(withPdf('f1'));
    const b = baseNote(withPdf('f1'));
    await db.notes.bulkAdd([a, b]);
    await db.files.add(pdfMeta('f1'));
    await deleteForever([a.id]);
    expect(await db.files.get('f1')).toBeDefined();
    await deleteForever([b.id]);
    expect(await db.files.get('f1')).toBeUndefined();
  });

  it('restores only copies newer than the local one, and keeps local notebook names', async () => {
    const local = baseNote({ title: 'local', updatedAt: 200 });
    await db.notes.add(local);
    await db.notebooks.add({ id: 'nb', name: 'Renamed here', createdAt: 0 });
    const older = { ...local, title: 'older', updatedAt: 100 };
    expect(await importBackup(backupFile([older], [{ id: 'nb', name: 'Old name', createdAt: 0 }]))).toMatchObject({ skipped: 1 });
    expect((await db.notes.get(local.id))?.title).toBe('local');
    expect((await db.notebooks.get('nb'))?.name).toBe('Renamed here');
    await importBackup(backupFile([{ ...local, title: 'newer', updatedAt: 300 }]));
    expect((await db.notes.get(local.id))?.title).toBe('newer');
  });

  it('carries a trashing to another device through a backup', async () => {
    const note = baseNote({ updatedAt: 100 });
    await db.notes.add(note);
    await trashNote(note.id);
    const trashed = (await db.notes.get(note.id))!;
    await db.notes.put(note);
    await importBackup(backupFile([trashed]));
    expect((await db.notes.get(note.id))?.trashedAt).not.toBeNull();
  });

  it('merges a restored daily note into the one made since', async () => {
    const old = await getOrCreateDaily('2026-01-05');
    await db.notes.update(old.id, { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] } });
    await trashNote(old.id);
    const fresh = await getOrCreateDaily('2026-01-05');
    await restoreNote(old.id);
    expect(await db.notes.get(old.id)).toBeUndefined();
    expect((await db.notes.get(fresh.id))?.text).toContain('old');
  });
});
