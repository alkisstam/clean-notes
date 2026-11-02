import type { JSONContent } from '@tiptap/core';
import { ownText, walkDoc } from './doc';
import type { Note, TaskRef } from './types';

export function extractTasks(note: Pick<Note, 'id' | 'title' | 'content'>): TaskRef[] {
  const tasks: TaskRef[] = [];
  walkDoc(note.content, (n) => {
    if (n.type !== 'taskItem' || !n.attrs?.id) return;
    const text = ownText(n).trim();
    if (!text) return;
    tasks.push({
      id: String(n.attrs.id),
      noteId: note.id,
      noteTitle: note.title,
      text,
      done: Boolean(n.attrs.checked),
      due: n.attrs.due ?? null,
    });
  });
  return tasks;
}

/** Returns a copy of the document with one task's attributes changed. */
export function patchTask(doc: JSONContent, id: string, attrs: { checked?: boolean; due?: string | null }): JSONContent {
  const copy: JSONContent = structuredClone(doc);
  walkDoc(copy, (n) => {
    if (n.type === 'taskItem' && n.attrs?.id === id) n.attrs = { ...n.attrs, ...attrs };
  });
  return copy;
}

export function appendTask(doc: JSONContent, id: string, text: string, due: string | null): JSONContent {
  const copy: JSONContent = structuredClone(doc);
  const item: JSONContent = {
    type: 'taskItem',
    attrs: { id, checked: false, due },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
  const content = (copy.content ??= []);
  // Join the last task list if the document ends with one.
  let idx = content.length - 1;
  const lastIsEmpty = (n?: JSONContent) => n?.type === 'paragraph' && !n.content?.length;
  if (lastIsEmpty(content[idx])) idx--;
  if (content[idx]?.type === 'taskList') {
    content[idx].content = [...(content[idx].content ?? []), item];
  } else {
    if (idx < 0) content.length = 0;
    content.splice(idx + 1, 0, { type: 'taskList', content: [item] });
  }
  return copy;
}

export interface TaskGroups {
  overdue: TaskRef[];
  today: TaskRef[];
  upcoming: TaskRef[];
  someday: TaskRef[];
  done: TaskRef[];
}

export function groupTasks(tasks: TaskRef[], today: string): TaskGroups {
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [], someday: [], done: [] };
  for (const t of tasks) {
    if (t.done) groups.done.push(t);
    else if (!t.due) groups.someday.push(t);
    else if (t.due < today) groups.overdue.push(t);
    else if (t.due === today) groups.today.push(t);
    else groups.upcoming.push(t);
  }
  const byDue = (a: TaskRef, b: TaskRef) => (a.due ?? '').localeCompare(b.due ?? '');
  groups.overdue.sort(byDue);
  groups.upcoming.sort(byDue);
  return groups;
}
