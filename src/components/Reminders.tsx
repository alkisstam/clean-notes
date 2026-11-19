import { ArrowLeft, Bell, CalendarDays, CircleCheck, Clock, FileText, ListPlus, Pencil, Plus, Repeat, SquareCheck, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteReminder, saveReminder, setReminderDone, patchNote, tickReminder, setTaskAttrs, trashNotes } from '../lib/actions';
import { dueLabel } from '../lib/dates';
import { askToNotify } from '../lib/notify';
import { formatAt, groupReminders, parseAt, reminderItems, taskAt, type ReminderItem } from '../lib/reminders';
import { store, useStore, type ReminderEdit } from '../lib/store';
import { extractTasks } from '../lib/tasks';
import type { Note } from '../lib/types';
import { Calendar } from './Calendar';
import { MenuPopup, type MenuItem } from './Overlay';

export const REPEATS: [string | null, string][] = [[null, "Don't repeat"], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];

const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const atLabel = (d: Date) => `${dueLabel(formatAt(d).slice(0, 10))} ${timeLabel(d)}`;

type Tab = 'today' | 'scheduled' | 'completed';
const readTab = (): Tab => {
  try {
    return (localStorage.getItem('cn.reminderTab') as Tab) || 'today';
  } catch {
    return 'today';
  }
};

/** A note attached to a reminder. [compact] in the list, with a preview in the editor; [onRemove] detaches it. */
function NoteCard({ note, compact, onRemove }: { note: Note; compact?: boolean; onRemove?: () => void }) {
  return (
    <span className="reminder-note" data-compact={compact}>
      <button
        type="button"
        className="reminder-note-main"
        title="Open note"
        onClick={(e) => {
          e.stopPropagation();
          store.getState().openNote(note.id);
        }}
      >
        <span className="reminder-note-icon"><FileText size={compact ? 12 : 15} /></span>
        <span className="reminder-note-text">
          <strong>{note.title.trim() || 'Untitled'}</strong>
          {!compact && note.text.trim() && <small>{note.text.replace(/\n/g, ' ').slice(0, 200)}</small>}
        </span>
      </button>
      {onRemove && (
        <button type="button" className="icon-btn small reminder-note-remove" aria-label="Detach note" title="Detach note" onClick={onRemove}>
          <X size={13} />
        </button>
      )}
    </span>
  );
}

type RowSelect = { selecting: boolean; ticked: boolean; onSelect: () => void; onToggle: () => void };

function ReminderRow({ r, active, sel }: { r: ReminderItem; active: boolean; sel: RowSelect }) {
  const [ctx, setCtx] = useState<DOMRect | null>(null);
  const late = !r.done && r.at < new Date();
  const items: MenuItem[] = [
    { label: 'Select', icon: <SquareCheck size={14} />, run: sel.onSelect },
    { label: r.done ? 'Restore' : 'Complete', icon: <CircleCheck size={14} />, run: () => void setReminderDone(r, !r.done) },
    // To-dos have no favorite flag of their own.
    ...(r.taskId ? [] : [{ label: r.favorite ? 'Unfavorite' : 'Favorite', icon: <Star size={14} />, run: () => void patchNote(r.noteId, { favorite: !r.favorite }) }]),
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, run: () => confirmDelete([r]) },
  ];
  const open = () => {
    if (sel.selecting) return sel.onToggle();
    const s = store.getState();
    if (r.taskId) s.editReminder({ task: { noteId: r.noteId, taskId: r.taskId } });
    else if (r.kind === 'reminder') s.editReminder({ id: r.noteId });
    else s.openNote(r.noteId);
  };
  return (
    <div
      className="reminder-row"
      data-done={r.done}
      data-active={active || sel.ticked}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!sel.selecting) setCtx(new DOMRect(e.clientX, e.clientY, 0, 0));
      }}
    >
      <label className="task-check round">
        {sel.selecting ? (
          <input type="checkbox" checked={sel.ticked} aria-label={`Select "${r.title}"`} onChange={sel.onToggle} />
        ) : (
          <input type="checkbox" checked={r.done} aria-label={`Mark "${r.title}" ${r.done ? 'not done' : 'done'}`} onChange={() => void tickReminder(r)} />
        )}
        <span className="task-box" />
      </label>
      <div className="reminder-row-main" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
        <span className="reminder-row-title">{r.title}{r.favorite && <Star size={12} className="reminder-fav" />}</span>
        <span className="reminder-row-meta" data-late={late}>
          {atLabel(r.at)}
          {r.repeat && <Repeat size={11} aria-label={`Repeats ${r.repeat}`} />}
        </span>
        {r.ref && <NoteCard note={r.ref} compact />}
      </div>
      <MenuPopup items={items} rect={ctx} onClose={() => setCtx(null)} />
    </div>
  );
}

