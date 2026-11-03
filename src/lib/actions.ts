import type { JSONContent } from '@tiptap/core';
import { db, uid } from './db';
import { dateKey, longDate } from './dates';
import { docText, emptyDoc, imageIdsIn, pdfIdsIn } from './doc';
import { store } from './store';
import { renameTagIn } from './tags';
import { appendTask, patchTask } from './tasks';
import type { Note, Tombstone, View } from './types';

/** The open editor registers this so other actions can save its pending keystrokes first. */
let flusher: (() => void) | null = null;
export const registerFlusher = (fn: (() => void) | null) => {
  flusher = fn;
};
export const flushEditor = () => flusher?.();

const bury = (table: Tombstone['table'], ids: string[]) =>
  db.tombstones.bulkPut(ids.map((id) => ({ id, table, deletedAt: Date.now() })));

export function baseNote(patch: Partial<Note> = {}): Note {
  const now = Date.now();
  const content = patch.content ?? emptyDoc();
  return {
    id: uid(),
    title: '',
    content,
    text: docText(content),
    notebookId: null,
    tags: [],
    kind: 'note',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    ...patch,
  };
}

export async function createNote(view: View = store.getState().view) {
  flushEditor();
  const note = baseNote({
    notebookId: view.type === 'notebook' ? view.id : null,
    tags: view.type === 'tag' ? [view.path] : [],
  });
  await db.notes.add(note);
  const s = store.getState();
  // A new note must be visible in the list, so leave views that cannot show it.
  if (!['all', 'notebook', 'tag'].includes(view.type)) s.setView({ type: 'all' });
  s.setQuery('');
  s.openNote(note.id, { focusTitle: true });
  return note;
}

export async function createSubNote(parentId: string) {
  flushEditor();
  const parent = await db.notes.get(parentId);
  if (!parent) return;
  const view = store.getState().view;
  const note = baseNote({
    parentId,
    notebookId: parent.notebookId,
    tags: view.type === 'tag' ? [view.path] : [],
  });
  await db.notes.add(note);
  const s = store.getState();
  if (!['all', 'notebook', 'tag'].includes(view.type)) s.setView({ type: 'all' });
  s.setQuery('');
  if (s.collapsedNotes.includes(parentId)) s.toggleNote(parentId);
  s.openNote(note.id, { focusTitle: true });
}

export async function patchNote(id: string, patch: Partial<Note>) {
  await db.notes.update(id, { ...patch, updatedAt: Date.now() });
}

/**
 * IndexedDB writes may not finish while a page closes, but localStorage is
 * synchronous. Edits made in the last moments go here and are applied on next launch.
 */
const JOURNAL = 'cn.journal';
type Journal = { id: string; at: number; title?: string; content?: JSONContent };

export function journalEdit(id: string, patch: { title?: string; content?: JSONContent }) {
  try {
    const list: Journal[] = JSON.parse(localStorage.getItem(JOURNAL) ?? '[]');
    list.push({ id, at: Date.now(), ...patch });
    localStorage.setItem(JOURNAL, JSON.stringify(list));
  } catch {
    /* Out of quota or blocked: the regular save was still attempted. */
  }
}

export const clearJournal = () => {
  try {
    localStorage.removeItem(JOURNAL);
  } catch {
    /* nothing to clear */
  }
};

export async function recoverJournal() {
  let list: Journal[] = [];
  try {
    list = JSON.parse(localStorage.getItem(JOURNAL) ?? '[]');
  } catch {
    /* unreadable journal: nothing to recover */
  }
  for (const entry of list) {
    const note = await db.notes.get(entry.id);
    // Skip it if the note has been edited since, for example in another tab.
    if (!note || note.updatedAt > entry.at) continue;
    const patch: Partial<Note> = { updatedAt: entry.at };
    if (entry.title !== undefined) patch.title = entry.title;
    if (entry.content) {
      patch.content = entry.content;
      patch.text = docText(entry.content);
      patch.writer = `journal:${uid()}`;
    }
    await db.notes.update(entry.id, patch);
  }
  clearJournal();
}

/** Reads inside the update, so quick successive edits cannot overwrite each other. */
export async function editTags(id: string, change: (tags: string[]) => string[]) {
  await db.notes.where('id').equals(id).modify((n) => {
    n.tags = change(n.tags);
    n.updatedAt = Date.now();
  });
}

export async function saveContent(id: string, content: JSONContent, writer: string) {
  await db.notes.update(id, { content, text: docText(content), writer, updatedAt: Date.now() });
}

export async function trashNote(id: string) {
  flushEditor();
  await db.notes.update(id, { trashedAt: Date.now(), updatedAt: Date.now() });
  const s = store.getState();
  if (s.noteId === id) s.openNote(null);
  s.showToast({
    message: 'Moved to Trash',
    action: {
      label: 'Undo',
      run: () => void restoreNote(id),
    },
  });
}

