import { db } from './db';
import { advancedRemindAt, dueReminders, type Due } from './reminders';
import { patchNote } from './actions';
import { store } from './store';

// The page can only show notifications while it is open: a tab, the installed web app, or the desktop app (which keeps running in the tray).

const KEY = 'cn.remindersFired';

/** When reminders were last shown, so each shows once, even across tabs. Starts now on first run, so old reminders don't all fire. */
function lastFired(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v) return v;
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* Without storage, reminders still fire for this session. */
  }
  return Date.now();
}

const setFired = (at: number) => {
  try {
    localStorage.setItem(KEY, String(at));
  } catch {
    /* As above. */
  }
};

/** Opens what a notification is about: a to-do in its note, or a reminder's attached note, or the reminder itself. */
async function open(d: Due) {
  window.desktop?.show();
  window.focus();
  const s = store.getState();
  if (d.taskId) return s.openNote(d.noteId, { taskId: d.taskId });
  const note = await db.notes.get(d.noteId);
  if (note?.noteRef && (await db.notes.get(note.noteRef))) s.openNote(note.noteRef);
  else if (note?.kind === 'reminder') s.editReminder({ id: note.id });
  else s.openNote(d.noteId);
}

function show(title: string, body: string, tag: string, onClick: () => void) {
  const n = new Notification(title, { body, tag, icon: new URL('icons/icon-192.png', location.href).href });
  n.onclick = onClick;
}

/** Asks once, from a click, since browsers refuse to ask otherwise. The desktop app is always allowed. */
export function askToNotify() {
  if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
}

async function tick(started: number) {
  const since = lastFired();
  const now = Date.now();
  const notes = await db.notes.toArray();
  const due = dueReminders(notes).filter((d) => d.at > since && d.at <= now);
  setFired(now);
  if (due.length && 'Notification' in window && Notification.permission === 'granted') {
    // Those that came due while the app was closed show as one notification, not a burst.
    const missed = due.filter((d) => d.at < started - 60_000);
    const fresh = due.filter((d) => !missed.includes(d));
    if (missed.length === 1) fresh.unshift(missed[0]);
    else if (missed.length > 1) {
      show(`${missed.length} missed reminders`, missed.map((d) => d.title).join(', '), 'missed', () => {
        window.desktop?.show();
        window.focus();
        store.getState().setView({ type: 'reminders' });
      });
    }
    for (const d of fresh) show(d.title, d.taskId ? 'To-do' : 'Reminder', d.key, () => void open(d));
  }
  // Repeating reminders that have come round move on to their next time.
  const nowDate = new Date(now);
  for (const n of notes) {
    if (n.trashedAt || n.archivedAt) continue;
    const next = advancedRemindAt(n, nowDate);
    if (next) await patchNote(n.id, { remindAt: next });
  }
}

let running = false;

/** Checks every 20 seconds; background tabs are slowed to about once a minute, which is close enough. */
export function startReminders() {
  if (running) return;
  running = true;
  const started = Date.now();
  const run = () => void tick(started).catch(() => {});
  run();
  setInterval(run, 20_000);
}