function confirmDelete(rs: ReminderItem[], then?: () => void) {
  store.getState().setDialog({
    kind: 'confirm',
    title: rs.length > 1 ? `Delete ${rs.length} reminders?` : 'Delete reminder?',
    confirm: 'Delete',
    danger: true,
    onConfirm: () => {
      void (async () => { for (const r of rs) await deleteReminder(r); })();
      then?.();
    },
  });
}

function ReminderSelectBar({ picked, all, set }: { picked: ReminderItem[]; all: ReminderItem[]; set: (keys: string[] | null) => void }) {
  const allDone = picked.length > 0 && picked.every((r) => r.done);
  const favable = picked.filter((r) => !r.taskId);
  const allFav = favable.length > 0 && favable.every((r) => r.favorite);
  const allOn = picked.length === all.length && all.length > 0;
  const done = () => set(null);
  const actions: { label: string; icon: React.ReactNode; run: () => void; off?: boolean }[] = [
    { label: allDone ? 'Restore' : 'Complete', icon: <CircleCheck size={15} />, run: () => { void (async () => { for (const r of picked) await setReminderDone(r, !allDone); })(); done(); } },
    { label: allFav ? 'Unfavorite' : 'Favorite', icon: <Star size={15} fill={allFav ? 'currentColor' : 'none'} />, off: !favable.length, run: () => { void (async () => { for (const r of favable) await patchNote(r.noteId, { favorite: !allFav }); })(); done(); } },
    { label: 'Delete', icon: <Trash2 size={15} />, run: () => confirmDelete(picked, done) },
  ];
  return (
    <div className="select-bar" role="toolbar" aria-label="Selected reminders">
      <div className="select-bar-top">
        <strong>{picked.length} selected</strong>
        <button type="button" className="link-btn" onClick={() => set(allOn ? [] : all.map((r) => r.key))}>{allOn ? 'Deselect all' : 'Select all'}</button>
        <button type="button" className="link-btn" onClick={done}>Cancel</button>
      </div>
      <div className="select-bar-actions">
        {actions.map((a) => (
          <button key={a.label} type="button" className="icon-btn small" aria-label={a.label} title={a.label} disabled={!picked.length || a.off} onClick={a.run}>{a.icon}</button>
        ))}
      </div>
    </div>
  );
}

/** Today, Scheduled and Completed as three tiles, and the picked group's reminders below. */
export function RemindersBody({ notes }: { notes: Note[] }) {
  const [tab, setTab] = useState<Tab>(readTab);
  const [selected, setSelected] = useState<string[] | null>(null);
  const editing = useStore((s) => s.reminder);
  const groups = useMemo(() => groupReminders(reminderItems(notes), new Date()), [notes]);
  const list = groups[tab];
  const activeKey = editing?.task ? editing.task.noteId + editing.task.taskId : editing?.id;
  const tiles: [Tab, string, React.ReactNode][] = [
    ['today', 'Today', <CalendarDays size={15} />],
    ['scheduled', 'Scheduled', <Clock size={15} />],
    ['completed', 'Completed', <CircleCheck size={15} />],
  ];
  return (
    <>
    {selected && <ReminderSelectBar picked={list.filter((r) => selected.includes(r.key))} all={list} set={setSelected} />}
    <div className="list-scroll">
      <div className="reminder-tiles" role="tablist">
        {tiles.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setSelected(null);
              try {
                localStorage.setItem('cn.reminderTab', key);
              } catch {
                /* Remembered for this session only. */
              }
            }}
          >
            {icon}
            <strong>{groups[key].length}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      {list.length ? (
        list.map((r) => (
          <ReminderRow
            key={r.key}
            r={r}
            active={r.key === activeKey}
            sel={{
              selecting: selected !== null,
              ticked: Boolean(selected?.includes(r.key)),
              onSelect: () => setSelected([r.key]),
              onToggle: () => setSelected((s) => (s?.includes(r.key) ? s.filter((k) => k !== r.key) : [...(s ?? []), r.key])),
            }}
          />
        ))
      ) : (
        <div className="empty">
          <strong>{tab === 'scheduled' ? 'Nothing scheduled' : tab === 'completed' ? 'No completed reminders' : 'Nothing due today'}</strong>
          {tab !== 'completed' && (
            <button type="button" className="btn" onClick={() => store.getState().editReminder({})}><Plus size={14} /> New reminder</button>
          )}
        </div>
      )}
    </div>
    </>
  );
}

