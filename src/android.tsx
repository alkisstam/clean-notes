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
import { db, uid, writeListeners } from './lib/db';
import { imageIdsIn, pdfIdsIn } from './lib/doc';
import { blobSaver } from './lib/pdf';
import { currentEditor, editorHooks, formatMenu, insertIntoEditor, NoteEditor } from './editor/NoteEditor';
import { Boundary } from './components/EditorPane';
import { store, useStore, type PdfTarget } from './lib/store';
import type { Note, NoteImage, PdfFile } from './lib/types';

interface Payload {
  note: Note;
  images: (Omit<NoteImage, 'blob'> & { type: string })[];
  files: PdfFile[];
  dark: boolean;
  /** The phone's own fonts instead of the web fonts, from the app's Settings. */
  deviceFonts?: boolean;
  /** A PDF to show as the note opens, from the app's PDFs list or a search hit. */
  pdf?: PdfTarget | null;
}

/** Added by the Android app, and only for this page's origin. */
declare const CleanNotes: { postMessage(message: string | ArrayBuffer): void };

const PdfViewer = lazy(() => import('./components/PdfViewer').then((m) => ({ default: m.PdfViewer })));

const root = createRoot(document.getElementById('root')!);
let noteId = '';
// updatedAt of the newest copy the app already has, so its own echo is never sent back.
let known = 0;
// Images and PDFs the app already holds the bytes of.
const sent = new Set<string>();

// Bytes go over in pieces, each acknowledged, so neither side ever holds a whole large PDF as one string.
const CHUNK = 4 * 1024 * 1024;
const acks: (() => void)[] = [];
let sending = Promise.resolve();
/** Hands a file's bytes to the app under `id`, one file at a time, since the app collects one stream at once. */
const sendBytes = (id: string, blob: Blob) =>
  (sending = sending.catch(() => {}).then(async () => {
    CleanNotes.postMessage(JSON.stringify({ type: 'bytes', id }));
    for (let at = 0; at < blob.size; at += CHUNK) {
      const acked = new Promise<void>((resolve) => acks.push(resolve));
      CleanNotes.postMessage(await blob.slice(at, at + CHUNK).arrayBuffer());
      await acked;
    }
  }));

blobSaver.save = (blob, name) => {
  const id = `open-${uid()}`;
  void sendBytes(id, blob).then(() => CleanNotes.postMessage(JSON.stringify({ type: 'open', id, name, mime: blob.type })));
};

async function send() {
  const note = await db.notes.get(noteId);
  if (!note || note.updatedAt <= known) return;
  known = note.updatedAt;
  // Bytes go first, so the app never holds a note pointing at a file it lacks.
  for (const id of imageIdsIn(note.content).filter((id) => !sent.has(id))) {
    const image = await db.images.get(id);
    if (!image) continue;
    const { blob, ...meta } = image;
    await sendBytes(id, blob);
    CleanNotes.postMessage(JSON.stringify({ type: 'attachment', table: 'images', meta: { ...meta, type: blob.type } }));
    sent.add(id);
  }
  for (const id of pdfIdsIn(note.content).filter((id) => !sent.has(id))) {
    const [meta, blob] = await Promise.all([db.files.get(id), db.blobs.get(id)]);
    if (!meta || !blob) continue;
    await sendBytes(id, blob.blob);
    CleanNotes.postMessage(JSON.stringify({ type: 'attachment', table: 'files', meta }));
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
    // The tap that opened it left the editor focused, which keeps the keyboard up over the viewer.
    (document.activeElement as HTMLElement | null)?.blur();
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
    // The body never scrolls (the web app scrolls inside its panes), so this needs the full height to scroll itself.
    <div className="doc-scroll" style={{ height: '100%' }}>
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
  cnAck: () => void;
  cnUndo: () => void;
  cnRedo: () => void;
  cnInsertPicked: (picked: { url: string; name: string; type: string }[]) => Promise<void>;
};

formatMenu.placement = 'bottom';
let history = '';
editorHooks.onChange = (e) => {
  const next = JSON.stringify({ type: 'history', undo: e.can().undo(), redo: e.can().redo() });
  if (next !== history) CleanNotes.postMessage((history = next));
};
w.cnUndo = () => currentEditor()?.commands.undo();
w.cnRedo = () => currentEditor()?.commands.redo();

// Tapping an image selects it for its toolbar; that is no reason to raise the keyboard.
addEventListener(
  'pointerdown',
  (ev) => {
    const prose = currentEditor()?.view.dom;
    if (!prose) return;
    if (!(ev.target as Element).closest('.image-node')) return prose.removeAttribute('inputmode');
    prose.inputMode = 'none';
    // inputmode only stops the keyboard from rising; one already up needs the app to lower it.
    CleanNotes.postMessage(JSON.stringify({ type: 'hideKeyboard' }));
  },
  true,
);

// The keyboard shrinks the page; keep the caret above it.
addEventListener('resize', () => {
  const e = currentEditor();
  if (!e?.isFocused) return;
  const gap = e.view.coordsAtPos(e.state.selection.head).bottom - (innerHeight - 96);
  if (gap > 0) document.querySelector('.doc-scroll')?.scrollBy({ top: gap });
});
// The app's + menu picks files natively, since a page may only open its own file chooser from a tap inside it.
w.cnInsertPicked = async (picked) => {
  const files = await Promise.all(picked.map(async ({ url, name, type }) => new File([await (await fetch(url)).blob()], name, { type })));
  await insertIntoEditor(files);
};

w.cnClosePdf = () => store.getState().setPdf(null);
w.cnAck = () => acks.shift()?.();

// Called by the app on open and whenever its copy changes. The page's own database is only a cache for this note.
w.cnLoad = async ({ note, images, files, dark, deviceFonts, pdf }) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const fonts: [string, string][] = [['--font-ui', 'sans-serif'], ['--font-text', 'serif'], ['--font-mono', 'monospace']];
  for (const [name, value] of fonts) {
    if (deviceFonts) document.documentElement.style.setProperty(name, value);
    else document.documentElement.style.removeProperty(name);
  }
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
  if (opening) store.getState().setPdf(pdf ?? null);
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
