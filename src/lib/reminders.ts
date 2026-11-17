import { extractTasks } from './tasks';
import type { Note, TaskRef } from './types';

// Same rules as android/.../Reminders.kt, which tests/lib.test.ts checks this against.

/** A local "YYYY-MM-DDTHH:MM" as a Date, or null. */
export function parseAt(at: string | null | undefined): Date | null {
  const m = at?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const formatAt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A to-do's reminder time, done or not; null without a due date and time. */
export const taskAt = (t: TaskRef) => (t.due && t.remind ? parseAt(`${t.due}T${t.remind}`) : null);

/** [at] moved on by [k] steps; months and years keep the day where the month has it, like java.time. */
function step(at: Date, repeat: string, k: number): Date {
  if (repeat === 'daily') return new Date(at.getFullYear(), at.getMonth(), at.getDate() + k, at.getHours(), at.getMinutes());
  if (repeat === 'weekly') return new Date(at.getFullYear(), at.getMonth(), at.getDate() + 7 * k, at.getHours(), at.getMinutes());
  const months = repeat === 'monthly' ? k : 12 * k;
  const first = new Date(at.getFullYear(), at.getMonth() + months, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(at.getDate(), days), at.getHours(), at.getMinutes());
}

/** The first time after [now] that a reminder repeating from [at] falls on; counted from [at] so Jan 31 stays the 31st where it can. */
export function nextRepeat(at: Date, repeat: string, now: Date): Date {
  let k = 1;
  while (step(at, repeat, k) <= now) k++;
  return step(at, repeat, k);
}

/** A repeating reminder whose time has passed moves to its next time; null when it stays, as a completed one does. */
export function advancedRemindAt(note: Note, now: Date): string | null {
  const at = parseAt(note.remindAt);
  if (!note.repeat || note.doneAt || !at || at > now) return null;
  return formatAt(nextRepeat(at, note.repeat, now));
}

/** One line on the Reminders page: a note's own reminder (taskId null) or a to-do's. [ref] is the note shown as a card under it. */
export interface ReminderItem {
  key: string;
  noteId: string;
  taskId: string | null;
  title: string;
  at: Date;
  repeat: string | null;
  favorite: boolean;
  done: boolean;
  kind: Note['kind'];
  ref: Note | null;
}

const shelved = (notes: Note[]) => notes.filter((n) => !n.trashedAt && !n.archivedAt);

export function reminderItems(notes: Note[]): ReminderItem[] {
  const live = shelved(notes);
  const byId = new Map(live.map((n) => [n.id, n]));
  return live.flatMap((n) => {
    const title = n.title.trim() || 'Untitled';
    const at = parseAt(n.remindAt);
    const own: ReminderItem[] = at
      ? [{ key: n.id, noteId: n.id, taskId: null, title, at, repeat: n.repeat ?? null, favorite: Boolean(n.favorite), done: Boolean(n.doneAt), kind: n.kind, ref: byId.get(n.noteRef ?? '') ?? null }]
      : [];
    const tasks = extractTasks(n).flatMap((t): ReminderItem[] => {
      const tAt = taskAt(t);
      return tAt ? [{ key: n.id + t.id, noteId: n.id, taskId: t.id, title: t.text, at: tAt, repeat: null, favorite: false, done: t.done, kind: n.kind, ref: n.kind === 'reminder' ? null : n }] : [];
    });
    return [...own, ...tasks];
  });
}

export interface ReminderGroups {
  today: ReminderItem[];
  scheduled: ReminderItem[];
  completed: ReminderItem[];
}

export function groupReminders(items: ReminderItem[], now: Date): ReminderGroups {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const order = (a: ReminderItem, b: ReminderItem) => Number(b.favorite) - Number(a.favorite) || +a.at - +b.at;
  const open = items.filter((r) => !r.done);
  return {
    today: open.filter((r) => r.at < end).sort(order),
    scheduled: open.filter((r) => r.at >= end).sort(order),
    completed: items.filter((r) => r.done).sort((a, b) => +b.at - +a.at),
  };
}

/** The open reminder attached to [noteId], so a second Add reminder edits it instead of making another. */
export const linkedReminder = (notes: Note[], noteId: string) =>
  shelved(notes).find((n) => n.kind === 'reminder' && n.noteRef === noteId && !n.doneAt);

/** One notification: a reminder note's, opening its attached note if it has one, or a to-do's. */
export interface Due {
  key: string;
  noteId: string;
  taskId: string | null;
  title: string;
  at: number;
}

export function dueReminders(notes: Note[]): Due[] {
  return shelved(notes).flatMap((n) => {
    const tasks = extractTasks(n).flatMap((t): Due[] => {
      const at = taskAt(t);
      return at && !t.done ? [{ key: t.id, noteId: n.id, taskId: t.id, title: t.text, at: +at }] : [];
    });
    const at = parseAt(n.remindAt);
    return at && !n.doneAt ? [...tasks, { key: n.id, noteId: n.id, taskId: null, title: n.title.trim() || 'Untitled', at: +at }] : tasks;
  });
}
