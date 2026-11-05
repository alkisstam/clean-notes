import '@fontsource-variable/commissioner/wght.css';
import '@fontsource-variable/literata/wght.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/pdf.css';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushEditor, patchNote } from './lib/actions';
import { db, writeListeners } from './lib/db';
import { NoteEditor } from './editor/NoteEditor';
import type { Note, NoteImage, PdfFile } from './lib/types';

interface Payload {
  note: Note;
  images: (Omit<NoteImage, 'blob'> & { type: string })[];
  files: PdfFile[];
  dark: boolean;
}

/** Added by the Android app, and only for this page's origin. */
declare const CleanNotes: { postMessage(message: string): void };

const root = createRoot(document.getElementById('root')!);
let noteId = '';
// updatedAt of the newest copy the app already has, so its own echo is never sent back.
let known = 0;

async function send() {
  const note = await db.notes.get(noteId);
  if (!note || note.updatedAt <= known) return;
  known = note.updatedAt;
  CleanNotes.postMessage(JSON.stringify({ type: 'save', note }));
}

let sendTimer: number | undefined;
writeListeners.add(() => {
  clearTimeout(sendTimer);
  sendTimer = window.setTimeout(() => void send(), 300);
});

let titleTimer: number | undefined;
let pendingTitle: string | null = null;
const flushTitle = () => {
  clearTimeout(titleTimer);
  if (pendingTitle === null) return;
  void patchNote(noteId, { title: pendingTitle });
  pendingTitle = null;
};

function Page({ id }: { id: string }) {
  const note = useLiveQuery(() => db.notes.get(id), [id]);
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (note && pendingTitle === null) setTitle(note.title);
  }, [note?.title]);
  if (!note) return null;
  return (
    <div className="doc-scroll">
      <article className="doc">
        <textarea
          className="doc-title"
          rows={1}
          style={{ fieldSizing: 'content' } as React.CSSProperties}
          value={title ?? note.title}
          placeholder="Untitled"
          aria-label="Note title"
          readOnly={note.kind === 'daily'}
          onChange={(e) => {
            const t = e.target.value.replace(/\n/g, ' ');
            setTitle(t);
            pendingTitle = t;
            clearTimeout(titleTimer);
            titleTimer = window.setTimeout(flushTitle, 300);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (document.querySelector('.prose') as HTMLElement | null)?.focus();
            }
          }}
        />
        <NoteEditor note={note} />
      </article>
    </div>
  );
}

const w = window as unknown as {
  cnLoad: (p: Payload) => Promise<void>;
  cnFlush: () => Promise<void>;
};

// Called by the app on open and whenever its copy changes. The page's own database is only a cache for this note.
w.cnLoad = async ({ note, images, files, dark }) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const opening = note.id !== noteId;
  if (opening) {
    noteId = note.id;
    known = note.updatedAt;
  }
  const cur = opening ? undefined : await db.notes.get(note.id);
  const have = new Set(opening ? [] : await db.images.toCollection().primaryKeys());
  const loaded = await Promise.all(
    images
      .filter((i) => !have.has(i.id))
      .map(async ({ type, ...meta }) => {
        const res = await fetch(`/blobs/${meta.id}`);
        return res.ok ? { ...meta, blob: new Blob([await res.blob()], { type }) } : null;
      }),
  );
  await db.transaction('rw', [db.notes, db.images, db.files], async () => {
    if (opening) await Promise.all([db.notes.clear(), db.images.clear(), db.files.clear()]);
    await db.images.bulkPut(loaded.filter((i) => !!i));
    await db.files.bulkPut(files);
    // A newer local edit not yet handed to the app wins over the app's copy.
    if (!cur || note.updatedAt > cur.updatedAt) {
      known = Math.max(known, note.updatedAt);
      await db.notes.put(note);
    }
  });
  if (opening) root.render(<Page key={note.id} id={note.id} />);
};

// Saves pending keystrokes and hands the note to the app before it closes this page.
w.cnFlush = async () => {
  flushTitle();
  flushEditor();
  // A read-write transaction queues behind the saves just started, so it sees them.
  await db.transaction('rw', db.notes, () => db.notes.get(noteId));
  await send();
  CleanNotes.postMessage(JSON.stringify({ type: 'flushed' }));
};