type Todo = { id: string; text: string; done: boolean };

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** Hours, then minutes in fives; picking a minute closes it. A time set elsewhere to another minute stays as it is. */
function TimePicker({ value, onPick }: { value: string; onPick: (time: string, done: boolean) => void }) {
  const [h, m] = value.split(':').map(Number);
  const hourLabel = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' });
  return (
    <div className="time-picker">
      <span className="time-picker-head">Hour</span>
      <div className="time-grid">
        {HOURS.map((hour) => (
          <button key={hour} type="button" data-selected={hour === h} onClick={() => onPick(`${pad2(hour)}:${pad2(m)}`, false)}>{hourLabel(hour)}</button>
        ))}
      </div>
      <span className="time-picker-head">Minute</span>
      <div className="time-grid">
        {MINUTES.map((min) => (
          <button key={min} type="button" data-selected={min === m} onClick={() => onPick(`${pad2(h)}:${pad2(min)}`, true)}>:{pad2(min)}</button>
        ))}
      </div>
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** An existing reminder opens to view; Edit switches to the form, and Cancel goes back with the changes dropped. */
export function ReminderEditor({ edit, notes }: { edit: ReminderEdit; notes: Note[] }) {
  const [existing] = useState(() => {
    if (edit.id) return true;
    const owner = edit.task && notes.find((n) => n.id === edit.task!.noteId);
    return Boolean(owner && extractTasks(owner).find((t) => t.id === edit.task!.taskId)?.remind);
  });
  const [editing, setEditing] = useState(!existing);
  const [rev, setRev] = useState(0);
  return (
    <ReminderForm
      key={rev}
      edit={edit}
      notes={notes}
      editing={editing}
      onEdit={existing ? (on, drop) => { setEditing(on); if (drop) setRev(rev + 1); } : null}
    />
  );
}

/** Adds or edits a reminder in the editor pane: title, attached note, to-dos, date, time and repeat; or a to-do's own date and time. */
function ReminderForm({ edit, notes, editing, onEdit }: { edit: ReminderEdit; notes: Note[]; editing: boolean; onEdit: ((on: boolean, drop?: boolean) => void) | null }) {
  // Read once, so a sync landing mid-edit doesn't replace what is being typed.
  const [init] = useState(() => {
    const note = edit.id ? notes.find((n) => n.id === edit.id) : undefined;
    const owner = edit.task ? notes.find((n) => n.id === edit.task!.noteId) : undefined;
    const todo = owner && extractTasks(owner).find((t) => t.id === edit.task!.taskId);
    const next = new Date();
    next.setHours(next.getHours() + 1, 0, 0, 0);
    const dueDay = todo?.due ? parseAt(`${todo.due}T${formatAt(next).slice(11)}`) : null;
    const at = parseAt(note?.remindAt) ?? (todo && taskAt(todo)) ?? dueDay ?? next;
    const todos: Todo[] = note
      ? extractTasks({ ...note, content: { type: 'doc', content: (note.content.content ?? []).filter((b) => b.type === 'taskList') } }).map((t) => ({ id: t.id, text: t.text, done: t.done }))
      : [];
    const ref = edit.task?.noteId ?? note?.noteRef ?? edit.attach ?? null;
    const refNote = notes.find((n) => n.id === ref);
    return { note, todo, at, todos, ref, title: note?.title ?? todo?.text ?? refNote?.title ?? '' };
  });
  const [title, setTitle] = useState(init.title);
  const [ref, setRef] = useState(init.ref);
  const [todos, setTodos] = useState(init.todos);
  const [day, setDay] = useState(formatAt(init.at).slice(0, 10));
  const [time, setTime] = useState(formatAt(init.at).slice(11));
  const [repeat, setRepeat] = useState<string | null>(init.note?.repeat ?? null);
  const [favorite, setFavorite] = useState(Boolean(init.note?.favorite));
  // One picker open at a time, as on the phone.
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  const [focusTodo, setFocusTodo] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const refNote = notes.find((n) => n.id === ref && !n.trashedAt);
  const isTask = Boolean(edit.task);
  const ro = !editing;

  useEffect(() => {
    if (!edit.id && !edit.task && !edit.attach) titleRef.current?.focus();
  }, [edit]);
  useEffect(() => {
    if (focusTodo) (document.querySelector(`[data-todo="${focusTodo}"]`) as HTMLInputElement | null)?.focus();
  }, [focusTodo]);

  // The to-do was deleted meanwhile.
  if (isTask && !init.todo) return <div className="empty"><strong>That to-do no longer exists</strong></div>;

  const close = () => {
    const s = store.getState();
    s.editReminder(null);
    if (s.noteId === edit.id) s.openNote(null);
  };
  const cancel = () => (onEdit ? onEdit(false, true) : close());
  const save = () => {
    if (!title.trim()) return;
    askToNotify();
    void saveReminder(edit, { title: title.trim(), at: `${day}T${time || '09:00'}`, repeat, favorite, noteRef: ref, todos });
    if (onEdit) onEdit(false);
    else close();
  };
  const askDelete = (heading: string, run: () => void) =>
    store.getState().setDialog({ kind: 'confirm', title: heading, confirm: 'Delete', danger: true, onConfirm: () => { run(); close(); } });
  const addTodo = () => {
    const t = { id: crypto.randomUUID(), text: '', done: false };
    setTodos([...todos, t]);
    setFocusTodo(t.id);
  };

  return (
    <>
      <header className="doc-bar">
        <button type="button" className="icon-btn phone-only" aria-label="Back to list" onClick={close}>
          <ArrowLeft size={18} />
        </button>
        <span className="reminder-head"><Bell size={14} /> {isTask ? 'To-do reminder' : edit.id ? 'Reminder' : 'New reminder'}</span>
        <span className="doc-spacer" />
        {ro && (
          <button type="button" className="icon-btn" aria-label="Edit reminder" title="Edit" onClick={() => onEdit?.(true)}>
            <Pencil size={15} />
          </button>
        )}
        {edit.id && (
          <button type="button" className="icon-btn" aria-label="Move reminder to Trash" title="Move to Trash" onClick={() => askDelete('Delete reminder?', () => void trashNotes([edit.id!]))}>
            <Trash2 size={15} />
          </button>
        )}
        {isTask && init.todo?.remind && (
          <button type="button" className="icon-btn" aria-label="Remove reminder" title="Remove reminder" onClick={() => askDelete('Remove reminder?', () => void setTaskAttrs(edit.task!.noteId, edit.task!.taskId, { remind: null }))}>
            <Trash2 size={15} />
          </button>
        )}
        {!isTask && (
          <button type="button" className="icon-btn" aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={favorite} onClick={() => {
              setFavorite(!favorite);
              if (ro && edit.id) void patchNote(edit.id, { favorite: !favorite });
            }}>
            <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </header>
      <div className="doc-scroll">
        <form
          className="reminder-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => e.key === 'Escape' && cancel()}
        >
          <div className="reminder-card">
            <input ref={titleRef} className="reminder-title" readOnly={ro} value={title} placeholder="Title" aria-label="Title" onChange={(e) => setTitle(e.target.value)} />
            {refNote && <NoteCard note={refNote} onRemove={isTask || ro ? undefined : () => setRef(null)} />}
            {!isTask && (
              <div className="reminder-todos">
                {todos.map((t, i) => (
                  <div key={t.id} className="reminder-todo">
                    <label className="task-check round">
                      <input type="checkbox" disabled={ro} checked={t.done} aria-label={t.done ? 'Mark to-do not done' : 'Mark to-do done'} onChange={() => setTodos(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} />
                      <span className="task-box" />
                    </label>
                    <input
                      data-todo={t.id}
                      readOnly={ro}
                      value={t.text}
                      placeholder="To-do"
                      aria-label="To-do"
                      onChange={(e) => setTodos(todos.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTodo();
                        } else if (e.key === 'Backspace' && !t.text) {
                          // Backspace in an empty to-do removes it.
                          e.preventDefault();
                          setTodos(todos.filter((x) => x.id !== t.id));
                          setFocusTodo(todos[i - 1]?.id ?? null);
                        }
                      }}
                    />
                  </div>
                ))}
                {!ro && <button type="button" className="link-btn reminder-add-todo" onClick={addTodo}><ListPlus size={13} /> Add to-do</button>}
              </div>
            )}
            <div className="reminder-option">
              <CalendarDays size={16} />
              <button type="button" disabled={ro} aria-expanded={open === 'date'} onClick={() => setOpen(open === 'date' ? null : 'date')}>{dueLabel(day)}</button>
            </div>
            {open === 'date' && (
              <Calendar
                selected={day}
                onPick={(key) => {
                  setDay(key);
                  setOpen(null);
                }}
              />
            )}
            <div className="reminder-option">
              <Clock size={16} />
              <button type="button" disabled={ro} aria-expanded={open === 'time'} aria-label={`Time, ${timeLabel(parseAt(`${day}T${time}`) ?? new Date())}`} onClick={() => setOpen(open === 'time' ? null : 'time')}>
                {timeLabel(parseAt(`${day}T${time}`) ?? new Date())}
              </button>
            </div>
            {open === 'time' && (
              <TimePicker
                value={time}
                onPick={(t, done) => {
                  setTime(t);
                  if (done) setOpen(null);
                }}
              />
            )}
            {!isTask && (
              <label className="reminder-option">
                <Repeat size={16} />
                <select value={repeat ?? ''} disabled={ro} aria-label="Repeat" data-dim={!repeat} onChange={(e) => setRepeat(e.target.value || null)}>
                  {REPEATS.map(([key, label]) => <option key={label} value={key ?? ''}>{label}</option>)}
                </select>
              </label>
            )}
          </div>
          {!ro && (
            <div className="reminder-actions">
              <button type="button" className="btn" onClick={cancel}>Cancel</button>
              <button type="submit" className="btn primary" disabled={!title.trim()}>Save</button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
