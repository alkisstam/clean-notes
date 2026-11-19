import type { JSONContent } from '@tiptap/core';
import { db, uid } from './db';
import { dateKey, longDate } from './dates';
import { docText, emptyDoc, imageIdsIn, pdfIdsIn } from './doc';
import { formatAt, linkedReminder, nextRepeat, type ReminderItem } from './reminders';
import { store, type ReminderEdit } from './store';
import { renameTagIn } from './tags';
import { appendTask, checkAllTasks, extractTasks, patchTask, renameTask } from './tasks';
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

export async function createNote(view: View = store.getState().view, patch: Partial<Note> = {}) {
  flushEditor();
  const note = baseNote({
    notebookId: view.type === 'notebook' ? view.id : null,
    tags: view.type === 'tag' ? [view.path] : [],
    ...patch,
  });
  await db.notes.add(note);
  const s = store.getState();
  // A new note must be visible in the list, so leave views that cannot show it.
  if (!['all', 'notebook', 'tag'].includes(view.type)) s.setView({ type: 'all' });
  s.setQuery('');
  s.openNote(note.id, { focusTitle: !patch.title });
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

/** Puts a note and its sub-notes under another note, in that note's notebook. */
export async function nestNote(id: string, parentId: string) {
  flushEditor();
  const ok = await db.transaction('rw', db.notes, async () => {
    const all = await db.notes.toArray();
    const byId = new Map(all.map((n) => [n.id, n]));
    const parent = byId.get(parentId);
    if (!parent || id === parentId || !byId.has(id) || byId.get(id)!.parentId === parentId) return true;
    for (let n: Note | undefined = parent, hops = 0; n && hops <= all.length; n = byId.get(n.parentId ?? ''), hops++) {
      if (n.id === id) return false;
    }
    const subtree = [id];
    for (let i = 0; i < subtree.length; i++) {
      for (const n of all) if (n.parentId === subtree[i] && !subtree.includes(n.id)) subtree.push(n.id);
    }
    const now = Date.now();
    await db.notes.update(id, { parentId, updatedAt: now });
    await db.notes.where('id').anyOf(subtree).modify((n) => {
      if (n.notebookId === parent.notebookId) return;
      n.notebookId = parent.notebookId;
      n.updatedAt = now;
    });
    return true;
  });
  const s = store.getState();
  if (!ok) s.showToast({ message: 'A note cannot go inside its own sub-note' });
  else if (s.collapsedNotes.includes(parentId)) s.toggleNote(parentId);
}

export async function patchNote(id: string, patch: Partial<Note>) {
  await db.notes.update(id, { ...patch, updatedAt: Date.now() });
}

export async function patchNotes(ids: string[], patch: Partial<Note>) {
  await db.notes.where('id').anyOf(ids).modify({ ...patch, updatedAt: Date.now() });
}

export async function changeTags(ids: string[], add: string[], remove: string[]) {
  await db.notes.where('id').anyOf(ids).modify((n) => {
    n.tags = [...new Set([...n.tags.filter((t) => !remove.includes(t)), ...add])];
    n.updatedAt = Date.now();
  });
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

export async function trashNotes(ids: string[]) {
  flushEditor();
  await patchNotes(ids, { trashedAt: Date.now() });
  const s = store.getState();
  if (s.noteId && ids.includes(s.noteId)) s.openNote(null);
  s.showToast({
    message: ids.length === 1 ? 'Moved to Trash' : `${ids.length} notes moved to Trash`,
    action: {
      label: 'Undo',
      run: () => ids.forEach((id) => void restoreNote(id)),
    },
  });
}

export const trashNote = (id: string) => trashNotes([id]);

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
  // A file just dropped into a note, in this tab or another, is saved before the note is; give the note time to catch up.
  const before = Date.now() - 5 * 60_000;
  const notes = await db.notes.toArray();
  const used = new Set(notes.flatMap((n) => pdfIdsIn(n.content)));
  const ids = (await db.files.where('createdAt').below(before).primaryKeys()) as string[];
  const orphans = ids.filter((id) => !used.has(id));
  await db.files.bulkDelete(orphans);
  await db.blobs.bulkDelete(orphans);
  const usedImages = new Set(notes.flatMap((n) => imageIdsIn(n.content)));
  await db.images.filter((i) => i.createdAt < before && !usedImages.has(i.id)).delete();
}

export async function deleteForever(ids: string[]) {
  await db.notes.bulkDelete(ids);
  await bury('notes', ids);
  await collectOrphanFiles();
  const s = store.getState();
  if (s.noteId && ids.includes(s.noteId)) s.openNote(null);
}

export async function duplicateNote(id: string, open = true) {
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
    color: src.color,
    tags: [...src.tags],
  });
  await db.notes.add(copy);
  if (open) store.getState().openNote(copy.id);
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

