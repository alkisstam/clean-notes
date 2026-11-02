import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownUp, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Menu as MenuIcon, Pin, Plus, RotateCcw, SearchX, Trash2, ChevronDown,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createNote, deleteForever, flushEditor, openDaily, quickAddTask, restoreNote, setTaskAttrs } from '../lib/actions';
import { db } from '../lib/db';
import { dateKey, dueLabel, firstDayOfWeek, longDate, monthGrid, parseKey, relativeTime, shortDate } from '../lib/dates';
import { imageIdsIn, pdfIdsIn } from '../lib/doc';
import { formatBytes } from '../lib/pdf';
import { fold, foldQuery, snippet, type Snippet } from '../lib/search';
import { store, useStore, type SortKey } from '../lib/store';
import { noteHasTag } from '../lib/tags';
import { extractTasks, groupTasks } from '../lib/tasks';
import type { Note, Notebook, PdfFile, TaskRef, View } from '../lib/types';
import { Menu } from './Overlay';
import { NOTE_DRAG } from './Sidebar';

const Hit = ({ s }: { s: Snippet }) => (
  <>
    {s.before}
    <mark>{s.match}</mark>
    {s.after}
  </>
);

const preview = (text: string) => text.replace(/\n/g, ' ').slice(0, 170);

const NoteRow = memo(function NoteRow({ note, active, notebook, hit, index, actions }: {
  note: Note;
  active: boolean;
  notebook?: string;
  hit?: { snippet: Snippet | null; source?: string };
  index: number;
  actions?: ReactNode;
}) {
  const tasks = useMemo(() => extractTasks(note), [note]);
  const done = tasks.filter((t) => t.done).length;
  const hasPdf = useMemo(() => pdfIdsIn(note.content).length > 0, [note.content]);
  const hasImage = useMemo(() => imageIdsIn(note.content).length > 0, [note.content]);
  return (
    <div
      className="note-row"
      data-active={active}
      style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
      draggable={!note.trashedAt}
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_DRAG, note.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button type="button" className="note-row-main" aria-current={active ? 'true' : undefined} onClick={() => store.getState().openNote(note.id)}>
        <span className="note-row-title">
          {note.pinned && !note.trashedAt && <Pin size={11} aria-label="Pinned" />}
          <span>{note.title || 'Untitled'}</span>
        </span>
        <span className="note-row-text">
          {hit?.snippet ? (
            <>
              {hit.source && <em>{hit.source} </em>}
              <Hit s={hit.snippet} />
            </>
          ) : (
            preview(note.text) || 'No content yet'
          )}
        </span>
        <span className="note-row-meta">
          <time>{relativeTime(note.updatedAt)}</time>
          {notebook && <span>{notebook}</span>}
          {tasks.length > 0 && <span>{done}/{tasks.length} done</span>}
          {hasPdf && <span className="meta-icon"><FileText size={11} aria-label="Has a PDF" /></span>}
          {hasImage && <span className="meta-icon"><ImageIcon size={11} aria-label="Has an image" /></span>}
        </span>
      </button>
      {actions && <div className="note-row-actions">{actions}</div>}
    </div>
  );
});

function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

