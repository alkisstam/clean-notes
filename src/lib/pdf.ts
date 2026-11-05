import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { db, uid } from './db';
import type { PdfFile } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

export function loadPdf(data: ArrayBuffer, password?: string) {
  return pdfjs.getDocument({
    data: new Uint8Array(data),
    password,
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
  });
}

export const isPasswordError = (e: unknown) => (e as { name?: string })?.name === 'PasswordException';

/** Text of one page, joined exactly as the viewer joins its text layer. */
export async function pageText(page: pdfjs.PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    out += item.str;
    if (item.hasEOL) out += ' ';
  }
  return out;
}

async function renderThumb(doc: pdfjs.PDFDocumentProxy): Promise<string | null> {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 144 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL('image/webp', 0.7);
  } catch {
    return null;
  }
}

export function looksLikePdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Stores a PDF with its searchable text and first-page thumbnail. */
export async function importPdf(file: File): Promise<PdfFile> {
  const buffer = await file.arrayBuffer();
  const meta: PdfFile = {
    id: uid(),
    name: file.name,
    size: file.size,
    pageCount: 0,
    pageTexts: [],
    thumb: null,
    encrypted: false,
    createdAt: Date.now(),
  };
  const task = loadPdf(buffer);
  try {
    const doc = await task.promise;
    meta.pageCount = doc.numPages;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      meta.pageTexts.push(await pageText(page));
      page.cleanup();
    }
    meta.thumb = await renderThumb(doc);
  } catch (e) {
    if (!isPasswordError(e)) throw new Error(`"${file.name}" could not be read as a PDF.`);
    // Password-protected files are kept and unlocked when opened.
    meta.encrypted = true;
  } finally {
    void task.destroy();
  }
  await db.transaction('rw', db.files, db.blobs, async () => {
    await db.files.add(meta);
    await db.blobs.add({ id: meta.id, blob: new Blob([file], { type: 'application/pdf' }) });
  });
  // Ask the browser not to evict stored files under storage pressure.
  void navigator.storage?.persist?.();
  return meta;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Set by the Android app, whose WebView ignores download links; it hands the file to other apps instead. */
export const blobSaver: { save: ((blob: Blob, name: string) => void) | null } = { save: null };

export function saveBlob(blob: Blob, name: string) {
  if (blobSaver.save) return blobSaver.save(blob, name);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
