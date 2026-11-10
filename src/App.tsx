import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { clearJournal, createNote, openDaily, recoverJournal } from './lib/actions';
import { db } from './lib/db';
import { seedIfEmpty } from './lib/seed';
import { startAutoSync } from './lib/sync';
import { useStore, store } from './lib/store';
import { allTagPaths } from './lib/tags';
import type { Note, Notebook } from './lib/types';
import { Dialogs, ToastHost } from './components/Dialogs';
import { EditorPane, Boundary } from './components/EditorPane';
import { ListColumn } from './components/ListColumn';
import { Sidebar } from './components/Sidebar';
import { MenuPopup, type MenuItem } from './components/Overlay';
import { ClipboardPaste, Copy, FileSymlink, Redo2, Scissors, TextSelect, Undo2 } from 'lucide-react';
import { currentEditor, linkToNote, sharedFiles } from './editor/NoteEditor';

type EditFlags = { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean; canUndo: boolean; canRedo: boolean };
declare global {
  interface Window {
    desktop?: {
      edit: (role: string) => void;
      onEditMenu: (cb: (p: { x: number; y: number; flags: EditFlags }) => void) => void;
      syncServer: () => Promise<string>;
      setSyncServer: (url: string) => Promise<void>;
      printPdf: (html: string, name: string) => Promise<boolean>;
      sharePdf: (html: string, name: string) => Promise<void>;
      shareFile: (bytes: ArrayBuffer, name: string) => Promise<void>;
    };
  }
}

/** Turns what public/share-target.js stored into a new note. */
async function openShared() {
  const cache = await caches.open('cn-share');
  const key = new URL('share-pending', location.href).href;
  const form = await (await cache.match(key))?.formData();
  await cache.delete(key);
  if (!form) return;
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const texts = await Promise.all(files.filter((f) => f.type.startsWith('text/')).map((f) => f.text()));
  const body = [form.get('text'), form.get('url'), ...texts].filter((t): t is string => typeof t === 'string' && Boolean(t.trim())).join('\n');
  const content = { type: 'doc', content: body ? body.split(/\r?\n/).map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })) : [{ type: 'paragraph' }] };
  sharedFiles.files.push(...files.filter((f) => !f.type.startsWith('text/')));
  await createNote({ type: 'all' }, { title: String(form.get('title') ?? ''), content });
}

const THEME_COLORS = { light: '#f5f2eb', dark: '#191816' };

