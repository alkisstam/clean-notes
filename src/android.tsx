import '@fontsource-variable/commissioner/wght.css';
import '@fontsource-variable/literata/wght.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/pdf.css';
import { createRoot } from 'react-dom/client';
import { db } from './lib/db';
import { NoteEditor } from './editor/NoteEditor';
import type { Note, NoteImage, PdfFile } from './lib/types';

interface Payload {
  note: Note;
  images: (Omit<NoteImage, 'blob'> & { type: string })[];
  files: PdfFile[];
  dark: boolean;
}

const root = createRoot(document.getElementById('root')!);

// Called by the Android app. The WebView's own database is only a cache for the one open note.
(window as unknown as { cnLoad: (p: Payload) => Promise<void> }).cnLoad = async ({ note, images, files, dark }) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const loaded = await Promise.all(
    images.map(async ({ type, ...meta }) => {
      const res = await fetch(`/blobs/${meta.id}`);
      return res.ok ? { ...meta, blob: new Blob([await res.blob()], { type }) } : null;
    }),
  );
  await db.transaction('rw', [db.notes, db.images, db.files], async () => {
    await Promise.all([db.notes.clear(), db.images.clear(), db.files.clear()]);
    await db.notes.put(note);
    await db.images.bulkPut(loaded.filter((i) => !!i));
    await db.files.bulkPut(files);
  });
  root.render(
    <div className="doc-scroll">
      <article className="doc" key={note.id}>
        <NoteEditor note={note} readOnly />
      </article>
    </div>,
  );
};
