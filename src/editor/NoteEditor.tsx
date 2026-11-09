import type { Editor, JSONContent, Range } from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import {
  BetweenHorizontalEnd, BetweenVerticalEnd, Bold, CalendarPlus, Check, ChevronsLeftRight, ClipboardPaste, Code, Copy, ExternalLink, FileSymlink, FileText,
  Ellipsis, EllipsisVertical, Grid2x2, Heading2, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, ListTodo, Minus, Paintbrush, Quote, Scissors, SquareCode, Strikethrough,
  Table, Table2, Trash2, Underline, X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { journalEdit, registerFlusher, saveContent } from '../lib/actions';
import { importImage, looksLikeImage } from '../lib/images';
import { importPdf, looksLikePdf } from '../lib/pdf';
import { Menu, MenuPopup } from '../components/Overlay';
import { store, useStore } from '../lib/store';
import type { Note } from '../lib/types';
import { ImageBlock } from './ImageBlock';
import { PdfAttachment } from './PdfAttachment';
import { SlashCommands, slashItems, type SlashHandlers, type SlashItem } from './slash';
import { FONT_SIZES, PREVIEW, styleTargets, TableStyle, TableStyleSheet, type Styling } from './TableStyle';
import { dueHooks, TaskItemDue } from './TaskItemDue';
import { Calendar } from '../components/Calendar';
import { db } from '../lib/db';
import { dateKey } from '../lib/dates';

const CELL_MIN_WIDTH = 80;

/** Everything that decides how a note's document turns into HTML. */
export const noteExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
  Highlight,
  TextStyle,
  FontSize,
  TaskList,
  TaskItemDue.configure({ nested: true }),
  TableKit.configure({ table: { resizable: true, cellMinWidth: CELL_MIN_WIDTH } }),
  TableStyle,
  PdfAttachment,
  ImageBlock,
];

const SAVE_DELAY = 350;

const canInsert = (file: File) => looksLikePdf(file) || looksLikeImage(file);

async function insertFiles(editor: Editor, files: File[], dropAt?: number) {
  const s = store.getState();
  let at = dropAt;
  for (const file of files.filter(canInsert)) {
    s.showToast({ message: `Adding ${file.name}…`, sticky: true });
    try {
      let node;
      if (looksLikePdf(file)) {
        const meta = await importPdf(file);
        node = { type: 'pdfAttachment', attrs: { fileId: meta.id, name: meta.name } };
      } else {
        const image = await importImage(file);
        // Small pictures keep their own size rather than stretching to the column.
        const width = Math.min(100, Math.max(15, Math.round((image.width / 620) * 100)));
        node = { type: 'noteImage', attrs: { imageId: image.id, alt: '', width } };
      }
      if (editor.isDestroyed) continue;
      // Leave the cursor after the block. If the block stayed selected, the next
      // keystroke would replace it.
      const chain = editor.chain().focus();
      (at !== undefined ? chain.insertContentAt(at, node) : chain.insertContent(node))
        .command(({ tr, state }) => {
          // A block at the very end has no text after it yet, so give it some.
          if (tr.selection.$to.pos >= tr.doc.content.size) tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create());
          tr.setSelection(Selection.near(tr.selection.$to, 1));
          return true;
        })
        .run();
      // Further files follow from the cursor, so they stay in the order chosen.
      at = undefined;
      s.showToast({ message: `Added ${file.name}` });
    } catch (e) {
      s.showToast({ message: e instanceof Error ? e.message : 'That file could not be added.' });
    }
  }
}

// The editor that commands from outside the page, such as the Android app's + menu, act on.
let current: Editor | null = null;
export const insertIntoEditor = (files: File[]) => current && insertFiles(current, files);
/** Files shared into the app, added by the next editor to open. */
export const sharedFiles = { files: [] as File[] };
export const currentEditor = () => current;
/** Hosts listen here for every change to the open editor, as the Android app does for its undo and redo buttons. */
export const editorHooks = { onChange: null as ((editor: Editor) => void) | null };

export const NOTE_HREF = '#note/';

/** Hosts override how a note is picked and opened, as the Android app does with its own screens. */
export const noteLinks = {
  /** `unlink` is given when the selection already links to a note. */
  pick: (apply: (id: string, title: string) => void, unlink?: () => void) => store.getState().setDialog({ kind: 'pickNote', onPick: apply, onUnlink: unlink }),
  open: async (id: string) => {
    const note = await db.notes.get(id);
    if (note && !note.trashedAt) store.getState().openNote(id);
    else store.getState().showToast({ message: 'That note was deleted' });
  },
};

