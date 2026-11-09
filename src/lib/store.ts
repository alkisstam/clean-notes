import { create } from 'zustand';
import type { ExportMode } from './export';
import type { View } from './types';
import { dateKey } from './dates';

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private windows may refuse storage. The app still works for the session. */
  }
};

export type ThemePref = 'system' | 'light' | 'dark';
export type Pane = 'sidebar' | 'list' | 'editor';
export type SortKey = 'updated' | 'created' | 'title';

export interface PdfTarget {
  fileId: string;
  page?: number;
  query?: string;
}
export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
}
export type DialogState =
  | { kind: 'confirm'; title: string; body?: string; confirm: string; danger?: boolean; onConfirm: () => void }
  | { kind: 'prompt'; title: string; label: string; value: string; confirm: string; hint?: string; allowEmpty?: boolean; onConfirm: (value: string) => void }
  | { kind: 'settings' }
  | { kind: 'noteColor'; noteIds: string[] }
  | { kind: 'export'; noteIds: string[]; mode: ExportMode }
  | { kind: 'pickNotebook'; onPick: (id: string | null) => void }
  | { kind: 'bulkTags'; noteIds: string[]; common: string[]; allTags: string[] }
  | { kind: 'pickNote'; onPick: (id: string, title: string) => void; onUnlink?: () => void };

interface State {
  view: View;
  noteId: string | null;
  query: string;
  dailyDate: string;
  pdf: PdfTarget | null;
  pane: Pane;
  focusMode: boolean;
  sort: SortKey;
  theme: ThemePref;
  widths: { sidebar: number; list: number };
  collapsedTags: string[];
  collapsedNotes: string[];
  showToolbar: boolean;
  focusTaskId: string | null;
  focusTitle: boolean;
  toast: Toast | null;
  dialog: DialogState | null;
  /** Null outside select mode. */
  selected: string[] | null;

  setView: (view: View) => void;
  openNote: (id: string | null, opts?: { taskId?: string; focusTitle?: boolean }) => void;
  setQuery: (q: string) => void;
  setDailyDate: (d: string) => void;
  setPdf: (p: PdfTarget | null) => void;
  setPane: (p: Pane) => void;
  toggleFocus: () => void;
  setSort: (s: SortKey) => void;
  setTheme: (t: ThemePref) => void;
  setWidth: (key: 'sidebar' | 'list', px: number) => void;
  toggleTag: (path: string) => void;
  toggleNote: (id: string) => void;
  toggleToolbar: () => void;
  clearFocusRequests: () => void;
  showToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: () => void;
  setDialog: (d: DialogState | null) => void;
  setSelected: (ids: string[] | null) => void;
  toggleSelected: (id: string) => void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  view: read<View>('cn.view', { type: 'all' }),
  noteId: read<string | null>('cn.note', null),
  query: '',
  dailyDate: dateKey(),
  pdf: null,
  pane: 'list',
  focusMode: false,
  sort: read<SortKey>('cn.sort', 'updated'),
  theme: (() => {
    try {
      return (localStorage.getItem('cn.theme') as ThemePref) || 'system';
    } catch {
      return 'system' as ThemePref;
    }
  })(),
  widths: read('cn.widths', { sidebar: 244, list: 320 }),
  collapsedTags: read<string[]>('cn.collapsedTags', []),
  collapsedNotes: read<string[]>('cn.collapsedNotes', []),
  showToolbar: read('cn.toolbar', true),
  focusTaskId: null,
  focusTitle: false,
  toast: null,
  dialog: null,
  selected: null,

  setView: (view) => {
    write('cn.view', view);
    set({ view, query: '', pane: 'list', selected: null });
  },
  openNote: (noteId, opts) => {
    write('cn.note', noteId);
    const samePdf = get().noteId === noteId;
    set({
      noteId,
      pane: noteId ? 'editor' : get().pane,
      focusTaskId: opts?.taskId ?? null,
      focusTitle: opts?.focusTitle ?? false,
      pdf: samePdf ? get().pdf : null,
    });
  },
  setQuery: (query) => set({ query, pane: 'list', selected: null }),
  setDailyDate: (dailyDate) => set({ dailyDate }),
  setPdf: (pdf) => set({ pdf }),
  setPane: (pane) => set({ pane }),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  setSort: (sort) => {
    write('cn.sort', sort);
    set({ sort });
  },
  setTheme: (theme) => {
    try {
      localStorage.setItem('cn.theme', theme);
    } catch {
      /* see write() */
    }
    set({ theme });
  },
  setWidth: (key, px) => {
    const widths = { ...get().widths, [key]: px };
    write('cn.widths', widths);
    set({ widths });
  },
  toggleToolbar: () => {
    write('cn.toolbar', !get().showToolbar);
    set({ showToolbar: !get().showToolbar });
  },
  toggleNote: (id) => {
    const cur = get().collapsedNotes;
    const next = cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id];
    write('cn.collapsedNotes', next);
    set({ collapsedNotes: next });
  },
  toggleTag: (path) => {
    const cur = get().collapsedTags;
    const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path];
    write('cn.collapsedTags', next);
    set({ collapsedTags: next });
  },
  clearFocusRequests: () => set({ focusTaskId: null, focusTitle: false }),
  showToast: (t) => set({ toast: { ...t, id: ++toastId } }),
  dismissToast: () => set({ toast: null }),
  setDialog: (dialog) => set({ dialog }),
  setSelected: (selected) => set({ selected }),
  toggleSelected: (id) => set((s) => ({ selected: s.selected?.includes(id) ? s.selected.filter((x) => x !== id) : [...(s.selected ?? []), id] })),
}));

export const store = useStore;
