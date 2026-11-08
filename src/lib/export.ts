import { flushEditor } from './actions';
import { toBase64 } from './backup';
import { db } from './db';
import { saveBlob } from './pdf';
import { store } from './store';

export type ExportFormat = 'pdf' | 'txt' | 'json' | 'html';

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

export const exportPage = (title: string, body: string) => {
  const t = escapeHtml(title || 'Untitled');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${t}</title><style>${STYLE}</style></head><body><h1>${t}</h1>${body}</body></html>`;
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

async function run(id: string, format: ExportFormat, editorHtml: string) {
  flushEditor();
  const note = await db.notes.get(id);
  if (!note) return;
  const name = exportName(note.title, format);
  const save = (text: string, type: string) => {
    const blob = new Blob([text], { type });
    if (exportHost.save) exportHost.save(blob, name, false);
    else saveBlob(blob, name);
  };
  if (format === 'txt') return save(`${note.title || 'Untitled'}\n\n${note.text}\n`, 'text/plain');
  if (format === 'json') {
    const { writer: _, ...rest } = note;
    return save(JSON.stringify(rest, null, 2), 'application/json');
  }
  const page = exportPage(note.title, await exportBody(editorHtml));
  if (format === 'html') return save(page, 'text/html');
  if (exportHost.save) exportHost.save(new Blob([page], { type: 'text/html' }), name, true);
  else if (window.desktop) await window.desktop.printPdf(page, name);
  else printInBrowser(page);
}

export const exportNote = (id: string, format: ExportFormat, editorHtml: string) =>
  run(id, format, editorHtml).catch(() => store.getState().showToast({ message: 'That note could not be exported.' }));
