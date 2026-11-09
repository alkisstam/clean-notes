import { flushEditor } from './actions';
import { toBase64 } from './backup';
import { db } from './db';
import { saveBlob } from './pdf';
import { store } from './store';
import type { Note } from './types';

export type ExportFormat = 'pdf' | 'txt' | 'json' | 'html';
export type ExportMode = 'save' | 'share';

export const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'txt', label: 'Text' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
];

/** Set by the Android app, which saves and prints natively. */
export const exportHost: { save: ((blob: Blob, name: string, print: boolean) => void) | null } = { save: null };

const STYLE = `
body { max-width: 680px; margin: 40px auto; padding: 0 20px; color: #211e1a; background: #fff; font: 16px/1.6 Georgia, serif; overflow-wrap: anywhere; }
h1, h2, h3 { line-height: 1.25; }
img { display: block; max-width: 100%; height: auto; margin: 12px 0; }
pre { padding: 12px; background: #f3f1ec; overflow-x: auto; white-space: pre-wrap; }
code { font-family: ui-monospace, monospace; font-size: 0.9em; }
blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #ccc; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #ccc; padding: 5px 8px; text-align: inherit; font-weight: inherit; vertical-align: top; background: var(--table-bg); text-decoration-line: var(--table-deco, none); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
table[data-header] tr:first-child > *, table[data-first-col] tr > :first-child { background: color-mix(in srgb, var(--table-bg, transparent) 88%, #211e1a) !important; }
table[data-borders='rounded'] { border-collapse: separate; border-spacing: 0; border: 1px solid #ccc; border-radius: 10px; overflow: hidden; }
table[data-borders='rounded'] :is(td, th) { border-width: 0 1px 1px 0; }
table[data-borders='rounded'] tr > :last-child { border-right-width: 0; }
table[data-borders='rounded'] tr:last-child > * { border-bottom-width: 0; }
table[data-borders='lines'] :is(td, th) { border-width: 1px 0; }
table[data-borders='outer'] :is(td, th) { border-width: 0; }
table[data-borders='outer'] tr:first-child > * { border-top-width: 1px; }
table[data-borders='outer'] tr:last-child > * { border-bottom-width: 1px; }
table[data-borders='none'] :is(td, th) { border-width: 0; }
ul[data-type='taskList'] { list-style: none; padding: 0; }
ul[data-type='taskList'] li { display: flex; gap: 8px; }
ul[data-type='taskList'] p { margin: 0; }
[data-pdf-attachment] { margin: 12px 0; font-style: italic; }
`;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const exportName = (title: string, ext: string) =>
  `${title.replace(/[/\\:*?"<>|\x00-\x1f]/g, '').trim() || 'Untitled'}.${ext}`;

const batchName = (count: number) => `Clean Notes (${count} notes)`;

export const exportPages = (notes: { title: string; body: string }[]) => {
  const page = escapeHtml(notes.length === 1 ? notes[0].title || 'Untitled' : batchName(notes.length));
  const sections = notes.map((n, i) => `<h1${i ? ' style="break-before:page"' : ''}>${escapeHtml(n.title || 'Untitled')}</h1>${n.body}`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${page}</title><style>${STYLE}</style></head><body>${sections}</body></html>`;
};

export const exportPage = (title: string, body: string) => exportPages([{ title, body }]);

export const exportText = (notes: Pick<Note, 'title' | 'text'>[]) =>
  notes.map((n) => `${n.title || 'Untitled'}\n\n${n.text}\n`).join('\n---\n\n');

export const exportJson = (notes: Note[]) => {
  const clean = notes.map(({ writer: _, ...rest }) => rest);
  return JSON.stringify(clean.length === 1 ? clean[0] : clean, null, 2);
};

async function exportBody(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('[data-note-image]')) {
    const image = await db.images.get(el.getAttribute('data-image-id') ?? '');
    if (!image) {
      el.remove();
      continue;
    }
    const img = doc.createElement('img');
    img.src = `data:${image.blob.type};base64,${await toBase64(image.blob)}`;
    img.alt = el.getAttribute('data-alt') ?? '';
    el.replaceWith(img);
  }
  // Links to other notes mean nothing outside the app.
  for (const a of doc.querySelectorAll('a')) {
    if (!/^(https?:|mailto:)/i.test(a.getAttribute('href') ?? '')) a.replaceWith(...a.childNodes);
  }
  return doc.body.innerHTML;
}

function printInBrowser(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.append(frame);
}

const MIME: Record<Exclude<ExportFormat, 'pdf'>, string> = { txt: 'text/plain', json: 'application/json', html: 'text/html' };

/** Browsers can only print a PDF, so they have no bytes to share, and each one allows its own list of file types. */
export function shareFormats() {
  if (window.desktop) return EXPORT_FORMATS;
  return EXPORT_FORMATS.filter((f) => f.id !== 'pdf' && navigator.canShare?.({ files: [new File([''], `a.${f.id}`, { type: MIME[f.id] })] }));
}

async function shareBlob(blob: Blob, name: string) {
  if (window.desktop) return void (await window.desktop.shareFile(await blob.arrayBuffer(), name));
  try {
    await navigator.share({ files: [new File([blob], name, { type: blob.type })] });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
}

async function run(ids: string[], format: ExportFormat, mode: ExportMode) {
  flushEditor();
  const notes = (await db.notes.bulkGet(ids)).filter((n): n is Note => Boolean(n));
  if (!notes.length) return;
  const name = exportName(notes.length === 1 ? notes[0].title : batchName(notes.length), format);
  const deliver = async (text: string, type: string) => {
    const blob = new Blob([text], { type });
    if (mode === 'share') await shareBlob(blob, name);
    else if (exportHost.save) exportHost.save(blob, name, false);
    else saveBlob(blob, name);
  };
  if (format === 'txt') return deliver(exportText(notes), MIME.txt);
  if (format === 'json') return deliver(exportJson(notes), MIME.json);
  // Loaded here because the editor's node views need a browser, and tests import this file without one.
  const [{ generateHTML }, { noteExtensions }] = await Promise.all([import('@tiptap/core'), import('../editor/NoteEditor')]);
  const page = exportPages(await Promise.all(notes.map(async (n) => ({ title: n.title, body: await exportBody(generateHTML(n.content, noteExtensions)) }))));
  if (format === 'html') return deliver(page, MIME.html);
  if (mode === 'share') await window.desktop?.sharePdf(page, name);
  else if (exportHost.save) exportHost.save(new Blob([page], { type: 'text/html' }), name, true);
  else if (window.desktop) await window.desktop.printPdf(page, name);
  else printInBrowser(page);
}

export const exportNotes = (ids: string[], format: ExportFormat, mode: ExportMode = 'save') =>
  run(ids, format, mode).catch(() => store.getState().showToast({ message: `That could not be ${mode === 'share' ? 'shared' : 'exported'}.` }));
