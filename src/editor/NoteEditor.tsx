import type { Editor, JSONContent, Range } from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { TableMap } from '@tiptap/pm/tables';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import {
  Bold, CalendarPlus, Check, Code, ExternalLink, FileText, Heading2, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, ListTodo,
  Minus, Plus, Quote, SquareCode, Strikethrough, Table, Table2, Underline, X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { journalEdit, registerFlusher, saveContent } from '../lib/actions';
import { importImage, looksLikeImage } from '../lib/images';
import { importPdf, looksLikePdf } from '../lib/pdf';
import { Menu } from '../components/Overlay';
import { store, useStore } from '../lib/store';
import type { Note } from '../lib/types';
import { ImageBlock } from './ImageBlock';
import { PdfAttachment } from './PdfAttachment';
import { SlashCommands, slashItems, type SlashHandlers, type SlashItem } from './slash';
import { TaskItemDue } from './TaskItemDue';

const SAVE_DELAY = 350;
const CELL_MIN_WIDTH = 80;

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
export const currentEditor = () => current;
/** Hosts listen here for every change to the open editor, as the Android app does for its undo and redo buttons. */
export const editorHooks = { onChange: null as ((editor: Editor) => void) | null };

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

const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];

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
          items={items.filter((i) => i.inTable).map((i) => ({ label: i.title, danger: i.id.startsWith('del'), run: () => slash(i.id) }))}
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

type Handle = { cellPos: number; x: number; y: number; width: number };

// Controls around the table holding the cursor: "+" to add a row or column at its end,
// and a drag handle on the first row for a column border tapped, since the extension's resize is mouse-only.
function TableAdders({ editor }: { editor: Editor }) {
  const [box, setBox] = useState<{ pos: number; rect: DOMRect; cell: DOMRect | null; handles: Handle[] } | null>(null);
  const drag = useRef<{ cellPos: number; startX: number; startWidth: number } | null>(null);
  const active = useRef<number | null>(null);
  useEffect(() => {
    const update = () => {
      const { $from } = editor.state.selection;
      let pos = -1;
      let cellPos = -1;
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === 'table') pos = $from.before(d);
        if (cellPos < 0 && (name === 'tableCell' || name === 'tableHeader')) cellPos = $from.before(d);
      }
      const dom = pos >= 0 && (editor.isFocused || drag.current) ? (editor.view.nodeDOM(pos) as HTMLElement | null) : null;
      if (!dom) return setBox(null);
      const rect = dom.getBoundingClientRect();
      const handles: Handle[] = [];
      for (const cell of dom.querySelectorAll<HTMLElement>('tr:first-child > th, tr:first-child > td')) {
        const r = cell.getBoundingClientRect();
        // Skip borders scrolled out of the table's box.
        if (r.right < rect.left + 4 || r.right > rect.right + 1) continue;
        if (editor.view.posAtDOM(cell, 0) - 1 !== active.current) continue;
        handles.push({ cellPos: editor.view.posAtDOM(cell, 0) - 1, x: r.right, y: r.top + r.height / 2, width: cell.offsetWidth });
      }
      const cell = cellPos >= 0 ? (editor.view.nodeDOM(cellPos) as HTMLElement | null)?.getBoundingClientRect() ?? null : null;
      setBox({ pos, rect, cell, handles });
    };
    // A tap within reach of a vertical cell border shows that column's handle; any other tap hides it.
    const onTap = (e: PointerEvent) => {
      active.current = null;
      const cell = (e.target as HTMLElement).closest('td, th');
      const table = cell?.closest('table');
      if (cell && table) {
        const r = cell.getBoundingClientRect();
        const border = e.clientX - r.left < 14 ? r.left : r.right - e.clientX < 14 ? r.right : null;
        if (border !== null) {
          for (const first of table.querySelectorAll<HTMLElement>('tr:first-child > th, tr:first-child > td')) {
            if (Math.abs(first.getBoundingClientRect().right - border) < 3) active.current = editor.view.posAtDOM(first, 0) - 1;
          }
        }
      }
      update();
    };
    editor.view.dom.addEventListener('pointerdown', onTap);
    editor.on('transaction', update);
    editor.on('blur', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.view.dom.removeEventListener('pointerdown', onTap);
      editor.off('transaction', update);
      editor.off('blur', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor]);
  if (!box) return null;

  const add = (where: 'row' | 'col') => {
    const table = editor.state.doc.nodeAt(box.pos);
    if (!table) return;
    // Inside the last cell of the last row: just before its closing tokens.
    const inLast = box.pos + table.nodeSize - 3;
    const chain = editor.chain().focus().command(({ tr }) => {
      tr.setSelection(Selection.near(tr.doc.resolve(inLast), -1));
      return true;
    });
    (where === 'row' ? chain.addRowAfter() : chain.addColumnAfter()).run();
  };
  const { rect, cell } = box;
  return createPortal(
    <>
      {cell && (
        <>
          <button
            type="button" className="table-add" aria-label="Delete row" title="Delete row"
            style={{ left: Math.max(0, rect.left - 20), top: cell.top, height: cell.height }}
            onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}
          ><X size={12} /></button>
          <button
            type="button" className="table-add" aria-label="Delete column" title="Delete column"
            style={{ left: cell.left, top: rect.top - 20, width: cell.width }}
            onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}
          ><X size={12} /></button>
        </>
      )}
      <button
        type="button" className="table-add" aria-label="Add row" title="Add row"
        style={{ left: rect.left, top: rect.bottom + 2, width: rect.width }}
        onMouseDown={(e) => e.preventDefault()} onClick={() => add('row')}
      ><Plus size={13} /></button>
      <button
        type="button" className="table-add" aria-label="Add column" title="Add column"
        style={{ left: Math.min(rect.right + 10, window.innerWidth - 20), top: rect.top, height: rect.height }}
        onMouseDown={(e) => e.preventDefault()} onClick={() => add('col')}
      ><Plus size={13} /></button>
      {box.handles.map((h, i) => (
        <span
          key={i} className="table-col-handle" aria-hidden="true"
          style={{ left: h.x, top: h.y }}
          onMouseDown={(e) => e.preventDefault()}
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
        />
      ))}
    </>,
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
        if (from === to || !e.isEditable || !e.isFocused) return false;
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
            {editor.isActive('link') && (
              <button
                type="button"
                aria-label="Open link"
                title="Open link"
                onClick={() => window.open(editor.getAttributes('link').href, '_blank', 'noopener')}
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
      ),
    [],
  );

  const lastDoc = useRef<Editor['state']['doc'] | null>(null);

  const editor = useEditor({
    editable: !readOnly,
    onCreate: ({ editor: e }) => {
      lastDoc.current = e.state.doc;
    },
    content: note.content,
    extensions: [
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
      PdfAttachment,
      ImageBlock,
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
    onUpdate: ({ editor: e }) => {
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
      {!readOnly && <TableAdders editor={editor} />}
      {slash && <SlashMenu state={slash} index={slashIndex} onHover={setSlashIndex} />}
    </>
  );
}

