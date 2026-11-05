import '@fontsource-variable/commissioner/wght.css';
import '@fontsource-variable/literata/wght.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/pdf.css';
import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushEditor, patchNote } from './lib/actions';
import { db, writeListeners } from './lib/db';
import { imageIdsIn, pdfIdsIn } from './lib/doc';
import { NoteEditor } from './editor/NoteEditor';
import { Boundary } from './components/EditorPane';
import { store, useStore } from './lib/store';
import type { Note, NoteImage, PdfFile } from './lib/types';

interface Payload {
  note: Note;
  images: (Omit<NoteImage, 'blob'> & { type: string })[];
  files: PdfFile[];
  dark: boolean;
}

/** Added by the Android app, and only for this page's origin. */
declare const CleanNotes: { postMessage(message: string): void };

const PdfViewer = lazy(() => import('./components/PdfViewer').then((m) => ({ default: m.PdfViewer })));

const root = createRoot(document.getElementById('root')!);
let noteId = '';
// updatedAt of the newest copy the app already has, so its own echo is never sent back.
let known = 0;
// Images and PDFs the app already holds the bytes of.
const sent = new Set<string>();

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function send() {
  const note = await db.notes.get(noteId);
  if (!note || note.updatedAt <= known) return;
  known = note.updatedAt;
  // Bytes go first, so the app never holds a note pointing at a file it lacks.
  for (const id of imageIdsIn(note.content).filter((id) => !sent.has(id))) {
    const image = await db.images.get(id);
    if (!image) continue;
    const { blob, ...meta } = image;
    CleanNotes.postMessage(JSON.stringify({ type: 'attachment', table: 'images', meta: { ...meta, type: blob.type }, data: await toBase64(blob) }));
    sent.add(id);
  }
  for (const id of pdfIdsIn(note.content).filter((id) => !sent.has(id))) {
    const [meta, blob] = await Promise.all([db.files.get(id), db.blobs.get(id)]);
    if (!meta || !blob) continue;
    CleanNotes.postMessage(JSON.stringify({ type: 'attachment', table: 'files', meta, data: await toBase64(blob.blob) }));
    sent.add(id);
  }
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

/** The web viewer, full screen. Its bytes come from the app's storage the first time it opens. */
function PdfLayer() {
  const pdf = useStore((s) => s.pdf);
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    CleanNotes.postMessage(JSON.stringify({ type: 'pdf', open: !!pdf }));
    if (!pdf) return;
    let gone = false;
    void (async () => {
      if (!(await db.blobs.get(pdf.fileId))) {
        const res = await fetch(`/blobs/${pdf.fileId}`);
        if (res.ok) await db.blobs.put({ id: pdf.fileId, blob: new Blob([await res.blob()], { type: 'application/pdf' }) });
      }
      if (!gone) setReady(pdf.fileId);
    })();
    return () => {
      gone = true;
    };
  }, [pdf?.fileId]);
  if (!pdf) return null;
  return (
    <div className="pdf-pane" style={{ position: 'fixed', inset: 0, zIndex: 20 }}>
      <Boundary message="This PDF could not be displayed." resetKey={pdf.fileId}>
        <Suspense fallback={<div className="pdf-loading">Opening…</div>}>
          {ready === pdf.fileId ? <PdfViewer key={pdf.fileId} target={pdf} /> : <div className="pdf-loading">Opening…</div>}
        </Suspense>
      </Boundary>
    </div>
  );
}

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
      <PdfLayer />
    </div>
  );
}

const w = window as unknown as {
  cnLoad: (p: Payload) => Promise<void>;
  cnFlush: () => Promise<void>;
  cnClosePdf: () => void;
};

w.cnClosePdf = () => store.getState().setPdf(null);

// Called by the app on open and whenever its copy changes. The page's own database is only a cache for this note.
w.cnLoad = async ({ note, images, files, dark }) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const opening = note.id !== noteId;
  if (opening) {
    noteId = note.id;
    known = note.updatedAt;
    sent.clear();
  }
  [...images, ...files].forEach((f) => sent.add(f.id));
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
  await db.transaction('rw', [db.notes, db.images, db.files, db.blobs], async () => {
    if (opening) await Promise.all([db.notes.clear(), db.images.clear(), db.files.clear(), db.blobs.clear()]);
    await db.images.bulkPut(loaded.filter((i) => !!i));
    await db.files.bulkPut(files);
    // A newer local edit not yet handed to the app wins over the app's copy.
    if (!cur || note.updatedAt > cur.updatedAt) {
      known = Math.max(known, note.updatedAt);
      await db.notes.put(note);
    }
  });
  if (opening) store.getState().setPdf(null);
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