export async function setTaskAttrs(noteId: string, taskId: string, attrs: { checked?: boolean; due?: string | null; remind?: string | null }) {
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

export async function createNotebook(name: string, open = true) {
  const id = uid();
  await db.notebooks.add({ id, name: name.trim(), createdAt: Date.now(), updatedAt: Date.now() });
  if (open) store.getState().setView({ type: 'notebook', id });
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

/** Opens the reminder attached to a note, or a new one attached to it. */
export async function remindNote(noteId: string) {
  flushEditor();
  const notes = await db.notes.where('kind').equals('reminder').toArray();
  const linked = linkedReminder(notes, noteId);
  store.getState().editReminder(linked ? { id: linked.id } : { attach: noteId });
}

/** Saves the reminder editor: a reminder note, new or changed, or a to-do's own text, date and time. */
export async function saveReminder(edit: ReminderEdit, r: { title: string; at: string; repeat: string | null; favorite: boolean; noteRef: string | null; todos: { id: string; text: string; done: boolean }[] }) {
  flushEditor();
  if (edit.task) {
    const { noteId, taskId } = edit.task;
    const note = await db.notes.get(noteId);
    if (!note) return;
    const [day, time] = r.at.split('T');
    let content = patchTask(note.content, taskId, { due: day, remind: time });
    if (extractTasks(note).find((t) => t.id === taskId)?.text !== r.title) content = renameTask(content, taskId, r.title);
    await db.notes.update(noteId, { content, text: docText(content), writer: `tasks:${uid()}`, updatedAt: Date.now() });
    return;
  }
  const old = edit.id ? await db.notes.get(edit.id) : undefined;
  // Only to-do lists are edited here; anything else in the document is kept as it is.
  const kept = (old?.content.content ?? []).filter((b) => b.type !== 'taskList');
  let content: JSONContent = { type: 'doc', content: kept };
  for (const t of r.todos.filter((t) => t.text.trim())) {
    content = appendTask(content, t.id, t.text.trim(), null);
    if (t.done) content = patchTask(content, t.id, { checked: true });
  }
  if (!content.content?.length) content = emptyDoc();
  const fields = { title: r.title, content, text: docText(content), remindAt: r.at, repeat: r.repeat, favorite: r.favorite, noteRef: r.noteRef };
  if (old) {
    // A new time makes a completed reminder active again.
    await db.notes.update(old.id, { ...fields, ...(old.remindAt !== r.at && { doneAt: null }), writer: `tasks:${uid()}`, updatedAt: Date.now() });
  } else {
    await db.notes.add(baseNote({ ...fields, kind: 'reminder', doneAt: null }));
  }
}

/** A to-do ticks in its note; a repeating reminder moves to its next time; any other reminder is marked done, or undone. */
export async function tickReminder(r: ReminderItem) {
  if (r.taskId) return setTaskAttrs(r.noteId, r.taskId, { checked: !r.done });
  if (r.repeat && !r.done) {
    const now = new Date();
    return patchNote(r.noteId, { remindAt: formatAt(nextRepeat(r.at, r.repeat, r.at > now ? r.at : now)) });
  }
  return setReminderDone(r, !r.done);
}

/** Completes or restores a reminder; one made with Add reminder ticks or unticks its to-dos with it. Its attached note is left alone. */
export async function setReminderDone(r: Pick<ReminderItem, 'noteId' | 'taskId'>, done: boolean) {
  if (r.taskId) return setTaskAttrs(r.noteId, r.taskId, { checked: done });
  const note = await db.notes.get(r.noteId);
  if (!note) return;
  const own = note.kind === 'reminder';
  await db.notes.update(r.noteId, {
    doneAt: done ? Date.now() : null,
    ...(own && { content: checkAllTasks(note.content, done), writer: `tasks:${uid()}` }),
    updatedAt: Date.now(),
  });
}

/** A reminder note goes to the Trash; other notes and to-dos only lose their reminder. */
export async function deleteReminder(r: ReminderItem) {
  if (r.taskId) return setTaskAttrs(r.noteId, r.taskId, { remind: null });
  if (r.kind === 'reminder') return trashNotes([r.noteId]);
  return patchNote(r.noteId, { remindAt: null, repeat: null });
}