/** Links the selection to a picked note, or inserts the note's title as a link when nothing is selected. */
export function linkToNote(editor: Editor) {
  const { from, to } = editor.state.selection;
  const at = () => {
    const end = editor.state.doc.content.size;
    return { from: Math.min(from, end), to: Math.min(to, end) };
  };
  const linked = Boolean(noteIdOf(editor.getAttributes('link').href));
  noteLinks.pick(
    (id, title) => {
      const href = NOTE_HREF + id;
      const chain = editor.chain().focus();
      if (from === to) chain.insertContentAt(at().from, { type: 'text', text: title || 'Untitled', marks: [{ type: 'link', attrs: { href } }] }).run();
      else chain.setTextSelection(at()).setLink({ href }).run();
    },
    linked ? () => editor.chain().focus().setTextSelection(at()).extendMarkRange('link').unsetLink().run() : undefined,
  );
}

const noteIdOf = (href: string | undefined) => (href?.startsWith(NOTE_HREF) ? href.slice(NOTE_HREF.length) : null);

type DueState = { anchor: DOMRect; due: string | null; set: (due: string | null) => void };

function DuePopover({ state, onClose }: { state: DueState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const { offsetWidth: w, offsetHeight: h } = ref.current!;
    const pad = 8;
    const { anchor } = state;
    const top = anchor.top - h - 6 >= pad ? anchor.top - h - 6 : Math.min(anchor.bottom + 6, innerHeight - h - pad);
    setPos({ left: Math.max(pad, Math.min(anchor.right - w, innerWidth - w - pad)), top });
  }, [state]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down, true);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [onClose]);
  const pick = (due: string | null) => {
    state.set(due);
    onClose();
  };
  return createPortal(
    <div ref={ref} className="due-popover" role="dialog" aria-label="Due date" style={pos ?? { visibility: 'hidden' }}>
      <Calendar selected={state.due ?? dateKey()} onPick={pick} />
      {state.due && <button type="button" className="link-btn" onClick={() => pick(null)}>Clear date</button>}
    </div>,
    document.body,
  );
}

/** Hosts override placement, as the Android app does to keep clear of the system's own selection bar above. */
export const formatMenu = { placement: 'top' as 'top' | 'bottom' };

function pickFiles(editor: Editor, accept: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = true;
  input.onchange = () => void insertFiles(editor, [...(input.files ?? [])]);
  input.click();
}

interface SlashState {
  items: SlashItem[];
  rect: DOMRect | null;
  command: (item: SlashItem) => void;
}

