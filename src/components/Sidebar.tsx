import {
  Archive, BookOpen, CalendarDays, ChevronRight, CircleCheck, FileText, Hash, Layers, Library, Moon, Pencil, Pin, Plus, Settings2, Sun, Trash2, Laptop,
} from 'lucide-react';
import { useMemo, type DragEvent, type ReactNode } from 'react';
import { createNotebook, deleteNotebook, editTags, openDaily, patchNote, renameNotebook, retag } from '../lib/actions';
import { store, useStore, type ThemePref } from '../lib/store';
import { buildTagTree, normalizeTag, type TagNode } from '../lib/tags';
import { extractTasks } from '../lib/tasks';
import type { Note, Notebook, View } from '../lib/types';
import { Menu } from './Overlay';

export const NOTE_DRAG = 'application/x-clean-note';

function sameView(a: View, b: View) {
  if (a.type !== b.type) return false;
  if (a.type === 'notebook' && b.type === 'notebook') return a.id === b.id;
  if (a.type === 'tag' && b.type === 'tag') return a.path === b.path;
  return true;
}

export function dropProps(onNote: (id: string) => void) {
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes(NOTE_DRAG)) return;
      e.preventDefault();
      e.currentTarget.dataset.drop = 'true';
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      delete e.currentTarget.dataset.drop;
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      delete e.currentTarget.dataset.drop;
      const id = e.dataTransfer.getData(NOTE_DRAG);
      if (id) onNote(id);
    },
  };
}

