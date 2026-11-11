import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseNote, changeTags, patchNotes, trashNotes, deleteForever, deleteNotebook, getOrCreateDaily, journalEdit, nestNote, recoverJournal, renameNotebook, restoreNote, trashNote } from '../src/lib/actions';
import { importBackup, mergeSnapshot } from '../src/lib/backup';
import { db } from '../src/lib/db';
import { store } from '../src/lib/store';
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
  it('walks note history back and forward, skipping trashed notes', async () => {
    const [a, b, c] = [baseNote(), baseNote(), baseNote({ trashedAt: 1 })];
    await db.notes.bulkAdd([a, b, c]);
    const s = store.getState;
    s().openNote(null);
    store.setState({ back: [], fwd: [] });
    s().openNote(a.id);
    s().openNote(c.id);
    s().openNote(b.id);
    await s().travel('back');
    expect(s().noteId).toBe(a.id);
    expect(s().back).toEqual([]);
    await s().travel('fwd');
    expect(s().noteId).toBe(b.id);
    s().openNote(a.id);
    expect(s().fwd).toEqual([]);
  });

  it('trashes several notes with one Undo that restores them all', async () => {
    const a = baseNote();
    const b = baseNote();
    await db.notes.bulkAdd([a, b]);
    await trashNotes([a.id, b.id]);
    expect((await db.notes.get(a.id))?.trashedAt).toBeTruthy();
    expect(store.getState().toast?.message).toBe('2 notes moved to Trash');
    store.getState().toast!.action!.run();
    await vi.waitFor(async () => expect((await db.notes.bulkGet([a.id, b.id])).every((n) => !n?.trashedAt)).toBe(true));
  });

  it('patches only the given notes and bumps their updatedAt', async () => {
    const a = baseNote({ updatedAt: 1 });
    const b = baseNote({ updatedAt: 1 });
    await db.notes.bulkAdd([a, b]);
    await patchNotes([a.id], { notebookId: 'nb' });
    expect((await db.notes.get(a.id))?.notebookId).toBe('nb');
    expect((await db.notes.get(a.id))?.updatedAt).toBeGreaterThan(1);
    expect((await db.notes.get(b.id))?.notebookId).toBeNull();
  });

  it('adds and removes tags on every note and leaves the others alone', async () => {
    const a = baseNote({ tags: ['x', 'keep'] });
    const b = baseNote({ tags: ['x', 'new'] });
    await db.notes.bulkAdd([a, b]);
    await changeTags([a.id, b.id], ['new'], ['x']);
    expect((await db.notes.get(a.id))?.tags).toEqual(['keep', 'new']);
    expect((await db.notes.get(b.id))?.tags).toEqual(['new']);
  });

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

  it('keeps a just-added PDF whose note has not saved yet', async () => {
    const a = baseNote();
    await db.notes.add(a);
    await db.files.add({ ...pdfMeta('fresh'), createdAt: Date.now() });
    await deleteForever([a.id]);
    expect(await db.files.get('fresh')).toBeDefined();
  });

  it('recovers journaled edits on launch, unless the note was edited later', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
      removeItem: (k: string) => mem.delete(k),
    });
    const stale = baseNote({ title: 'old', updatedAt: 100 });
    const newer = baseNote({ title: 'kept', updatedAt: Date.now() + 60_000 });
    await db.notes.bulkAdd([stale, newer]);
    journalEdit(stale.id, { title: 'from journal' });
    journalEdit(newer.id, { title: 'lost' });
    await recoverJournal();
    expect((await db.notes.get(stale.id))?.title).toBe('from journal');
    expect((await db.notes.get(newer.id))?.title).toBe('kept');
    expect(mem.size).toBe(0);
    vi.unstubAllGlobals();
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

  it('carries a delete to another device, unless that device edited the note later', async () => {
    const gone = baseNote({ updatedAt: 100 });
    const edited = baseNote({ updatedAt: 100 });
    await db.notes.bulkAdd([gone, edited]);
    await deleteForever([gone.id, edited.id]);
    const tombstones = await db.tombstones.toArray();
    expect(tombstones).toHaveLength(2);
    await db.tombstones.clear();
    await db.notes.bulkAdd([gone, { ...edited, updatedAt: Date.now() + 10_000 }]);
    expect(await mergeSnapshot({ notes: [], tombstones })).toMatchObject({ deleted: 1 });
    expect(await db.notes.get(gone.id)).toBeUndefined();
    expect(await db.notes.get(edited.id)).toBeDefined();
    // The deleted note in an old backup must not come back.
    await mergeSnapshot({ notes: [gone] });
    expect(await db.notes.get(gone.id)).toBeUndefined();
  });

  it('merges notebook renames and deletes by edit time', async () => {
    await db.notebooks.add({ id: 'nb', name: 'Old', createdAt: 0 });
    await renameNotebook('nb', 'New');
    const renamed = (await db.notebooks.get('nb'))!;
    await db.notebooks.put({ id: 'nb', name: 'Old', createdAt: 0 });
    await mergeSnapshot({ notes: [], notebooks: [renamed] });
    expect((await db.notebooks.get('nb'))?.name).toBe('New');
    await deleteNotebook('nb');
    const tombstones = await db.tombstones.toArray();
    await db.tombstones.clear();
    await db.notebooks.put(renamed);
    await mergeSnapshot({ notes: [], tombstones });
    expect(await db.notebooks.get('nb')).toBeUndefined();
  });
});

describe('nestNote', () => {
  it('moves a note and its sub-notes under another note and its notebook', async () => {
    const a = baseNote({ notebookId: 'x' });
    const b = baseNote({ notebookId: 'y' });
    const c = baseNote({ notebookId: 'y', parentId: b.id });
    await db.notes.bulkAdd([a, b, c]);
    await nestNote(b.id, a.id);
    expect(await db.notes.get(b.id)).toMatchObject({ parentId: a.id, notebookId: 'x' });
    expect(await db.notes.get(c.id)).toMatchObject({ parentId: b.id, notebookId: 'x' });
  });
  it('refuses to put a note inside its own sub-note', async () => {
    const a = baseNote();
    const b = baseNote({ parentId: a.id });
    const c = baseNote({ parentId: b.id });
    await db.notes.bulkAdd([a, b, c]);
    await nestNote(a.id, c.id);
    await nestNote(a.id, a.id);
    expect((await db.notes.get(a.id))!.parentId).toBeUndefined();
  });
});
