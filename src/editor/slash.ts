import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { longDate, dateKey } from '../lib/dates';

export interface SlashItem {
  id: string;
  title: string;
  hint: string;
  group: string;
  aliases?: string;
  inTable?: boolean;
  run: (editor: Editor, range: Range) => void;
}

/** Items that need the outside world, such as a file picker, are passed in. */
export function slashItems(onPdf: (editor: Editor, range: Range) => void, onImage: (editor: Editor, range: Range) => void): SlashItem[] {
  const chain = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);
  return [
    { id: 'text', group: 'Basic', title: 'Text', hint: 'Plain paragraph', aliases: 'paragraph p', run: (e, r) => chain(e, r).setParagraph().run() },
    { id: 'h1', group: 'Basic', title: 'Heading 1', hint: 'Section title', aliases: 'h1 title', run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
    { id: 'h2', group: 'Basic', title: 'Heading 2', hint: 'Subsection', aliases: 'h2', run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
    { id: 'h3', group: 'Basic', title: 'Heading 3', hint: 'Small heading', aliases: 'h3', run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
    { id: 'todo', group: 'Lists', title: 'To-do', hint: 'Appears in Tasks', aliases: 'todo task checkbox check', run: (e, r) => chain(e, r).toggleTaskList().run() },
    { id: 'bullet', group: 'Lists', title: 'Bullet list', hint: 'Simple list', aliases: 'ul unordered', run: (e, r) => chain(e, r).toggleBulletList().run() },
    { id: 'number', group: 'Lists', title: 'Numbered list', hint: 'Ordered list', aliases: 'ol ordered', run: (e, r) => chain(e, r).toggleOrderedList().run() },
    { id: 'quote', group: 'Blocks', title: 'Quote', hint: 'Set a passage apart', aliases: 'blockquote', run: (e, r) => chain(e, r).setBlockquote().run() },
    { id: 'code', group: 'Blocks', title: 'Code block', hint: 'Monospaced text', aliases: 'pre snippet', run: (e, r) => chain(e, r).setCodeBlock().run() },
    { id: 'divider', group: 'Blocks', title: 'Divider', hint: 'Horizontal line', aliases: 'hr rule line', run: (e, r) => chain(e, r).setHorizontalRule().run() },
    { id: 'table', group: 'Blocks', title: 'Table', hint: '3 × 3, with a header', aliases: 'grid', run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'image', group: 'Insert', title: 'Image', hint: 'Add a picture', aliases: 'picture photo img screenshot', run: onImage },
    { id: 'pdf', group: 'Insert', title: 'PDF', hint: 'Attach and read a file', aliases: 'file attachment document', run: onPdf },
    { id: 'date', group: 'Insert', title: "Today's date", hint: longDate(dateKey()), aliases: 'now day', run: (e, r) => chain(e, r).insertContent(longDate(dateKey())).run() },
    { id: 'row', group: 'Table', inTable: true, title: 'Add row', hint: 'Below this one', run: (e, r) => chain(e, r).addRowAfter().run() },
    { id: 'col', group: 'Table', inTable: true, title: 'Add column', hint: 'Right of this one', run: (e, r) => chain(e, r).addColumnAfter().run() },
    { id: 'delrow', group: 'Table', inTable: true, title: 'Delete row', hint: 'Remove this row', run: (e, r) => chain(e, r).deleteRow().run() },
    { id: 'delcol', group: 'Table', inTable: true, title: 'Delete column', hint: 'Remove this column', run: (e, r) => chain(e, r).deleteColumn().run() },
    { id: 'deltable', group: 'Table', inTable: true, title: 'Delete table', hint: 'Remove the whole table', run: (e, r) => chain(e, r).deleteTable().run() },
  ];
}

export function filterSlash(items: SlashItem[], query: string, inTable: boolean): SlashItem[] {
  const q = query.toLowerCase().trim();
  const available = items.filter((i) => inTable ? i.inTable || ['text', 'todo', 'bullet', 'number', 'date'].includes(i.id) : !i.inTable);
  // Table actions come first when the cursor is in a table.
  available.sort((a, b) => Number(Boolean(b.inTable)) - Number(Boolean(a.inTable)));
  if (!q) return available;
  const score = (i: SlashItem) => {
    const title = i.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.includes(q)) return 1;
    if (i.aliases?.split(' ').some((a) => a.startsWith(q))) return 2;
    return 3;
  };
  return available.filter((i) => score(i) < 3).sort((a, b) => score(a) - score(b));
}

export interface SlashHandlers {
  onOpen: (p: SuggestionProps<SlashItem, SlashItem>) => void;
  onUpdate: (p: SuggestionProps<SlashItem, SlashItem>) => void;
  onClose: () => void;
  onKey: (p: SuggestionKeyDownProps) => boolean;
}

export const SlashCommands = Extension.create<{ items: SlashItem[]; handlers: SlashHandlers | null }>({
  name: 'slashCommands',
  addOptions: () => ({ items: [], handlers: null }),
  addProseMirrorPlugins() {
    const { items, handlers } = this.options;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slash'),
        char: '/',
        startOfLine: false,
        allow: ({ editor, state }) => !editor.isActive('codeBlock') && !state.selection.$from.parent.type.spec.code,
        items: ({ query, editor }) => filterSlash(items, query, editor.isActive('table')),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => ({
          onStart: (p) => handlers?.onOpen(p),
          onUpdate: (p) => handlers?.onUpdate(p),
          onExit: () => handlers?.onClose(),
          onKeyDown: (p) => handlers?.onKey(p) ?? false,
        }),
      }),
    ];
  },
});
