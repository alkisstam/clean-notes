import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive, ArchiveRestore, ArrowDownAZ, CalendarPlus, Check, Clock, Copy, Download, FolderInput, Palette, PinOff, Share2, SquareCheck, Tag, X, FileText, Image as ImageIcon, Menu as MenuIcon, Pin, Plus, RotateCcw, Search, SearchX, Trash2, ChevronDown,
} from 'lucide-react';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { createNote, deleteForever, duplicateNote, nestNote, patchNotes, trashNotes, flushEditor, openDaily, quickAddTask, restoreNote, setTaskAttrs } from '../lib/actions';
import { shareFormats } from '../lib/export';
import { db } from '../lib/db';
import { noteBg } from '../lib/colors';
import { dateKey, dueLabel, relativeTime, shortDate } from '../lib/dates';
import { Calendar } from './Calendar';
import { imageIdsIn, pdfIdsIn } from '../lib/doc';
import { formatBytes } from '../lib/pdf';
import { foldQuery, includesFolded, snippet, type Snippet } from '../lib/search';
import { store, useStore, type SortKey } from '../lib/store';
import { allTagPaths, nestNotes, noteHasTag } from '../lib/tags';
import { extractTasks, groupTasks } from '../lib/tasks';
import type { Note, Notebook, PdfFile, TaskRef, View } from '../lib/types';
import { Menu, MenuPopup, type MenuItem } from './Overlay';
import { dropProps, NOTE_DRAG } from './Sidebar';
import { noteMenuItems } from './EditorPane';
import { currentEditor } from '../editor/NoteEditor';

const Hit = ({ s }: { s: Snippet }) => (
  <>
    {s.before}
    <mark>{s.match}</mark>
    {s.after}
  </>
);

const preview = (text: string) => text.replace(/\n/g, ' ').slice(0, 170);