function useTheme() {
  const pref = useStore((s) => s.theme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const mode = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
      document.documentElement.dataset.theme = mode;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[mode]);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

function Resizer({ target, min, max }: { target: 'sidebar' | 'list'; min: number; max: number }) {
  const width = useStore((s) => s.widths[target]);
  const setWidth = useStore((s) => s.setWidth);
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${target === 'sidebar' ? 'library' : 'note list'}`}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setWidth(target, Math.max(min, width - 16));
        if (e.key === 'ArrowRight') setWidth(target, Math.min(max, width + 16));
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => setWidth(target, Math.max(min, Math.min(max, width + ev.clientX - startX)));
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    />
  );
}

function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const showToast = useStore((s) => s.showToast);
  useEffect(() => {
    if (needRefresh) {
      showToast({
        message: 'A new version is ready.',
        sticky: true,
        action: { label: 'Update', run: () => void updateServiceWorker(true) },
      });
    }
  }, [needRefresh, showToast, updateServiceWorker]);
  return null;
}

export function App() {
  useTheme();
  const notes = useLiveQuery(() => db.notes.toArray(), [], [] as Note[]);
  const notebooks = useLiveQuery(() => db.notebooks.orderBy('createdAt').toArray(), [], [] as Notebook[]);
  const [ready, setReady] = useState(false);
  const [dbError, setDbError] = useState(false);
  const widths = useStore((s) => s.widths);
  const focusMode = useStore((s) => s.focusMode);
  const pane = useStore((s) => s.pane);
  const pdf = useStore((s) => s.pdf);
  const compact = useStore((s) => s.sidebarCompact);
  const searchRef = useRef<HTMLInputElement>(null);

  const allTags = useMemo(() => allTagPaths(notes.filter((n) => !n.trashedAt).map((n) => n.tags)), [notes]);

  // First run, plus the launch shortcuts declared in the web app manifest.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await recoverJournal();
        const seeded = await seedIfEmpty();
        const params = new URLSearchParams(location.search);
        const open = params.get('open');
        if (open) history.replaceState(null, '', location.pathname);
        if (!live) return;
        const s = store.getState();
        if (open === 'shared') await openShared();
        else if (open === 'today') await openDaily();
        else if (open === 'new') await createNote({ type: 'all' });
        else if (open === 'tasks') s.setView({ type: 'tasks' });
        else if (seeded) s.openNote(seeded);
        else if (s.noteId && !(await db.notes.get(s.noteId))) s.openNote(null);
        else if (s.view.type === 'daily') await openDaily();
        // Phones start on the list even if a note was open last time.
        if (matchMedia('(max-width: 767px)').matches && !open) s.setPane('list');
        setReady(true);
        startAutoSync();
      } catch {
        setDbError(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // A page restored from the back/forward cache is still live, so its journal is stale.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) clearJournal();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const s = store.getState();
        if (s.focusMode) s.toggleFocus();
        if (s.pdf?.focus) s.setPdf({ ...s.pdf, focus: false });
        s.setPane('list');
        const go = () => {
          searchRef.current?.focus();
          searchRef.current?.select();
        };
        go();
        setTimeout(go, 30);
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        store.getState().toggleFocus();
      } else if (e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        void createNote();
      } else if (e.altKey && e.code === 'KeyT') {
        e.preventDefault();
        void openDaily();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // On phones, the system back button steps from editor to list to library.
  useEffect(() => {
    const mobile = matchMedia('(max-width: 767px)');
    let depth = 0;
    const order = { sidebar: 0, list: 1, editor: 2 } as const;
    let last = store.getState().pane;
    const unsub = store.subscribe((s) => {
      if (s.pane === last) return;
      if (mobile.matches && s.pane === 'editor' && order[last] < order.editor) {
        history.pushState({ pane: 'editor' }, '');
        depth++;
      }
      last = s.pane;
    });
    const pop = () => {
      if (depth > 0) depth--;
      if (store.getState().pane === 'editor') store.getState().setPane('list');
    };
    window.addEventListener('popstate', pop);
    return () => {
      unsub();
      window.removeEventListener('popstate', pop);
    };
  }, []);

  if (dbError) {
    return (
      <div className="fatal">
        <h1>Clean Notes can't open its storage</h1>
        <p>The browser is blocking local storage, which often happens in private windows. Open the app in a normal window to continue.</p>
      </div>
    );
  }

  return (
    <div
      className="app"
      data-ready={ready}
      data-pane={pane}
      data-focus={focusMode || Boolean(pdf?.focus)}
      data-pdf={Boolean(pdf)}
      data-compact={compact}
      style={{ '--w-sidebar': compact ? '52px' : `${widths.sidebar}px`, '--w-list': `${widths.list}px` } as React.CSSProperties}
    >
      <Sidebar notes={notes} notebooks={notebooks} />
      <Resizer target="sidebar" min={190} max={380} />
      <ListColumn notes={notes} notebooks={notebooks} searchRef={searchRef} />
      <Resizer target="list" min={240} max={480} />
      <Boundary message="Reload the app to continue. Your saved notes are safe.">
        {ready ? <EditorPane notes={notes} notebooks={notebooks} allTags={allTags} /> : <main className="editor-col" />}
      </Boundary>
      {pane === 'sidebar' && <button type="button" className="scrim" aria-label="Close library" onClick={() => store.getState().setPane('list')} />}
      <Dialogs />
      <ToastHost />
      <UpdatePrompt />
      {window.desktop && <EditMenu />}
    </div>
  );
}

/** Right-click menu for text fields in the desktop app. Electron tells us where and what is possible, then performs the edit. */
function EditMenu() {
  const [menu, setMenu] = useState<{ rect: DOMRect; flags: EditFlags } | null>(null);
  useEffect(() => window.desktop!.onEditMenu(({ x, y, flags }) => setMenu({ rect: new DOMRect(x, y, 0, 0), flags })), []);
  // The selection's format bar would sit under this menu, so it hides while the menu is open.
  useEffect(() => void document.body.toggleAttribute('data-edit-menu', Boolean(menu)), [menu]);
  const f = menu?.flags;
  const item = (label: string, icon: React.ReactNode, role: string, enabled?: boolean): MenuItem => ({
    label, icon, disabled: !enabled, run: () => window.desktop!.edit(role),
  });
  // Chromium's undo can't see the editor's own history, but the editor answers these events. Plain inputs fall back to Chromium.
  const editor = menu && document.activeElement?.closest('.ProseMirror') ? currentEditor() : null;
  const history = (label: string, icon: React.ReactNode, role: 'undo' | 'redo'): MenuItem => ({
    label, icon, disabled: !(editor ? editor.can()[role]() : role === 'undo' ? f?.canUndo : f?.canRedo), run: () => {
      const e = new InputEvent('beforeinput', { inputType: role === 'undo' ? 'historyUndo' : 'historyRedo', bubbles: true, cancelable: true });
      if (document.activeElement?.dispatchEvent(e) !== false) window.desktop!.edit(role);
    },
  });
  const items = f
    ? [
        item('Cut', <Scissors size={14} />, 'cut', f.canCut),
        item('Copy', <Copy size={14} />, 'copy', f.canCopy),
        item('Paste', <ClipboardPaste size={14} />, 'paste', f.canPaste),
        history('Undo', <Undo2 size={14} />, 'undo'),
        history('Redo', <Redo2 size={14} />, 'redo'),
        item('Select All', <TextSelect size={14} />, 'selectAll', f.canSelectAll),
        ...(editor ? [{ label: 'Link to note', icon: <FileSymlink size={14} />, run: () => linkToNote(editor) }] : []),
      ]
    : [];
  return <MenuPopup items={items} rect={menu?.rect ?? null} keepFocus onClose={() => setMenu(null)} />;
}
