import type { JSONContent } from '@tiptap/core';
import { baseNote } from './actions';
import { db, uid } from './db';
import { addDays, dateKey } from './dates';

const t = (text: string, marks?: string[]): JSONContent => ({
  type: 'text',
  text,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
});
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const h = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [t(text)] });
const task = (text: string, checked = false, due: string | null = null): JSONContent => ({
  type: 'taskItem',
  attrs: { id: uid(), checked, due },
  content: [p(t(text))],
});
const bullet = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content: [p(...content)] });

const SEED_TIME = Date.UTC(2026, 0, 1);

/** Writes a short guide on first run. It is an ordinary note and can be deleted. */
export async function seedIfEmpty() {
  let seeded = false;
  try {
    seeded = localStorage.getItem('cn.seeded') === '1';
  } catch {
    /* no localStorage: fall through to the note count check */
  }
  if (seeded || (await db.notes.count()) > 0) return null;
  // Fixed ids and an old edit time, so every device seeds the same rows and any real edit or delete wins a sync.
  const notebookId = 'getting-started';
  const content: JSONContent = {
    type: 'doc',
    content: [
      p(t('Everything here is stored on this device and works offline. Delete this note whenever you like.')),
      h('Write'),
      p(t('Type '), t('/', ['code']), t(' on an empty line for headings, lists, to-dos, tables, code, images and PDFs. Select text to format it.')),
      h('Organise'),
      {
        type: 'bulletList',
        content: [
          bullet(t('Notebooks', ['bold']), t(' hold notes. Drag a note onto one in the sidebar to move it.')),
          bullet(t('Tags', ['bold']), t(' nest with a slash: '), t('work/clients/acme', ['code']), t(' appears under work and clients.')),
          bullet(t('Today', ['bold']), t(' opens the daily note for the date. The calendar takes you to any other day.')),
          bullet(t('Sub-notes', ['bold']), t(' sit under a parent note. Use the new sub-note button at the top of a note.')),
          bullet(t('Background color', ['bold']), t(' is in the menu at the top of a note.')),
          bullet(t('Select', ['bold']), t(' in the list menu picks several notes at once, to share, export or move them together.')),
          bullet(t('The sidebar', ['bold']), t(' shrinks to icons with the button next to the theme switch. Click the Tags heading to fold all tags away.')),
        ],
      },
      h('Read and focus'),
      {
        type: 'bulletList',
        content: [
          bullet(t('Focus mode', ['bold']), t(' hides the other columns. Press '), t('Ctrl \\', ['code']), t(' or use the button at the top of a note.')),
          bullet(t('PDFs', ['bold']), t(' have their own focus button, which gives the PDF the whole window.')),
          bullet(t('Images', ['bold']), t(' open full size with a double-click.')),
        ],
      },
      h('Get things done'),
      p(t('To-dos in any note also appear in Tasks, grouped by due date. Hover a to-do to give it a date.')),
      {
        type: 'taskList',
        content: [
          task('Tick this one off', false, dateKey()),
          task('Attach a PDF: type /pdf or drop a file into a note', false, addDays(dateKey(), 1)),
          task('Install the app from Settings'),
        ],
      },
      h('Keep it safe'),
      p(t('Notes live in this browser, so export a backup from Settings now and then.')),
    ],
  };
  const note = baseNote({ id: 'welcome', title: 'Welcome to Clean Notes', content, notebookId, tags: ['guide/basics'], pinned: true, updatedAt: SEED_TIME });
  await db.transaction('rw', db.notes, db.notebooks, async () => {
    await db.notebooks.put({ id: notebookId, name: 'Getting started', createdAt: SEED_TIME, updatedAt: SEED_TIME });
    await db.notes.put(note);
  });
  try {
    localStorage.setItem('cn.seeded', '1');
  } catch {
    /* see above */
  }
  return note.id;
}
