// Copies the pdf.js runtime data into public/ so PDFs render fully offline.
import { cpSync, mkdirSync } from 'node:fs';
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  mkdirSync(`public/pdfjs/${dir}`, { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, {
    recursive: true,
    filter: (src) => !/LICENSE/.test(src) || dir === 'wasm',
  });
}