function Calendar({ selected, withNotes }: { selected: string; withNotes: Set<string> }) {
  const today = dateKey();
  const [cursor, setCursor] = useState(() => {
    const d = parseKey(selected);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  useEffect(() => {
    const d = parseKey(selected);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }, [selected]);
  const weekStart = useMemo(firstDayOfWeek, []);
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m, weekStart), [cursor, weekStart]);
  const heads = useMemo(
    () => grid.slice(0, 7).map((k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'narrow' })),
    [grid],
  );
  const shift = (by: number) => {
    const d = new Date(cursor.y, cursor.m + by, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <div className="calendar">
      <div className="calendar-head">
        <strong>{monthName}</strong>
        <button type="button" className="icon-btn small" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={14} /></button>
        <button type="button" className="link-btn" onClick={() => void openDaily(today)}>Today</button>
        <button type="button" className="icon-btn small" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={14} /></button>
      </div>
      <div className="calendar-grid" role="grid" aria-label={monthName}>
        {heads.map((h, i) => <span key={i} className="calendar-dow" aria-hidden>{h}</span>)}
        {grid.map((key) => (
          <button
            key={key}
            type="button"
            data-outside={parseKey(key).getMonth() !== cursor.m}
            data-today={key === today}
            data-selected={key === selected}
            data-has={withNotes.has(key)}
            aria-label={`${longDate(key)}${withNotes.has(key) ? ', has a note' : ''}`}
            aria-pressed={key === selected}
            onClick={() => void openDaily(key)}
          >
            {parseKey(key).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task, today, active }: { task: TaskRef; today: string; active: boolean }) {
  const late = Boolean(task.due && task.due < today && !task.done);
  return (
    <div className="task-row" data-done={task.done} data-active={active}>
      <label className="task-check">
        <input
          type="checkbox"
          checked={task.done}
          aria-label={`Mark "${task.text}" ${task.done ? 'not done' : 'done'}`}
          onChange={(e) => void setTaskAttrs(task.noteId, task.id, { checked: e.target.checked })}
        />
        <span className="task-box" />
      </label>
      <button type="button" className="task-row-main" onClick={() => store.getState().openNote(task.noteId, { taskId: task.id })}>
        <span className="task-row-text">{task.text}</span>
        <span className="task-row-meta">
          {task.due && <span data-late={late}>{dueLabel(task.due, today)}</span>}
          <span>{task.noteTitle || 'Untitled'}</span>
        </span>
      </button>
      <label className="task-row-date" title="Set due date">
        <span className="sr-only">Due date for {task.text}</span>
        <input
          type="date"
          value={task.due ?? ''}
          onChange={(e) => void setTaskAttrs(task.noteId, task.id, { due: e.target.value || null })}
        />
      </label>
    </div>
  );
}

function TasksBody({ notes }: { notes: Note[] }) {
  const noteId = useStore((s) => s.noteId);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const today = dateKey();
  const groups = useMemo(
    () => groupTasks(notes.filter((n) => !n.trashedAt).flatMap(extractTasks), today),
    [notes, today],
  );
  const sections: [string, TaskRef[]][] = [
    ['Overdue', groups.overdue],
    ['Today', groups.today],
    ['Upcoming', groups.upcoming],
    ['No date', groups.someday],
  ];
  const openCount = sections.reduce((n, [, l]) => n + l.length, 0);
  return (
    <>
      <form
        className="quick-task"
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value) return;
          void quickAddTask(value, due || null);
          setText('');
          setDue('');
        }}
      >
        <Plus size={15} />
        <input
          value={text}
          placeholder="Add a task to today's note"
          aria-label="New task"
          onChange={(e) => setText(e.target.value)}
        />
        <input type="date" value={due} aria-label="Due date for new task" onChange={(e) => setDue(e.target.value)} />
      </form>
      <div className="list-scroll">
        {openCount === 0 && groups.done.length === 0 && (
          <Empty title="No tasks yet" body="Add one above, or type /todo in any note." />
        )}
        {openCount === 0 && groups.done.length > 0 && <Empty title="All caught up" />}
        {sections.map(([name, list]) =>
          list.length ? (
            <section key={name} className="task-group">
              <h3 data-late={name === 'Overdue'}>{name}<span>{list.length}</span></h3>
              {list.map((t) => <TaskRow key={t.noteId + t.id} task={t} today={today} active={t.noteId === noteId} />)}
            </section>
          ) : null,
        )}
        {groups.done.length > 0 && (
          <section className="task-group">
            <button type="button" className="task-done-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
              <ChevronDown size={13} data-open={showDone} /> Completed<span>{groups.done.length}</span>
            </button>
            {showDone && groups.done.map((t) => <TaskRow key={t.noteId + t.id} task={t} today={today} active={t.noteId === noteId} />)}
          </section>
        )}
      </div>
    </>
  );
}

function PdfRow({ file, owner, active }: { file: PdfFile; owner?: Note; active: boolean }) {
  return (
    <button
      type="button"
      className="pdf-row"
      data-active={active}
      onClick={() => {
        if (owner) store.getState().openNote(owner.id);
        store.getState().setPdf({ fileId: file.id });
        store.getState().setPane('editor');
      }}
    >
      <span className="pdf-thumb">{file.thumb ? <img src={file.thumb} alt="" /> : <FileText size={18} />}</span>
      <span className="pdf-row-text">
        <strong>{file.name}</strong>
        <small>{file.encrypted ? 'Password protected' : `${file.pageCount} ${file.pageCount === 1 ? 'page' : 'pages'}`} · {formatBytes(file.size)}</small>
        <small>{owner ? `In ${owner.title || 'Untitled'}` : 'Not in any note'}</small>
      </span>
    </button>
  );
}

function viewTitle(view: View, notebooks: Notebook[], selectedDate: string) {
  switch (view.type) {
    case 'all': return 'All notes';
    case 'daily': return selectedDate === dateKey() ? 'Today' : shortDate(selectedDate);
    case 'tasks': return 'Tasks';
    case 'pdfs': return 'PDFs';
    case 'trash': return 'Trash';
    case 'notebook': return notebooks.find((b) => b.id === view.id)?.name ?? 'Notebook';
    case 'tag': return `#${view.path}`;
  }
}

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'updated', label: 'Last edited' },
  { id: 'created', label: 'Date created' },
  { id: 'title', label: 'Title' },
];