export async function restoreNote(id: string) {
  flushEditor();
  const twinId = await db.transaction('rw', db.notes, db.tombstones, async () => {
    const note = await db.notes.get(id);
    if (!note) return null;
    // A new daily note may have been made for this date while this one was in the Trash.
    const twin = note.kind === 'daily'
      ? await db.notes.where('date').equals(note.date!).filter((n) => n.kind === 'daily' && !n.trashedAt).first()
      : undefined;
    if (!twin) {
      await db.notes.update(id, { trashedAt: null, updatedAt: Date.now() });
      return null;
    }
    const content = { ...twin.content, content: [...(twin.content.content ?? []), ...(note.content.content ?? [])] };
    await db.notes.update(twin.id, { content, text: docText(content), writer: `restore:${uid()}`, updatedAt: Date.now() });
    await db.notes.delete(id);
    await bury('notes', [id]);
    return twin.id;
  });
  const s = store.getState();
  if (twinId && s.noteId === id) s.openNote(twinId);
}

/** Removes stored PDFs and images that no remaining note refers to. Each device does this itself, so files need no tombstones. */
export async function collectOrphanFiles() {
  const notes = await db.notes.toArray();
  const used = new Set(notes.flatMap((n) => pdfIdsIn(n.content)));
  const ids = (await db.files.toCollection().primaryKeys()) as string[];
  const orphans = ids.filter((id) => !used.has(id));
  await db.files.bulkDelete(orphans);
  await db.blobs.bulkDelete(orphans);
  const usedImages = new Set(notes.flatMap((n) => imageIdsIn(n.content)));
  const imageIds = (await db.images.toCollection().primaryKeys()) as string[];
  await db.images.bulkDelete(imageIds.filter((id) => !usedImages.has(id)));
}

export async function deleteForever(ids: string[]) {
  await db.notes.bulkDelete(ids);
  await bury('notes', ids);
  await collectOrphanFiles();
  const s = store.getState();
  if (s.noteId && ids.includes(s.noteId)) s.openNote(null);
}

export async function duplicateNote(id: string) {
  flushEditor();
  const src = await db.notes.get(id);
  if (!src) return;
  const content: JSONContent = structuredClone(src.content);
  // Copies are separate tasks, so they need ids of their own.
  const rekey = (n: JSONContent) => {
    if (n.type === 'taskItem') n.attrs = { ...n.attrs, id: uid() };
    n.content?.forEach(rekey);
  };
  rekey(content);
  const copy = baseNote({
    title: src.title ? `${src.title} copy` : '',
    content,
    notebookId: src.notebookId,
    parentId: src.parentId,
    tags: [...src.tags],
  });
  await db.notes.add(copy);
  store.getState().openNote(copy.id);
}

export async function getOrCreateDaily(date: string): Promise<Note> {
  return db.transaction('rw', db.notes, async () => {
    const existing = await db.notes.where('date').equals(date).filter((n) => n.kind === 'daily' && !n.trashedAt).first();
    if (existing) return existing;
    const note = baseNote({ kind: 'daily', date, title: longDate(date) });
    await db.notes.add(note);
    return note;
  });
}

export async function openDaily(date: string = dateKey()) {
  flushEditor();
  const note = await getOrCreateDaily(date);
  const s = store.getState();
  if (s.view.type !== 'daily') s.setView({ type: 'daily' });
  else s.setQuery('');
  s.setDailyDate(date);
  s.openNote(note.id);
}

export async function setTaskAttrs(noteId: string, taskId: string, attrs: { checked?: boolean; due?: string | null }) {
  flushEditor();
  const note = await db.notes.get(noteId);
  if (!note) return;
  const content = patchTask(note.content, taskId, attrs);
  await db.notes.update(noteId, { content, writer: `tasks:${uid()}`, updatedAt: Date.now() });
}

export async function quickAddTask(text: string, due: string | null) {
  flushEditor();
  const note = await getOrCreateDaily(dateKey());
  const content = appendTask(note.content, uid(), text, due);
  await db.notes.update(note.id, { content, text: docText(content), writer: `tasks:${uid()}`, updatedAt: Date.now() });
}

export async function createNotebook(name: string) {
  const id = uid();
  await db.notebooks.add({ id, name: name.trim(), createdAt: Date.now(), updatedAt: Date.now() });
  store.getState().setView({ type: 'notebook', id });
  return id;
}

export const renameNotebook = (id: string, name: string) =>
  db.notebooks.update(id, { name: name.trim(), updatedAt: Date.now() });

export async function deleteNotebook(id: string) {
  await db.transaction('rw', db.notes, db.notebooks, db.tombstones, async () => {
    await db.notes.where('notebookId').equals(id).modify({ notebookId: null, updatedAt: Date.now() });
    await db.notebooks.delete(id);
    await bury('notebooks', [id]);
  });
  const s = store.getState();
  if (s.view.type === 'notebook' && s.view.id === id) s.setView({ type: 'all' });
}

export async function retag(from: string, to: string) {
  flushEditor();
  await db.notes.where('tags').startsWith(from).modify((n) => {
    n.tags = renameTagIn(n.tags, from, to);
    n.updatedAt = Date.now();
  });
  const s = store.getState();
  if (s.view.type === 'tag' && (s.view.path === from || s.view.path.startsWith(from + '/'))) {
    s.setView(to ? { type: 'tag', path: to + s.view.path.slice(from.length) } : { type: 'all' });
  }
}