const NoteRow = memo(function NoteRow({ note, active, notebook, hit, index, actions, depth = 0, hasKids, collapsed, nestable, rails, selectable, selecting, ticked }: {
  note: Note;
  active: boolean;
  notebook?: string;
  hit?: { snippet: Snippet | null; source?: string };
  index: number;
  actions?: ReactNode;
  depth?: number;
  hasKids?: boolean;
  collapsed?: boolean;
  nestable?: boolean;
  /** One line per ancestor, outermost first, in that ancestor's color. */
  rails?: string[];
  selectable?: boolean;
  selecting?: boolean;
  ticked?: boolean;
}) {
  const tasks = useMemo(() => extractTasks(note), [note]);
  const done = tasks.filter((t) => t.done).length;
  const hasPdf = useMemo(() => pdfIdsIn(note.content).length > 0, [note.content]);
  const hasImage = useMemo(() => imageIdsIn(note.content).length > 0, [note.content]);
  const [ctx, setCtx] = useState<DOMRect | null>(null);
  const bg = noteBg(note.color);
  const ctxItems: MenuItem[] = ctx
    ? [
        ...(selectable ? [{ label: 'Select', icon: <SquareCheck size={14} />, run: () => store.getState().setSelected([note.id]) }] : []),
        ...noteMenuItems(note, active ? currentEditor() : null),
      ]
    : [];
  return (
    <div
      className="note-row"
      data-active={active}
      data-color={bg ? '' : undefined}
      data-selecting={selecting || undefined}
      data-ticked={ticked || undefined}
      onContextMenu={(e) => {
        if (note.trashedAt) return;
        e.preventDefault();
        setCtx(new DOMRect(e.clientX, e.clientY, 0, 0));
      }}
      style={{ '--i': Math.min(index, 12), '--depth': depth, ...(bg && { '--note-bg': bg }) } as React.CSSProperties}
      draggable={!note.trashedAt && !selecting}
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_DRAG, note.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      {...(nestable ? dropProps((id) => void nestNote(id, note.id)) : {})}
    >
      {rails?.map((color, i) => (
        <span key={i} className="note-rail" style={{ left: (i - rails.length) * 16 + 6, background: color }} />
      ))}
      {hasKids && (
        <button
          type="button"
          className="note-row-toggle"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} sub-notes of ${note.title || 'Untitled'}`}
          onClick={() => store.getState().toggleNote(note.id)}
        >
          <ChevronDown size={12} data-open={!collapsed} />
        </button>
      )}
      <button
        type="button"
        className="note-row-main"
        aria-current={active ? 'true' : undefined}
        aria-pressed={selecting ? Boolean(ticked) : undefined}
        onClick={() => (selecting ? store.getState().toggleSelected(note.id) : store.getState().openNote(note.id))}
      >
        {selecting && <span className="note-tick">{ticked && <Check size={12} strokeWidth={3} />}</span>}
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
      <MenuPopup items={ctxItems} rect={ctx} onClose={() => setCtx(null)} />
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
    () => groupTasks(notes.filter((n) => !n.trashedAt && !n.archivedAt).flatMap(extractTasks), today),
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
    case 'pinned': return 'Pinned';
    case 'archive': return 'Archive';
    case 'trash': return 'Trash';
    case 'notebook': return notebooks.find((b) => b.id === view.id)?.name ?? 'Notebook';
    case 'tag': return `#${view.path}`;
  }
}

const SORTS: { id: SortKey; label: string; icon: ReactNode }[] = [
  { id: 'updated', label: 'Last edited', icon: <Clock size={14} /> },
  { id: 'created', label: 'Date created', icon: <CalendarPlus size={14} /> },
  { id: 'title', label: 'Title', icon: <ArrowDownAZ size={14} /> },
];

function SelectionBar({ picked, all, inArchive, allTags }: { picked: Note[]; all: Note[]; inArchive: boolean; allTags: string[] }) {
  const setSelected = useStore((s) => s.setSelected);
  const setDialog = useStore((s) => s.setDialog);
  const ids = picked.map((n) => n.id);
  // Daily notes cannot be pinned, copied or archived, as in their right-click menu.
  const plain = picked.filter((n) => n.kind !== 'daily');
  const plainIds = plain.map((n) => n.id);
  const allPinned = plain.length > 0 && plain.every((n) => n.pinned);
  const allOn = picked.length === all.length && all.length > 0;
  const done = () => setSelected(null);
  const actions: { label: string; icon: ReactNode; run: () => void; off?: boolean }[] = [
    { label: 'Move', icon: <FolderInput size={15} />, run: () => setDialog({ kind: 'pickNotebook', onPick: (id) => { void patchNotes(ids, { notebookId: id }); done(); } }) },
    ...(shareFormats().length ? [{ label: 'Share', icon: <Share2 size={15} />, run: () => setDialog({ kind: 'export', noteIds: ids, mode: 'share' }) }] : []),
    { label: 'Export', icon: <Download size={15} />, run: () => setDialog({ kind: 'export', noteIds: ids, mode: 'save' }) },
    { label: allPinned ? 'Unpin' : 'Pin', icon: allPinned ? <PinOff size={15} /> : <Pin size={15} />, off: !plain.length, run: () => { void patchNotes(plainIds, { pinned: !allPinned }); done(); } },
    { label: 'Duplicate', icon: <Copy size={15} />, off: !plain.length, run: () => { void (async () => { for (const id of plainIds) await duplicateNote(id, false); })(); done(); } },
    { label: inArchive ? 'Unarchive' : 'Archive', icon: inArchive ? <ArchiveRestore size={15} /> : <Archive size={15} />, off: !plain.length, run: () => { void patchNotes(plainIds, { archivedAt: inArchive ? null : Date.now() }); done(); } },
    { label: 'Tags', icon: <Tag size={15} />, run: () => setDialog({ kind: 'bulkTags', noteIds: ids, allTags, common: picked[0].tags.filter((t) => picked.every((n) => n.tags.includes(t))) }) },
    { label: 'Color', icon: <Palette size={15} />, run: () => setDialog({ kind: 'noteColor', noteIds: ids }) },
    { label: 'Delete', icon: <Trash2 size={15} />, run: () => { void trashNotes(ids); done(); } },
  ];
  return (
    <div className="select-bar" role="toolbar" aria-label="Selected notes">
      <div className="select-bar-top">
        <strong>{picked.length} selected</strong>
        <button type="button" className="link-btn" onClick={() => setSelected(allOn ? [] : all.map((n) => n.id))}>{allOn ? 'Deselect all' : 'Select all'}</button>
        <button type="button" className="icon-btn small" aria-label="Leave select mode" title="Done" onClick={done}><X size={14} /></button>
      </div>
      <div className="select-bar-actions">
        {actions.map((a) => (
          <button key={a.label} type="button" className="icon-btn small" aria-label={a.label} title={a.label} disabled={!picked.length || a.off} onClick={a.run}>{a.icon}</button>
        ))}
      </div>
    </div>
  );
}

interface SearchHit {
  note?: Note;
  file?: PdfFile;
  owner?: Note;
  page?: number;
  snippet: Snippet | null;
  source?: string;
}

export function ListColumn({ notes, notebooks, searchRef }: { notes: Note[]; notebooks: Notebook[]; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const noteId = useStore((s) => s.noteId);
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const dailyDate = useStore((s) => s.dailyDate);
  const activePdf = useStore((s) => s.pdf?.fileId);
  const collapsedNotes = useStore((s) => s.collapsedNotes);
  const setPane = useStore((s) => s.setPane);
  const selected = useStore((s) => s.selected);
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
    const shelved = live.filter((n) => !n.archivedAt);
    if (view.type === 'all') out = shelved.filter((n) => n.kind === 'note');
    else if (view.type === 'notebook') out = shelved.filter((n) => n.notebookId === view.id);
    else if (view.type === 'tag') out = shelved.filter((n) => noteHasTag(n.tags, view.path));
    else if (view.type === 'pinned') out = shelved.filter((n) => n.pinned);
    else if (view.type === 'archive') out = live.filter((n) => n.archivedAt);
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

  const rows = useMemo(() => {
    if (!['all', 'notebook', 'tag'].includes(view.type)) return listed.map((note) => ({ note, depth: 0, hasKids: false, rails: undefined }));
    const byId = new Map(notes.map((n) => [n.id, n]));
    return nestNotes(listed, collapsedNotes).map((row) => {
      const rails: string[] = [];
      let up = byId.get(row.note.parentId ?? '');
      for (let i = 0; i < row.depth; i++) {
        rails.unshift(noteBg(up?.color) ?? 'var(--line-strong)');
        up = byId.get(up?.parentId ?? '');
      }
      return { ...row, rails };
    });
  }, [view.type, listed, collapsedNotes, notes]);

  const hits = useMemo<SearchHit[]>(() => {
    const q = foldQuery(query);
    if (!q) return [];
    const has = (t: string) => includesFolded(t, query);
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
  const canSort = !searching && ['all', 'notebook', 'tag', 'pinned', 'archive', 'trash'].includes(view.type);
  const canSelect = canSort && view.type !== 'trash';
  const shownNotes = useMemo(() => rows.map((r) => r.note), [rows]);
  const picked = useMemo(() => shownNotes.filter((n) => selected?.includes(n.id)), [shownNotes, selected]);
  const tagPaths = useMemo(() => allTagPaths(live.map((n) => n.tags)), [live]);
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
        {view.type === 'daily' && <Calendar selected={dailyDate} marked={dates} onPick={(key) => void openDaily(key)} />}
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
            {rows.map(({ note: n, depth, hasKids, rails }, i) => (
              <NoteRow
                key={n.id}
                note={n}
                index={i}
                depth={depth}
                rails={rails}
                hasKids={hasKids}
                collapsed={collapsedNotes.includes(n.id)}
                nestable={['all', 'notebook', 'tag'].includes(view.type)}
                active={n.id === noteId}
                selectable={canSelect}
                selecting={selected !== null}
                ticked={selected?.includes(n.id)}
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
        ) : view.type === 'pinned' ? (
          <Empty title="No pinned notes" />
        ) : view.type === 'archive' ? (
          <Empty title="Archive is empty" />
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
        {canCreate && (
          <button type="button" className="icon-btn accent" aria-label="New note" title="New note (Alt N)" onClick={() => void createNote()}>
            <Plus size={17} />
          </button>
        )}
        {canSort && (
          <Menu
            label="More"
            items={[
              ...(canSelect ? [{ label: 'Select', icon: <SquareCheck size={14} />, run: () => store.getState().setSelected([]) }] : []),
              ...SORTS.map((s) => ({ label: s.label, icon: s.icon, checked: sort === s.id, run: () => setSort(s.id) })),
            ]}
          />
        )}
      </header>
      <label className="search">
        <Search size={14} />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search"
          aria-label="Search notes and PDFs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              e.currentTarget.blur();
            }
          }}
        />
        <kbd>Ctrl K</kbd>
      </label>
      {selected !== null && <SelectionBar picked={picked} all={shownNotes} inArchive={view.type === 'archive'} allTags={tagPaths} />}
      {body}
    </section>
  );
}

