import type { Editor, JSONContent, Range } from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import {
  Bold, Check, Code, ExternalLink, Heading2, Highlighter, Italic, Link2, Strikethrough, Underline, X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { journalEdit, registerFlusher, saveContent } from '../lib/actions';
import { importImage, looksLikeImage } from '../lib/images';
import { importPdf, looksLikePdf } from '../lib/pdf';
import { store, useStore } from '../lib/store';
import type { Note } from '../lib/types';
import { ImageBlock } from './ImageBlock';
import { PdfAttachment } from './PdfAttachment';
import { SlashCommands, slashItems, type SlashHandlers, type SlashItem } from './slash';
import { TaskItemDue } from './TaskItemDue';

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

  const buttons = [
    { label: 'Bold', icon: Bold, active: 'bold', run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: 'italic', run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Underline', icon: Underline, active: 'underline', run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Strikethrough', icon: Strikethrough, active: 'strike', run: () => editor.chain().focus().toggleStrike().run() },
    { label: 'Inline code', icon: Code, active: 'code', run: () => editor.chain().focus().toggleCode().run() },
    { label: 'Highlight', icon: Highlighter, active: 'highlight', run: () => editor.chain().focus().toggleHighlight().run() },
  ];

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
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
      TaskList,
      TaskItemDue.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
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
      <EditorContent editor={editor} />
      {!readOnly && <FormatMenu editor={editor} />}
      {slash && <SlashMenu state={slash} index={slashIndex} onHover={setSlashIndex} />}
    </>
  );
}