function NavRow({ view, icon, label, count, onClick, extra, indent, leading, ...rest }: {
  view?: View;
  icon?: ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
  extra?: ReactNode;
  indent?: number;
  leading?: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const current = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const active = Boolean(view && !query && sameView(current, view));
  return (
    <div className="nav-row" data-active={active} style={indent ? { paddingLeft: 6 + indent * 14 } : undefined} {...rest}>
      {leading}
      <button
        type="button"
        className="nav-main"
        aria-current={active ? 'page' : undefined}
        onClick={onClick ?? (() => view && store.getState().setView(view))}
      >
        {icon}
        <span className="nav-label">{label}</span>
      </button>
      {extra && <span className="nav-extra">{extra}</span>}
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </div>
  );
}

function tagPrompt(node: TagNode) {
  store.getState().setDialog({
    kind: 'prompt',
    title: 'Rename tag',
    label: 'Tag path',
    value: node.path,
    confirm: 'Rename',
    hint: 'Use a slash to nest. Everything below this tag moves with it, and notes keep their tags.',
    onConfirm: (v) => {
      const to = normalizeTag(v);
      if (to && to !== node.path) void retag(node.path, to);
    },
  });
}

function TagRows({ nodes, depth }: { nodes: TagNode[]; depth: number }) {
  const collapsed = useStore((s) => s.collapsedTags);
  const toggle = useStore((s) => s.toggleTag);
  return (
    <>
      {nodes.map((n) => {
        const open = !collapsed.includes(n.path);
        return (
          <div key={n.path}>
            <NavRow
              view={{ type: 'tag', path: n.path }}
              label={n.name}
              count={n.count}
              indent={depth}
              leading={
                n.children.length ? (
                  <button
                    type="button"
                    className="tag-chevron"
                    data-open={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${n.path}`}
                    aria-expanded={open}
                    onClick={() => toggle(n.path)}
                  >
                    <ChevronRight size={13} />
                  </button>
                ) : (
                  <span className="tag-hash"><Hash size={12} /></span>
                )
              }
              extra={
                <Menu
                  label={`Actions for tag ${n.path}`}
                  items={[
                    { label: 'Rename or move', icon: <Pencil size={14} />, run: () => tagPrompt(n) },
                    {
                      label: 'Delete tag',
                      icon: <Trash2 size={14} />,
                      danger: true,
                      run: () =>
                        store.getState().setDialog({
                          kind: 'confirm',
                          title: `Delete #${n.path}?`,
                          body: `The tag and anything nested under it come off ${n.count} ${n.count === 1 ? 'note' : 'notes'}. The notes stay.`,
                          confirm: 'Delete tag',
                          danger: true,
                          onConfirm: () => void retag(n.path, ''),
                        }),
                    },
                  ]}
                />
              }
              {...dropProps((id) => void editTags(id, (tags) => (tags.includes(n.path) ? tags : [...tags, n.path])))}
            />
            {open && n.children.length > 0 && <TagRows nodes={n.children} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: Laptop, light: Sun, dark: Moon };

export function Sidebar({ notes, notebooks }: { notes: Note[]; notebooks: Notebook[] }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setDialog = useStore((s) => s.setDialog);

  const live = useMemo(() => notes.filter((n) => !n.trashedAt), [notes]);
  const shelved = useMemo(() => live.filter((n) => !n.archivedAt), [live]);
  const tree = useMemo(() => buildTagTree(shelved.map((n) => n.tags)), [shelved]);
  const openTasks = useMemo(() => shelved.reduce((sum, n) => sum + extractTasks(n).filter((t) => !t.done).length, 0), [shelved]);
  const trashCount = notes.length - live.length;
  const archiveCount = live.length - shelved.length;
  const pinnedCount = shelved.filter((n) => n.pinned).length;
  const allCount = shelved.filter((n) => n.kind === 'note').length;
  const ThemeIcon = THEME_ICON[theme];

  return (
    <nav className="sidebar" aria-label="Library">
      <div className="brand">
        <span className="brand-name">Clean Notes</span>
      </div>

      <div className="sidebar-scroll">
        <div className="nav-group">
          <NavRow view={{ type: 'all' }} icon={<Library size={15} />} label="All notes" count={allCount} />
          <NavRow view={{ type: 'daily' }} icon={<CalendarDays size={15} />} label="Today" onClick={() => void openDaily()} />
          <NavRow view={{ type: 'tasks' }} icon={<CircleCheck size={15} />} label="Tasks" count={openTasks} />
          <NavRow view={{ type: 'pdfs' }} icon={<FileText size={15} />} label="PDFs" />
          <NavRow view={{ type: 'pinned' }} icon={<Pin size={15} />} label="Pinned" count={pinnedCount} />
          <NavRow view={{ type: 'archive' }} icon={<Archive size={15} />} label="Archive" count={archiveCount} />
          <NavRow
            view={{ type: 'trash' }}
            icon={<Trash2 size={15} />}
            label="Trash"
            count={trashCount}
          />
        </div>

        <div className="nav-group">
          <div className="nav-head">
            <span>Notebooks</span>
            <button
              type="button"
              className="icon-btn small"
              aria-label="New notebook"
              title="New notebook"
              onClick={() =>
                setDialog({
                  kind: 'prompt',
                  title: 'New notebook',
                  label: 'Name',
                  value: '',
                  confirm: 'Create',
                  onConfirm: (v) => void createNotebook(v),
                })
              }
            >
              <Plus size={14} />
            </button>
          </div>
          {notebooks.length === 0 && <p className="nav-empty">Group related notes together.</p>}
          {notebooks.map((b) => (
            <NavRow
              key={b.id}
              view={{ type: 'notebook', id: b.id }}
              icon={<BookOpen size={15} />}
              label={b.name}
              count={live.filter((n) => n.notebookId === b.id).length}
              {...dropProps((id) => void patchNote(id, { notebookId: b.id, parentId: null }))}
              extra={
                <Menu
                  label={`Actions for ${b.name}`}
                  items={[
                    {
                      label: 'Rename',
                      icon: <Pencil size={14} />,
                      run: () =>
                        setDialog({
                          kind: 'prompt',
                          title: 'Rename notebook',
                          label: 'Name',
                          value: b.name,
                          confirm: 'Rename',
                          onConfirm: (v) => void renameNotebook(b.id, v),
                        }),
                    },
                    {
                      label: 'Delete notebook',
                      icon: <Trash2 size={14} />,
                      danger: true,
                      run: () =>
                        setDialog({
                          kind: 'confirm',
                          title: `Delete "${b.name}"?`,
                          body: 'Its notes are kept and stay available in All notes.',
                          confirm: 'Delete notebook',
                          danger: true,
                          onConfirm: () => void deleteNotebook(b.id),
                        }),
                    },
                  ]}
                />
              }
            />
          ))}
        </div>

        <div className="nav-group">
          <div className="nav-head"><span>Tags</span></div>
          {tree.length === 0 ? (
            <p className="nav-empty">Tag a note with work/ideas to start a tree.</p>
          ) : (
            <TagRows nodes={tree} depth={0} />
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setDialog({ kind: 'settings' })}>
          <Settings2 size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Theme: ${theme}. Switch to ${THEME_NEXT[theme]}`}
          title={`Theme: ${theme}`}
          onClick={() => setTheme(THEME_NEXT[theme])}
        >
          <ThemeIcon size={16} />
        </button>
        <span className="foot-spacer" />
        <span className="foot-note"><Layers size={12} /> On this device</span>
      </div>
    </nav>
  );
}
