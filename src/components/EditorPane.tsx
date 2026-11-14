import {
  Archive, ArchiveRestore, ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Copy, CornerLeftUp, Download, PanelTop, Palette, Feather, FilePlus, FileSymlink, Redo2, Undo2, Maximize2, Minimize2, Pin, PinOff, Plus, RotateCcw, Share2, Trash2, X,
} from 'lucide-react';
import { lazy, Component, Fragment, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createNote, createSubNote, deleteForever, duplicateNote, editTags, journalEdit, openDaily, patchNote, restoreNote, trashNote } from '../lib/actions';
import { addDays, dateKey, fullDate, fullDateTime, relativeTime } from '../lib/dates';
import { currentEditor, editorHooks, linkToNote, NoteEditor } from '../editor/NoteEditor';
import { store, useStore } from '../lib/store';
import { noteBg, noteTone } from '../lib/colors';
import { normalizeTag } from '../lib/tags';
import { shareFormats } from '../lib/export';
import type { Editor } from '@tiptap/core';
import type { Note, Notebook } from '../lib/types';
import { Menu, type MenuItem } from './Overlay';

/** The note actions shared by the three-dots menu and the list's right-click menu. */
export function noteMenuItems(note: Note, editor: Editor | null): MenuItem[] {
  const isDaily = note.kind === 'daily';
  return [
    { label: 'New note', icon: <Plus size={14} />, run: () => void createNote() },
    ...(!isDaily
      ? [
          { label: 'New sub-note', icon: <FilePlus size={14} />, run: () => void createSubNote(note.id) },
          { label: 'Duplicate', icon: <Copy size={14} />, run: () => void duplicateNote(note.id) },
          {
            label: note.pinned ? 'Unpin' : 'Pin to top',
            icon: note.pinned ? <PinOff size={14} /> : <Pin size={14} />,
            run: () => void patchNote(note.id, { pinned: !note.pinned }),
          },
        ]
      : []),
    ...(note.parentId ? [{ label: 'Move to top level', icon: <CornerLeftUp size={14} />, run: () => void patchNote(note.id, { parentId: null }) }] : []),
    ...(editor ? [{ label: 'Link to note', icon: <FileSymlink size={14} />, run: () => linkToNote(editor) }] : []),
    { label: 'Background color', icon: <Palette size={14} />, run: () => store.getState().setDialog({ kind: 'noteColor', noteIds: [note.id] }) },
    ...(shareFormats().length ? [{ label: 'Share', icon: <Share2 size={14} />, run: () => store.getState().setDialog({ kind: 'export', noteIds: [note.id], mode: 'share' }) }] : []),
    { label: 'Export', icon: <Download size={14} />, run: () => store.getState().setDialog({ kind: 'export', noteIds: [note.id], mode: 'save' }) },
    ...(!isDaily
      ? [{
          label: note.archivedAt ? 'Unarchive' : 'Archive',
          icon: note.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />,
          run: () => void patchNote(note.id, { archivedAt: note.archivedAt ? null : Date.now() }),
        }]
      : []),
    { label: 'Move to Trash', icon: <Trash2 size={14} />, danger: true, run: () => void trashNote(note.id) },
  ];
}

const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

export class Boundary extends Component<{ children: ReactNode; message: string; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <div className="empty"><strong>Something went wrong</strong><p>{this.props.message}</p></div> : this.props.children;
  }
}