interface SearchHit {
  note?: Note;
  file?: PdfFile;
  owner?: Note;
  page?: number;
  snippet: Snippet | null;
  source?: string;
}

export function ListColumn({ notes, notebooks }: { notes: Note[]; notebooks: Notebook[] }) {
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const noteId = useStore((s) => s.noteId);
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const dailyDate = useStore((s) => s.dailyDate);
  const activePdf = useStore((s) => s.pdf?.fileId);
  const setPane = useStore((s) => s.setPane);
  const files = useLiveQuery(() => db.files.toArray(), [], [] as PdfFile[]);

  const live = useMemo(() => notes.filter((n) => !n.trashedAt), [notes]);
  const nbName = useMemo(() => new Map(notebooks.map((b) => [b.id, b.name])), [notebooks]);
  const ownerOf = useMemo(() => {
    const map = new Map<string, Note>();
    for (const n of live) for (const id of pdfIdsIn(n.content)) if (!map.has(id)) map.set(id, n);
    return map;
  }, [live]);

  const listed = useMemo(() => {
    let out: Note[] = [];
    if (view.type === 'all') out = live.filter((n) => n.kind === 'note');
    else if (view.type === 'notebook') out = live.filter((n) => n.notebookId === view.id);
    else if (view.type === 'tag') out = live.filter((n) => noteHasTag(n.tags, view.path));
    else if (view.type === 'trash') out = notes.filter((n) => n.trashedAt);
    else if (view.type === 'daily') {
      out = live.filter((n) => n.kind === 'daily' && (n.text || n.date === dailyDate));
      return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    }
    const cmp: Record<SortKey, (a: Note, b: Note) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'),
    };
    return [...out].sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp[sort](a, b));
  }, [view, live, notes, sort, dailyDate]);

  const hits = useMemo<SearchHit[]>(() => {
    const q = foldQuery(query);
    if (!q) return [];
    const has = (t: string) => fold(t).folded.includes(q);
    const out: SearchHit[] = [];
    const titled: SearchHit[] = [];
    for (const note of live) {
      const inTags = note.tags.some(has);
      if (has(note.title)) titled.push({ note, snippet: snippet(note.text, query) });
      else if (has(note.text)) out.push({ note, snippet: snippet(note.text, query) });
      else if (inTags) out.push({ note, snippet: null });
    }
    const pdfHits: SearchHit[] = [];
    for (const file of files) {
      const owner = ownerOf.get(file.id);
      if (has(file.name)) {
        pdfHits.push({ file, owner, snippet: null });
        continue;
      }
      const page = file.pageTexts.findIndex(has);
      if (page >= 0) pdfHits.push({ file, owner, page: page + 1, snippet: snippet(file.pageTexts[page], query) });
    }
    const byDate = (a: SearchHit, b: SearchHit) => (b.note?.updatedAt ?? 0) - (a.note?.updatedAt ?? 0);
    return [...titled.sort(byDate), ...out.sort(byDate), ...pdfHits];
  }, [query, live, files, ownerOf]);

  const searching = Boolean(query.trim());
  const dates = useMemo(
    () => new Set(live.filter((n) => n.kind === 'daily' && n.text && n.date).map((n) => n.date!)),
    [live],
  );

  const title = searching ? 'Search' : viewTitle(view, notebooks, dailyDate);
  const canCreate = !searching && ['all', 'notebook', 'tag'].includes(view.type);
  const canSort = !searching && ['all', 'notebook', 'tag', 'trash'].includes(view.type);
  const trashEmpty = view.type === 'trash' && listed.length === 0;
  const pdfFiles = useMemo(() => [...files].sort((a, b) => b.createdAt - a.createdAt), [files]);

  let body: ReactNode;
  if (searching) {
    body = hits.length ? (
      <div className="list-scroll">
        <p className="list-count">{hits.length} {hits.length === 1 ? 'result' : 'results'}</p>
        {hits.map((h, i) =>
          h.note ? (
            <NoteRow
              key={h.note.id}
              note={h.note}
              index={i}
              active={h.note.id === noteId}
              notebook={h.note.notebookId ? nbName.get(h.note.notebookId) : undefined}
              hit={{ snippet: h.snippet }}
            />
          ) : (
            <div key={h.file!.id} className="note-row" style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
              <button
                type="button"
                className="note-row-main"
                onClick={() => {
                  flushEditor();
                  if (h.owner) store.getState().openNote(h.owner.id);
                  store.getState().setPdf({ fileId: h.file!.id, page: h.page, query });
                  store.getState().setPane('editor');
                }}
              >
                <span className="note-row-title"><FileText size={12} /><span>{h.file!.name}</span></span>
                {h.snippet && <span className="note-row-text"><em>Page {h.page} </em><Hit s={h.snippet} /></span>}
                <span className="note-row-meta"><span>{h.owner ? `In ${h.owner.title || 'Untitled'}` : 'Not in any note'}</span></span>
              </button>
            </div>
          ),
        )}
      </div>
    ) : (
      <Empty icon={<SearchX size={22} />} title="Nothing found" body={`No notes or PDFs contain "${query.trim()}".`} />
    );
  } else if (view.type === 'tasks') {
    body = <TasksBody notes={notes} />;
  } else if (view.type === 'pdfs') {
    body = pdfFiles.length ? (
      <div className="list-scroll">
        {pdfFiles.map((f) => <PdfRow key={f.id} file={f} owner={ownerOf.get(f.id)} active={f.id === activePdf} />)}
      </div>
    ) : (
      <Empty title="No PDFs yet" body="Type /pdf in a note, or drop a file onto it." />
    );
  } else {
    body = (
      <>
        {view.type === 'daily' && <Calendar selected={dailyDate} withNotes={dates} />}
        {view.type === 'trash' && listed.length > 0 && (
          <div className="trash-bar">
            <span>Notes stay here until you delete them.</span>
            <button
              type="button"
              className="link-btn danger"
              onClick={() =>
                store.getState().setDialog({
                  kind: 'confirm',
                  title: 'Empty the Trash?',
                  body: `${listed.length} ${listed.length === 1 ? 'note' : 'notes'} and any PDFs only they use are deleted for good.`,
                  confirm: 'Empty Trash',
                  danger: true,
                  onConfirm: () => void deleteForever(listed.map((n) => n.id)),
                })
              }
            >
              Empty
            </button>
          </div>
        )}
        {listed.length ? (
          <div className="list-scroll">
            {listed.map((n, i) => (
              <NoteRow
                key={n.id}
                note={n}
                index={i}
                active={n.id === noteId}
                notebook={view.type !== 'notebook' && n.notebookId ? nbName.get(n.notebookId) : undefined}
                actions={
                  view.type === 'trash' ? (
                    <>
                      <button type="button" className="icon-btn small" aria-label={`Restore ${n.title || 'Untitled'}`} title="Restore" onClick={() => void restoreNote(n.id)}>
                        <RotateCcw size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn small"
                        aria-label={`Delete ${n.title || 'Untitled'} for good`}
                        title="Delete for good"
                        onClick={() =>
                          store.getState().setDialog({
                            kind: 'confirm',
                            title: 'Delete for good?',
                            body: `"${n.title || 'Untitled'}" cannot be recovered.`,
                            confirm: 'Delete',
                            danger: true,
                            onConfirm: () => void deleteForever([n.id]),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : undefined
                }
              />
            ))}
          </div>
        ) : trashEmpty ? (
          <Empty title="Trash is empty" />
        ) : view.type === 'daily' ? null : (
          <Empty
            title={view.type === 'tag' ? 'No notes with this tag' : 'No notes here yet'}
            action={<button type="button" className="btn" onClick={() => void createNote()}><Plus size={14} /> New note</button>}
          />
        )}
      </>
    );
  }

  return (
    <section className="list-col" aria-label={title}>
      <header className="list-head">
        <button type="button" className="icon-btn mobile-only" aria-label="Open library" onClick={() => setPane('sidebar')}>
          <MenuIcon size={18} />
        </button>
        <h1 title={title}>{title}</h1>
        {canSort && (
          <Menu
            label="Sort notes"
            trigger={<ArrowDownUp size={15} />}
            items={SORTS.map((s) => ({ label: s.label, checked: sort === s.id, run: () => setSort(s.id) }))}
          />
        )}
        {canCreate && (
          <button type="button" className="icon-btn accent" aria-label="New note" title="New note (Alt N)" onClick={() => void createNote()}>
            <Plus size={17} />
          </button>
        )}
      </header>
      {body}
    </section>
  );
}