function SlashMenu({ state, index, onHover }: { state: SlashState; index: number; onHover: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state.rect) return;
    const pad = 12;
    const { offsetWidth: w, offsetHeight: h } = el;
    const below = state.rect.bottom + 6;
    const top = below + h > innerHeight - pad ? Math.max(pad, state.rect.top - h - 6) : below;
    setPos({ left: Math.max(pad, Math.min(state.rect.left, innerWidth - w - pad)), top });
  }, [state.rect, state.items.length]);

  useEffect(() => {
    ref.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  let group = '';
  return createPortal(
    <div ref={ref} className="slash-menu" style={pos} role="listbox" aria-label="Insert block">
      {state.items.length === 0 && <div className="slash-empty">No matching block</div>}
      {state.items.map((item, i) => {
        const head = item.group !== group ? item.group : null;
        group = item.group;
        return (
          <div key={item.id}>
            {head && <div className="slash-group">{head}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              data-active={i === index}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                state.command(item);
              }}
            >
              <span>{item.title}</span>
              <small>{item.hint}</small>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

const formatButtons = (editor: Editor) => [
  { label: 'Bold', icon: Bold, active: 'bold', run: () => editor.chain().focus().toggleBold().run() },
  { label: 'Italic', icon: Italic, active: 'italic', run: () => editor.chain().focus().toggleItalic().run() },
  { label: 'Underline', icon: Underline, active: 'underline', run: () => editor.chain().focus().toggleUnderline().run() },
  { label: 'Strikethrough', icon: Strikethrough, active: 'strike', run: () => editor.chain().focus().toggleStrike().run() },
  { label: 'Inline code', icon: Code, active: 'code', run: () => editor.chain().focus().toggleCode().run() },
  { label: 'Highlight', icon: Highlighter, active: 'highlight', run: () => editor.chain().focus().toggleHighlight().run() },
];

/** The screen area below the formatting toolbar, read fresh each time Floating UI positions a menu. */
const toolbarEdge = (editor: Editor) => ({
  x: 0,
  get y() {
    const bar = editor.view.dom.parentElement?.previousElementSibling;
    return bar?.classList.contains('editor-toolbar') ? bar.getBoundingClientRect().bottom : 0;
  },
  get width() { return innerWidth; },
  get height() { return innerHeight; },
});

function Toolbar({ editor, items }: { editor: Editor; items: SlashItem[] }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  // Slash items replace the typed "/query"; here there is none, so give them an empty range.
  const slash = (id: string) => {
    const at = editor.state.selection.from;
    items.find((i) => i.id === id)?.run(editor, { from: at, to: at });
  };
  const block = [1, 2, 3].find((level) => editor.isActive('heading', { level }));
  const size = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? '';
  const startLink = () =>
    store.getState().setDialog({
      kind: 'prompt',
      title: 'Link',
      label: 'Address',
      value: editor.getAttributes('link').href ?? '',
      confirm: 'Apply',
      allowEmpty: true,
      onConfirm: (raw) => {
        const value = raw.trim();
        const chain = editor.chain().focus().extendMarkRange('link');
        if (!value) chain.unsetLink().run();
        else chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}` }).run();
      },
    });
  const btn = (label: string, Icon: typeof Bold, run: () => void, active?: boolean) => (
    <button
      key={label}
      type="button"
      aria-label={label}
      title={label}
      data-active={active}
      aria-pressed={active}
      // Keep the editor's selection while clicking.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon size={15} />
    </button>
  );

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      <select
        aria-label="Text style"
        value={block ? `h${block}` : 'text'}
        onChange={(e) => slash(e.target.value)}
      >
        <option value="text">Text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <select
        aria-label="Font size"
        value={size}
        onChange={(e) => {
          const chain = editor.chain().focus();
          (e.target.value ? chain.setFontSize(e.target.value) : chain.unsetFontSize()).run();
        }}
      >
        <option value="">Size</option>
        {size && !FONT_SIZES.includes(size) && <option value={size}>{parseInt(size)}</option>}
        {FONT_SIZES.map((s) => <option key={s} value={s}>{parseInt(s)}</option>)}
      </select>
      <span className="toolbar-sep" />
      {formatButtons(editor).map(({ label, icon, active, run }) => btn(label, icon, run, editor.isActive(active)))}
      {btn('Link', Link2, startLink, editor.isActive('link'))}
      <span className="toolbar-sep" />
      {btn('To-do list', ListTodo, () => slash('todo'), editor.isActive('taskList'))}
      {btn('Bullet list', List, () => slash('bullet'), editor.isActive('bulletList'))}
      {btn('Numbered list', ListOrdered, () => slash('number'), editor.isActive('orderedList'))}
      {btn('Quote', Quote, () => slash('quote'), editor.isActive('blockquote'))}
      {btn('Code block', SquareCode, () => slash('code'), editor.isActive('codeBlock'))}
      <span className="toolbar-sep" />
      {btn('Table', Table, () => slash('table'))}
      {btn('Divider', Minus, () => slash('divider'))}
      {btn('Image', ImagePlus, () => slash('image'))}
      {btn('PDF', FileText, () => slash('pdf'))}
      {btn("Today's date", CalendarPlus, () => slash('date'))}
      {editor.isActive('table') && (
        <Menu
          label="Table actions"
          className="menu-trigger"
          trigger={<Table2 size={15} />}
          items={items.filter((i) => i.inTable).map((i) => ({
            label: i.title,
            icon: i.id.startsWith('del') ? <Trash2 size={14} /> : i.id === 'row' ? <BetweenHorizontalEnd size={14} /> : <BetweenVerticalEnd size={14} />,
            danger: i.id.startsWith('del'),
            run: () => slash(i.id),
          }))}
        />
      )}
    </div>
  );
}

// Same per-cell colwidth update as the table extension's mouse resize.
function setColumnWidth(editor: Editor, cellPos: number, width: number) {
  const { state } = editor.view;
  const $cell = state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const map = TableMap.get(table);
  const col = map.colCount(cellPos - start) + ($cell.nodeAfter?.attrs.colspan ?? 1) - 1;
  const tr = state.tr;
  for (let row = 0; row < map.height; row++) {
    const i = row * map.width + col;
    if (row && map.map[i] === map.map[i - map.width]) continue;
    const pos = map.map[i];
    const attrs = table.nodeAt(pos)!.attrs;
    const index = attrs.colspan === 1 ? 0 : col - map.colCount(pos);
    if (attrs.colwidth?.[index] === width) continue;
    const colwidth = attrs.colwidth ? [...attrs.colwidth] : Array(attrs.colspan).fill(0);
    colwidth[index] = width;
    tr.setNodeMarkup(start + pos, null, { ...attrs, colwidth });
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

type Handle = { cellPos: number; x: number; width: number };

// Kept for pasting when the page may not read the system clipboard, as in Android's WebView.
let lastCopy = { html: '', text: '' };

async function copySelection(editor: Editor) {
  const { dom, text } = editor.view.serializeForClipboard(editor.state.selection.content());
  lastCopy = { html: dom.innerHTML, text };
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([lastCopy.html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch {
    await navigator.clipboard?.writeText(text).catch(() => {});
  }
}

async function pasteClipboard(editor: Editor) {
  let { html, text } = lastCopy;
  try {
    const [item] = await navigator.clipboard.read();
    if (item?.types.includes('text/html')) html = await (await item.getType('text/html')).text();
    else if (item?.types.includes('text/plain')) [html, text] = ['', await (await item.getType('text/plain')).text()];
  } catch {
    // Not allowed to read it: fall back to what was copied here.
  }
  // Goes through the table extension's paste handling, which fits copied cells into the selected ones.
  if (html) editor.view.pasteHTML(html);
  else if (text) editor.view.pasteText(text);
}

type TableMenu = { kind: 'row' | 'col' | 'table'; rect: DOMRect; anchor: HTMLElement };

const hasSoftKeyboard = () => matchMedia('(hover: none)').matches;

// Below the table, as the selection the menu acts on stays in view.
const belowTable = (el: HTMLElement, table: DOMRect) => {
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left, r.top, r.width, table.bottom - r.top);
};

// Android's WebView scrolls to the selection's head cell, which is otherwise the last one.
const headFirst = (sel: CellSelection) => new CellSelection(sel.$headCell, sel.$anchorCell);

// Controls around the table holding the cursor: a handle beside its row and above its column,
// a resize pill on every column border (the extension's own resize is mouse-only), and a table menu at the corner.
function TableControls({ editor }: { editor: Editor }) {
  const [box, setBox] = useState<{ pos: number; rect: DOMRect; cellPos: number; cell: DOMRect | null; handles: Handle[]; picked: DOMRect | null } | null>(null);
  // The row or column chosen by a first tap on its handle.
  const picked = useRef<'row' | 'col' | null>(null);
  const growFrom = useRef<number | null>(null);
  const cornerOpen = useRef(false);
  const styleOpen = useRef(false);
  const [menu, setMenu] = useState<TableMenu | null>(null);
  const [styling, setStyling] = useState<Styling | null>(null);
  const drag = useRef<{ cellPos: number; startX: number; startWidth: number } | null>(null);
  useEffect(() => {
    const update = () => {
      const { $from } = editor.state.selection;
      if (!(editor.state.selection instanceof CellSelection)) picked.current = null;
      let pos = -1;
      let cellPos = -1;
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === 'table') pos = $from.before(d);
        if (cellPos < 0 && (name === 'tableCell' || name === 'tableHeader')) cellPos = $from.before(d);
      }
      // Selecting and the table menu blur the editor on purpose, to put the keyboard away.
      const dom = pos >= 0 && (editor.isFocused || drag.current || picked.current || cornerOpen.current) ? (editor.view.nodeDOM(pos) as HTMLElement | null) : null;
      if (!dom) {
        setMenu(null);
        cornerOpen.current = false;
        return setBox(null);
      }
      const rect = dom.getBoundingClientRect();
      const handles: Handle[] = [];
      for (const cell of dom.querySelectorAll<HTMLElement>('tr:first-child > th, tr:first-child > td')) {
        const r = cell.getBoundingClientRect();
        // Skip borders scrolled out of the table's box.
        if (r.right < rect.left + 4 || r.right > rect.right + 1) continue;
        handles.push({ cellPos: editor.view.posAtDOM(cell, 0) - 1, x: r.right, width: cell.offsetWidth });
      }
      const cell = cellPos >= 0 ? (editor.view.nodeDOM(cellPos) as HTMLElement | null)?.getBoundingClientRect() ?? null : null;
      let chosen: DOMRect | null = null;
      if (picked.current) {
        const rects = [...dom.querySelectorAll('.selectedCell')].map((c) => c.getBoundingClientRect());
        const left = Math.max(rect.left, Math.min(...rects.map((r) => r.left)));
        const right = Math.min(rect.right, Math.max(...rects.map((r) => r.right)));
        const top = Math.min(...rects.map((r) => r.top));
        chosen = new DOMRect(left, top, right - left, Math.max(...rects.map((r) => r.bottom)) - top);
      }
      setBox({ pos, rect, cellPos, cell, handles, picked: chosen });
    };
    // A tap away from the note ends selecting, which the blur no longer does.
    const outside = (e: PointerEvent) => {
      if (!picked.current || (e.target as Element).closest('.prose, .editor-toolbar, .table-handle, .table-grip, .table-corner, .menu, .sheet-backdrop')) return;
      const { tr, selection } = editor.state;
      editor.view.dispatch(tr.setSelection(Selection.near(selection.$from)));
    };
    document.addEventListener('pointerdown', outside);
    editor.on('transaction', update);
    editor.on('blur', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('pointerdown', outside);
      editor.off('transaction', update);
      editor.off('blur', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);
  // The keyboard going away after the menu opened changes where it fits.
  useEffect(() => {
    if (box) setMenu((m) => m && { ...m, rect: belowTable(m.anchor, box.rect) });
  }, [box]);

  // Outside the early returns: the editor blurs while the sheet is open, which clears the box.
  const sheet = styling && (
    <TableStyleSheet
      editor={editor} styling={styling}
      onClose={() => {
        styleOpen.current = false;
        setStyling(null);
      }}
    />
  );
  if (!box) return sheet;

  const table = editor.state.doc.nodeAt(box.pos);
  if (!table) return sheet;
  const startStyle = (kind: Styling['kind']) => {
    const next = styleTargets(editor, kind, box.pos);
    if (!next.targets.length) return;
    styleOpen.current = true;
    setStyling(next);
    (editor.view.nodeDOM(box.pos) as HTMLElement).scrollIntoView({ block: 'start' });
    editor.commands.blur();
  };
  const select =(kind: TableMenu['kind']) => {
    const { doc } = editor.state;
    let sel: CellSelection;
    if (kind === 'table') {
      const map = TableMap.get(table);
      sel = new CellSelection(doc.resolve(box.pos + 1 + map.map[0]), doc.resolve(box.pos + 1 + map.map[map.map.length - 1]));
    } else {
      const $cell = doc.resolve(box.cellPos);
      sel = kind === 'row' ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell);
    }
    editor.view.dispatch(editor.state.tr.setSelection(headFirst(sel)));
  };
  const open =(kind: TableMenu['kind'], el: HTMLElement) => {
    if (menu?.kind === kind) return closeMenu();
    setMenu({ kind, rect: belowTable(el, box.rect), anchor: el });
  };
  const closeMenu = () => {
    setMenu(null);
    cornerOpen.current = false;
    // Deferred so a menu item that keeps the keyboard away, run right after this, is seen.
    queueMicrotask(() => {
      if (hasSoftKeyboard() && !picked.current && !styleOpen.current) editor.view.focus();
    });
  };
  const hideKeyboard = () => {
    if (hasSoftKeyboard()) editor.commands.blur();
  };
  const tapHandle = (kind: 'row' | 'col', el: HTMLElement) => {
    hideKeyboard();
    if (picked.current === kind) return open(kind, el);
    picked.current = kind;
    select(kind);
  };
  // The cell in the line that stays put while the opposite grip is dragged.
  const fixedCell = (kind: 'row' | 'col', end: boolean) => {
    const { $anchorCell, $headCell } = editor.state.selection as CellSelection;
    const map = TableMap.get(table);
    const start = box.pos + 1;
    const r = map.rectBetween($anchorCell.pos - start, $headCell.pos - start);
    return start + map.map[kind === 'col' ? (end ? r.left : r.right - 1) : (end ? r.top : r.bottom - 1) * map.width];
  };
  const growTo = (kind: 'row' | 'col', x: number, y: number) => {
    if (growFrom.current === null) return;
    const el = document.elementsFromPoint(x, y).map((n) => n.closest('td, th')).find(Boolean);
    if (!el || !(editor.view.nodeDOM(box.pos) as HTMLElement).contains(el)) return;
    const { doc, selection } = editor.state;
    const $fixed = doc.resolve(growFrom.current);
    const $head = doc.resolve(editor.view.posAtDOM(el, 0) - 1);
    const next = headFirst(kind === 'col' ? CellSelection.colSelection($fixed, $head) : CellSelection.rowSelection($fixed, $head));
    if (!next.eq(selection)) editor.view.dispatch(editor.state.tr.setSelection(next));
  };
  const add = (where: 'row' | 'col') => {
    // Inside the last cell of the last row: just before its closing tokens.
    const inLast = box.pos + table.nodeSize - 3;
    const chain = editor.chain().focus().command(({ tr }) => {
      tr.setSelection(Selection.near(tr.doc.resolve(inLast), -1));
      return true;
    });
    (where === 'row' ? chain.addRowAfter() : chain.addColumnAfter()).run();
  };
  const remove = (kind: TableMenu['kind']) => {
    const chain = editor.chain().focus();
    (kind === 'row' ? chain.deleteRow() : kind === 'col' ? chain.deleteColumn() : chain.deleteTable()).run();
  };

  const tools = menu && [
    { label: 'Cut', icon: <Scissors size={18} />, run: () => void copySelection(editor).then(() => remove(menu.kind)) },
    { label: 'Copy', icon: <Copy size={18} />, run: () => void copySelection(editor) },
    { label: 'Paste', icon: <ClipboardPaste size={18} />, run: () => void pasteClipboard(editor) },
  ];
  const items = !menu ? [] : menu.kind === 'row'
    ? [
      { label: 'Add row', icon: <BetweenHorizontalEnd size={16} />, run: () => editor.chain().focus().addRowAfter().run() },
      { label: 'Cell style', icon: <Paintbrush size={16} />, run: () => startStyle('cell') },
      { label: 'Delete row', icon: <Trash2 size={16} />, danger: true, run: () => remove('row') },
    ]
    : menu.kind === 'col'
      ? [
        { label: 'Add column', icon: <BetweenVerticalEnd size={16} />, run: () => editor.chain().focus().addColumnAfter().run() },
        { label: 'Cell style', icon: <Paintbrush size={16} />, run: () => startStyle('cell') },
        { label: 'Delete column', icon: <Trash2 size={16} />, danger: true, run: () => remove('col') },
      ]
      : [
        { label: 'Add row', icon: <BetweenHorizontalEnd size={16} />, run: () => add('row') },
        { label: 'Add column', icon: <BetweenVerticalEnd size={16} />, run: () => add('col') },
        { label: 'Table style', icon: <Paintbrush size={16} />, run: () => startStyle('table') },
        { label: 'Delete table', icon: <Trash2 size={16} />, danger: true, run: () => remove('table') },
      ];

  const { rect, cell } = box;
  const above = rect.top - 13;
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const chosen = box.picked;
  const kind = chosen && picked.current;
  const grip = (end: boolean) => kind && chosen && (
    <span
      className="table-grip" data-axis={kind} aria-hidden="true"
      style={kind === 'col'
        ? { left: end ? chosen.right : chosen.left, top: chosen.top + chosen.height / 2 }
        : { left: chosen.left + chosen.width / 2, top: end ? chosen.bottom : chosen.top }}
      onMouseDown={keep}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        growFrom.current = fixedCell(kind, end);
      }}
      onPointerMove={(e) => growTo(kind, e.clientX, e.clientY)}
      onPointerUp={() => (growFrom.current = null)}
      onPointerCancel={() => (growFrom.current = null)}
    />
  );
  return createPortal(
    <>
      {sheet}
      <button
        type="button" className="table-corner" aria-label="Table options" title="Table options" data-open={menu?.kind === 'table'}
        style={{ left: Math.max(14, rect.left - 12), top: Math.max(14, rect.top - 14) }}
        onMouseDown={keep}
        onClick={(e) => {
          if (menu?.kind !== 'table') {
            picked.current = null;
            cornerOpen.current = true;
            select('table');
            hideKeyboard();
          }
          open('table', e.currentTarget);
        }}
      ><Grid2x2 size={16} /></button>
      {chosen && <div className="table-selection" style={{ left: chosen.left, top: chosen.top, width: chosen.width, height: chosen.height }} />}
      {grip(false)}
      {grip(true)}
      {cell && (
        <>
          {(kind ? kind === 'row' : menu?.kind !== 'col') && <button
            type="button" className="table-handle" data-axis="row" aria-label="Row options" title="Row options" data-open={menu?.kind === 'row'} data-picked={kind ? '' : undefined}
            style={{ left: Math.max(kind ? 9 : 6, rect.left - 10), top: chosen ? chosen.top + chosen.height / 2 : cell.top + cell.height / 2 }}
            onMouseDown={keep} onClick={(e) => tapHandle('row', e.currentTarget)}
          >{kind && <EllipsisVertical size={14} />}</button>}
          {(kind ? kind === 'col' : menu?.kind !== 'row') && <button
            type="button" className="table-handle" data-axis="col" aria-label="Column options" title="Column options" data-open={menu?.kind === 'col'} data-picked={kind ? '' : undefined}
            style={{ left: chosen ? chosen.left + chosen.width / 2 : cell.left + cell.width / 2, top: above }}
            onMouseDown={keep} onClick={(e) => tapHandle('col', e.currentTarget)}
          >{kind && <Ellipsis size={14} />}</button>}
        </>
      )}
      {!kind && box.handles.map((h) => (
        <span
          key={h.cellPos} className="table-resize" aria-hidden="true"
          style={{ left: Math.min(h.x, innerWidth - 16), top: above }}
          onMouseDown={keep}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { cellPos: h.cellPos, startX: e.clientX, startWidth: h.width };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setColumnWidth(editor, d.cellPos, Math.max(CELL_MIN_WIDTH, Math.round(d.startWidth + e.clientX - d.startX)));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        ><ChevronsLeftRight size={12} /></span>
      ))}
      <MenuPopup items={items} tools={tools ?? undefined} rect={menu?.rect ?? null} anchor={menu?.anchor} keepFocus onClose={closeMenu} />
    </>,
    document.body,
  );
}

const PICK_ROW = 44;

function Wheel({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current!.scrollTop = (value - 1) * PICK_ROW;
    // Only on open; afterwards the scroll position is the source of the value.
  }, []);
  return (
    <div
      ref={ref} className="wheel" role="listbox" aria-label={label}
      onScroll={(e) => onChange(Math.min(10, Math.max(1, Math.round(e.currentTarget.scrollTop / PICK_ROW) + 1)))}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <button
          key={i} type="button" role="option" aria-selected={value === i + 1}
          onClick={() => ref.current!.scrollTo({ top: i * PICK_ROW, behavior: 'smooth' })}
        >{i + 1}</button>
      ))}
    </div>
  );
}

function TablePicker({ onDone, onClose }: { onDone: (rows: number, cols: number) => void; onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet table-picker" role="dialog" aria-label="Table properties" onClick={(e) => e.stopPropagation()}>
        <h2>Table properties</h2>
        <div className="table-picker-wheels">
          <div><span>Rows</span><Wheel value={rows} onChange={setRows} label="Rows" /></div>
          <X size={18} className="table-picker-x" />
          <div><span>Columns</span><Wheel value={cols} onChange={setCols} label="Columns" /></div>
        </div>
        <div className="sheet-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => onDone(rows, cols)}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FormatMenu({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startLink = () => {
    setUrl(editor.getAttributes('link').href ?? '');
    setLinking(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const applyLink = () => {
    const value = url.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!value) chain.unsetLink().run();
    else chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}` }).run();
    setLinking(false);
  };

  const buttons = formatButtons(editor);

  return (
    <BubbleMenu
      editor={editor}
      // Flip below the selection before the toolbar would cover it, wherever the toolbar sits on screen.
      options={{ placement: formatMenu.placement, offset: formatMenu.placement === 'bottom' ? 28 : 8, flip: { boundary: toolbarEdge(editor), padding: { top: 8 } } }}
      shouldShow={({ editor: e, state, from, to }) => {
        if (linking) return true;
        if (from === to || !e.isEditable || !e.isFocused || state.selection instanceof CellSelection) return false;
        if (e.isActive('codeBlock') || e.isActive('pdfAttachment') || e.isActive('noteImage')) return false;
        return state.doc.textBetween(from, to).length > 0;
      }}
    >
      <div className="format-menu" role="toolbar" aria-label="Text formatting">
        {linking ? (
          <form
            className="format-link"
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
          >
            <input
              ref={inputRef}
              value={url}
              placeholder="Paste or type a link"
              aria-label="Link address"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setLinking(false);
                  editor.commands.focus();
                }
              }}
            />
            <button type="submit" aria-label="Apply link" title="Apply link"><Check size={15} /></button>
            <button type="button" aria-label="Cancel" title="Cancel" onClick={() => setLinking(false)}><X size={15} /></button>
          </form>
        ) : (
          <>
            <button
              type="button"
              aria-label="Heading"
              title="Heading"
              data-active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <Heading2 size={16} />
            </button>
            <span className="format-sep" />
            {buttons.map(({ label, icon: Icon, active, run }) => (
              <button key={label} type="button" aria-label={label} title={label} data-active={editor.isActive(active)} onClick={run}>
                <Icon size={15} />
              </button>
            ))}
            <span className="format-sep" />
            <button type="button" aria-label="Link" title="Link" data-active={editor.isActive('link')} onClick={startLink}>
              <Link2 size={15} />
            </button>
            <button type="button" aria-label="Link to note" title="Link to note" onClick={() => linkToNote(editor)}>
              <FileSymlink size={15} />
            </button>
            {editor.isActive('link') && (
              <button
                type="button"
                aria-label="Open link"
                title="Open link"
                onClick={() => {
                  const href: string = editor.getAttributes('link').href;
                  const id = noteIdOf(href);
                  if (id) void noteLinks.open(id);
                  else window.open(href, '_blank', 'noopener');
                }}
              >
                <ExternalLink size={15} />
              </button>
            )}
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

interface Props {
  note: Note;
  readOnly?: boolean;
  editorRef?: RefObject<Editor | null>;
}

export function NoteEditor({ note, readOnly, editorRef }: Props) {
  const writer = useMemo(() => crypto.randomUUID(), []);
  const pending = useRef<JSONContent | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const noteId = note.id;

  const flush = useRef(() => {
    window.clearTimeout(timer.current);
    if (!pending.current) return;
    const content = pending.current;
    pending.current = null;
    void saveContent(noteId, content, `${writer}:${crypto.randomUUID()}`);
  });

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [picking, setPicking] = useState(false);
  const [due, setDue] = useState<DueState | null>(null);
  useEffect(() => {
    if (readOnly) return;
    dueHooks.open = (anchor, value, set) => setDue({ anchor, due: value, set });
    return () => {
      dueHooks.open = null;
    };
  }, [readOnly]);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashLive = useRef({ state: slash, index: slashIndex });
  slashLive.current = { state: slash, index: slashIndex };

  const handlers = useMemo<SlashHandlers>(() => {
    const toState = (p: SuggestionProps<SlashItem, SlashItem>): SlashState => ({
      items: p.items,
      rect: p.clientRect?.() ?? null,
      command: (item) => p.command(item),
    });
    return {
      onOpen: (p) => {
        setSlashIndex(0);
        setSlash(toState(p));
      },
      onUpdate: (p) => {
        setSlashIndex(0);
        setSlash(toState(p));
      },
      onClose: () => setSlash(null),
      onKey: ({ event }: SuggestionKeyDownProps) => {
        const { state, index } = slashLive.current;
        if (!state) return false;
        const n = state.items.length;
        if (event.key === 'Escape') {
          setSlash(null);
          return true;
        }
        if (!n) return false;
        if (event.key === 'ArrowDown') {
          setSlashIndex((index + 1) % n);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSlashIndex((index - 1 + n) % n);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          state.command(state.items[index]);
          return true;
        }
        return false;
      },
    };
  }, []);

  const items = useMemo(
    () =>
      slashItems(
        (editor: Editor, range: Range) => {
          editor.chain().focus().deleteRange(range).run();
          pickFiles(editor, 'application/pdf,.pdf');
        },
        (editor: Editor, range: Range) => {
          editor.chain().focus().deleteRange(range).run();
          pickFiles(editor, 'image/*');
        },
        (editor: Editor, range: Range) => {
          editor.chain().focus().deleteRange(range).run();
          setPicking(true);
        },
      ),
    [],
  );

  const lastDoc = useRef<Editor['state']['doc'] | null>(null);

  const editor = useEditor({
    editable: !readOnly,
    onCreate: ({ editor: e }) => {
      lastDoc.current = e.state.doc;
      void insertFiles(e, sharedFiles.files.splice(0));
    },
    content: note.content,
    extensions: [
      ...noteExtensions,
      Placeholder.configure({
        includeChildren: false,
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return 'Heading';
          if (node.type.name === 'paragraph') return 'Write, or type / for commands';
          return '';
        },
      }),
      SlashCommands.configure({ items, handlers }),
    ],
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Note content' },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a');
        const id = noteIdOf(a?.getAttribute('href') ?? undefined);
        if (id) {
          void noteLinks.open(id);
          return true;
        }
        if (a && (event.ctrlKey || event.metaKey)) {
          window.open(a.href, '_blank', 'noopener');
          return true;
        }
        return false;
      },
      // Typing with a PDF or image selected continues after it instead of replacing it.
      handleTextInput: (view, _from, _to, text) => {
        const sel = view.state.selection;
        if (!(sel instanceof NodeSelection) || !['pdfAttachment', 'noteImage'].includes(sel.node.type.name)) return false;
        const tr = view.state.tr;
        tr.setSelection(Selection.near(tr.doc.resolve(sel.to), 1));
        view.dispatch(tr.insertText(text));
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.some(canInsert)) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (editorInstance.current) void insertFiles(editorInstance.current, files, at);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.some(canInsert)) return false;
        // Word and Excel put a picture of the selection on the clipboard next to its
        // text. Paste the text in that case, and the file only when it stands alone.
        if (event.clipboardData?.getData('text/plain').trim()) return false;
        if (editorInstance.current) void insertFiles(editorInstance.current, files);
        return true;
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      if (transaction.getMeta(PREVIEW)) return;
      // Opening or re-rendering a note must never count as an edit.
      if (lastDoc.current?.eq(e.state.doc)) return;
      lastDoc.current = e.state.doc;
      pending.current = e.getJSON();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush.current(), SAVE_DELAY);
    },
  });

  const editorInstance = useRef<Editor | null>(null);
  editorInstance.current = editor;
  if (editorRef) editorRef.current = editor;

  useEffect(() => {
    if (!editor || readOnly) return;
    current = editor;
    const changed = () => editorHooks.onChange?.(editor);
    editor.on('transaction', changed);
    changed();
    return () => {
      editor.off('transaction', changed);
      if (current === editor) current = null;
    };
  }, [editor, readOnly]);

  // Save pending edits when the note closes, and let other actions request a save.
  useEffect(() => {
    const save = () => flush.current();
    registerFlusher(save);
    const onPageHide = () => {
      if (pending.current) journalEdit(noteId, { content: pending.current });
      save();
    };
    window.addEventListener('pagehide', onPageHide);
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      save();
      registerFlusher(null);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  // Adopt changes from elsewhere: the Tasks view, a backup restore, another tab.
  // Each write carries a unique stamp, so a re-read of older data is never mistaken
  // for an outside change while this editor's own save is still in flight.
  const seenStamp = useRef(note.writer);
  useEffect(() => {
    if (note.writer === seenStamp.current) return;
    seenStamp.current = note.writer;
    if (note.writer?.startsWith(writer) || pending.current) return;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(note.content)) return;
    editor.commands.setContent(note.content, { emitUpdate: false });
    lastDoc.current = editor.state.doc;
  }, [note.content, note.writer, editor, writer]);

  useEffect(() => {
    if (editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [readOnly, editor]);

  // Jump to a to-do opened from the Tasks view.
  const focusTaskId = useStore((s) => s.focusTaskId);
  const showToolbar = useStore((s) => s.showToolbar);
  useEffect(() => {
    if (!focusTaskId) return;
    const el = editor.view.dom.querySelector(`[data-task-id="${CSS.escape(focusTaskId)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('task-flash');
      setTimeout(() => el.classList.remove('task-flash'), 1600);
    }
    store.getState().clearFocusRequests();
  }, [focusTaskId, editor]);

  return (
    <>
      {!readOnly && showToolbar && <Toolbar editor={editor} items={items} />}
      <EditorContent editor={editor} />
      {!readOnly && <FormatMenu editor={editor} />}
      {!readOnly && <TableControls editor={editor} />}
      {picking && (
        <TablePicker
          onClose={() => setPicking(false)}
          onDone={(rows, cols) => {
            setPicking(false);
            editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
          }}
        />
      )}
      {slash && <SlashMenu state={slash} index={slashIndex} onHover={setSlashIndex} />}
      {due && <DuePopover state={due} onClose={() => setDue(null)} />}
    </>
  );
}