function TagInput({ note, allTags }: { note: Note; allTags: string[] }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const norm = normalizeTag(value);
  const options = useMemo(
    () => (value.trim() ? allTags.filter((t) => t.includes(norm) && !note.tags.includes(t)).slice(0, 7) : []),
    [value, norm, allTags, note.tags],
  );
  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag) void editTags(note.id, (tags) => (tags.includes(tag) ? tags : [...tags, tag]));
    setValue('');
    setIndex(0);
  };
  return (
    <div className="tags-input">
      {note.tags.map((t) => (
        <span key={t} className="tag-chip">
          <button type="button" className="tag-chip-go" title={`Show notes tagged ${t}`} onClick={() => store.getState().setView({ type: 'tag', path: t })}>
            {t.split('/').map((part, i, all) => (
              <span key={i} data-leaf={i === all.length - 1}>{i > 0 && <i>/</i>}{part}</span>
            ))}
          </button>
          <button type="button" className="tag-chip-x" aria-label={`Remove tag ${t}`} onClick={() => void editTags(note.id, (tags) => tags.filter((x) => x !== t))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <div className="tags-entry">
        <input
          value={value}
          placeholder={note.tags.length ? 'Add tag' : 'Add a tag, like work/ideas'}
          aria-label="Add tag"
          role="combobox"
          aria-expanded={open && options.length > 0}
          onChange={(e) => {
            setValue(e.target.value);
            setIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (value.trim()) add(value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && options.length) {
              e.preventDefault();
              setIndex((index + 1) % options.length);
            } else if (e.key === 'ArrowUp' && options.length) {
              e.preventDefault();
              setIndex((index - 1 + options.length) % options.length);
            } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
              if (!value.trim()) return;
              e.preventDefault();
              add(open && options[index] ? options[index] : value);
            } else if (e.key === 'Backspace' && !value && note.tags.length) {
              void editTags(note.id, (tags) => tags.slice(0, -1));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {open && options.length > 0 && (
          <div className="tags-options" role="listbox">
            {options.map((o, i) => (
              <button key={o} type="button" role="option" aria-selected={i === index} data-active={i === index} onMouseDown={(e) => { e.preventDefault(); add(o); }}>
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Where the note sits: its notebook, then the notes it is nested under, then itself. */
export function Crumbs({ notebook, parents, title, onRoot, onParent }: {
  notebook: { name: string; onClick?: () => void } | null;
  parents: { id: string; title: string }[];
  title: string;
  onRoot?: () => void;
  onParent: (id: string) => void;
}) {
  const items: { label: string; onClick?: () => void }[] = [
    notebook ? { label: 'Notebooks' } : { label: 'Notes', onClick: onRoot },
    ...(notebook ? [{ label: notebook.name || 'Untitled', onClick: notebook.onClick }] : []),
    ...parents.map((p) => ({ label: p.title || 'Untitled', onClick: () => onParent(p.id) })),
    { label: title || 'Untitled' },
  ];
  return (
    <nav className="doc-crumbs" aria-label="Location">
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight size={12} aria-hidden />}
          {c.onClick ? (
            <button type="button" onClick={c.onClick}>{c.label}</button>
          ) : (
            <span aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

/** The notes `note` is nested under, outermost first. */
function parentsOf(note: Note, notes: Note[]) {
  const out: Note[] = [];
  const seen = new Set([note.id]);
  for (let p = notes.find((n) => n.id === note.parentId); p && !seen.has(p.id); p = notes.find((n) => n.id === p!.parentId)) {
    seen.add(p.id);
    out.unshift(p);
  }
  return out;
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function Document({ note, notes, notebooks, allTags }: { note: Note; notes: Note[]; notebooks: Notebook[]; allTags: string[] }) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusMode = useStore((s) => s.focusMode);
  const showToolbar = useStore((s) => s.showToolbar);
  const toggleFocus = useStore((s) => s.toggleFocus);
  const focusTitle = useStore((s) => s.focusTitle);
  const setPane = useStore((s) => s.setPane);
  const back = useStore((s) => s.back);
  const fwd = useStore((s) => s.fwd);
  const travel = useStore((s) => s.travel);
  const [title, setTitle] = useState(note.title);
  const editingTitle = useRef(false);
  const isDaily = note.kind === 'daily';
  const inTrash = Boolean(note.trashedAt);

  // Re-render on every editor change, so Undo and Redo show whether there is anything to do.
  const [, tick] = useState(0);
  useEffect(() => {
    editorHooks.onChange = () => tick((n) => n + 1);
    tick((n) => n + 1);
    return () => {
      editorHooks.onChange = null;
    };
  }, []);
  const editor = currentEditor();

  useEffect(() => {
    if (!editingTitle.current) setTitle(note.title);
  }, [note.title]);

  // Fit the title to its text. Re-measured when the column changes width, including
  // when a phone first reveals an editor that was mounted while hidden.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = '0';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    let width = el.parentElement!.clientWidth;
    const ro = new ResizeObserver(() => {
      const next = el.parentElement!.clientWidth;
      if (next !== width) {
        width = next;
        fit();
      }
    });
    ro.observe(el.parentElement!);
    return () => ro.disconnect();
  }, [title, note.id]);

  useEffect(() => {
    if (focusTitle) {
      titleRef.current?.focus();
      store.getState().clearFocusRequests();
    }
  }, [focusTitle]);

  // Save the title shortly after typing stops, and on blur.
  useEffect(() => {
    if (title === note.title || isDaily) return;
    const t = setTimeout(() => void patchNote(note.id, { title }), 300);
    return () => clearTimeout(t);
  }, [title, note.id, note.title, isDaily]);

  // A title still waiting on that delay is saved when the note closes.
  const latest = useRef({ title, saved: note.title, id: note.id, isDaily });
  latest.current = { title, saved: note.title, id: note.id, isDaily };
  useEffect(() => {
    const save = () => {
      const l = latest.current;
      if (!l.isDaily && l.title !== l.saved) void patchNote(l.id, { title: l.title });
    };
    const onPageHide = () => {
      const l = latest.current;
      if (!l.isDaily && l.title !== l.saved) journalEdit(l.id, { title: l.title });
      save();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      save();
    };
  }, []);

  return (
    <>
      <header className="doc-bar">
        <button type="button" className="icon-btn phone-only" aria-label="Back to list" onClick={() => setPane('list')}>
          <ArrowLeft size={18} />
        </button>
        {!inTrash && (
          <div className="doc-history">
            <button type="button" className="icon-btn" aria-label="Previous note" title="Back" disabled={!back.length} onClick={() => void travel('back')}>
              <ArrowLeft size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label="Next note" title="Forward" disabled={!fwd.length} onClick={() => void travel('fwd')}>
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {isDaily ? (
          <div className="doc-daily-nav">
            <button type="button" className="icon-btn" aria-label="Previous day" title="Previous day" onClick={() => void openDaily(addDays(note.date!, -1))}><ChevronLeft size={16} /></button>
            <button type="button" className="icon-btn" aria-label="Next day" title="Next day" onClick={() => void openDaily(addDays(note.date!, 1))}><ChevronRight size={16} /></button>
            {note.date !== dateKey() && <button type="button" className="link-btn" onClick={() => void openDaily()}>Go to today</button>}
          </div>
        ) : inTrash ? null : (
          <label className="notebook-select">
            <BookOpen size={14} />
            <span className="sr-only">Notebook</span>
            <select
              value={note.notebookId ?? ''}
              onChange={(e) => void patchNote(note.id, { notebookId: e.target.value || null })}
            >
              <option value="">No notebook</option>
              {notebooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <span className="doc-spacer" />
        {inTrash ? (
          <>
            <button type="button" className="btn" onClick={() => void restoreNote(note.id)}><RotateCcw size={14} /> Restore</button>
            <button
              type="button"
              className="btn danger"
              onClick={() =>
                store.getState().setDialog({
                  kind: 'confirm',
                  title: 'Delete for good?',
                  body: `"${note.title || 'Untitled'}" cannot be recovered.`,
                  confirm: 'Delete',
                  danger: true,
                  onConfirm: () => void deleteForever([note.id]),
                })
              }
            >
              <Trash2 size={14} /> Delete
            </button>
          </>
        ) : (
          <>
            <button type="button" className="icon-btn" aria-label="Undo" title="Undo (Ctrl Z)" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>
              <Undo2 size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label="Redo" title="Redo (Ctrl Shift Z)" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>
              <Redo2 size={15} />
            </button>
            {!isDaily && (
              <button type="button" className="icon-btn" aria-label="New sub-note" title="New sub-note" onClick={() => void createSubNote(note.id)}>
                <FilePlus size={15} />
              </button>
            )}
            {!isDaily && (
              <button
                type="button"
                className="icon-btn"
                aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                aria-pressed={note.pinned}
                title={note.pinned ? 'Unpin' : 'Pin to top'}
                onClick={() => void patchNote(note.id, { pinned: !note.pinned })}
              >
                {note.pinned ? <PinOff size={15} /> : <Pin size={15} />}
              </button>
            )}
            <button
              type="button"
              className="icon-btn desktop-only"
              aria-label={focusMode ? 'Show all columns' : 'Focus mode'}
              aria-pressed={focusMode}
              title="Focus mode (Ctrl \)"
              onClick={toggleFocus}
            >
              {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <Menu
              label="Note actions"
              items={[
                ...noteMenuItems(note, editor),
                { label: showToolbar ? 'Hide toolbar' : 'Show toolbar', icon: <PanelTop size={14} />, run: () => store.getState().toggleToolbar() },
              ]}
            />
          </>
        )}
      </header>

      <div className="doc-scroll">
        <article className="doc" key={note.id}>
          {!isDaily && !inTrash && (() => {
            const book = notebooks.find((b) => b.id === note.notebookId);
            return (
              <Crumbs
                notebook={book ? { name: book.name, onClick: () => store.getState().setView({ type: 'notebook', id: book.id }) } : null}
                parents={parentsOf(note, notes)}
                title={title}
                onRoot={() => store.getState().setView({ type: 'all' })}
                onParent={(id) => store.getState().openNote(id)}
              />
            );
          })()}
          <textarea
            ref={titleRef}
            className="doc-title"
            rows={1}
            value={title}
            placeholder="Untitled"
            aria-label="Note title"
            readOnly={isDaily || inTrash}
            onFocus={() => (editingTitle.current = true)}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
            onBlur={() => {
              editingTitle.current = false;
              if (title !== note.title && !isDaily) void patchNote(note.id, { title });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === title.length)) {
                e.preventDefault();
                (document.querySelector('.prose') as HTMLElement | null)?.focus();
              }
            }}
          />
          <div className="doc-dates">Created {fullDate(note.createdAt)} · Last edited {fullDateTime(note.updatedAt)}</div>
          {!inTrash && <TagInput note={note} allTags={allTags} />}
          <Boundary message="This note could not be displayed." resetKey={note.id}>
            <NoteEditor note={note} readOnly={inTrash} />
          </Boundary>
        </article>
      </div>
      <footer className="doc-status">
        <span>{wordCount(note.text)} {wordCount(note.text) === 1 ? 'word' : 'words'}</span>
        <span>Edited {relativeTime(note.updatedAt).toLowerCase()}</span>
      </footer>
    </>
  );
}

export function EditorPane({ notes, notebooks, allTags }: { notes: Note[]; notebooks: Notebook[]; allTags: string[] }) {
  const noteId = useStore((s) => s.noteId);
  const pdf = useStore((s) => s.pdf);
  const note = notes.find((n) => n.id === noteId);
  const bg = noteBg(note?.color);

  return (
    <main className="editor-col" data-pdf={Boolean(pdf)} data-pdf-focus={Boolean(pdf?.focus)}>
      <div className="editor-split">
        <div className="doc-pane" data-color={bg ? '' : undefined} data-tone={noteTone(note?.color)} style={bg ? ({ '--note-bg': bg } as React.CSSProperties) : undefined}>
          {note ? (
            <Document key={note.id} note={note} notes={notes} notebooks={notebooks} allTags={allTags} />
          ) : (
            <div className="empty blank-state">
              <Feather size={26} strokeWidth={1.25} />
              <strong>Pick a note, or begin a new one</strong>
              <p>Alt N for a new note. Alt T for today.</p>
              <div className="blank-actions">
                <button type="button" className="btn primary" onClick={() => void createNote()}>New note</button>
                <button type="button" className="btn" onClick={() => void openDaily()}>Open today</button>
              </div>
            </div>
          )}
        </div>
        {pdf && (
          <div className="pdf-pane">
            <Boundary message="This PDF could not be displayed." resetKey={pdf.fileId}>
              <Suspense fallback={<div className="pdf-loading">Opening…</div>}>
                <PdfViewer key={pdf.fileId} target={pdf} />
              </Suspense>
            </Boundary>
          </div>
        )}
      </div>
    </main>
  );
}
