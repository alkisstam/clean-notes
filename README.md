# Clean Notes

A local-first note-taking PWA with a three-column interface: notebooks, nested tags, daily notes, tasks, a rich-text editor with slash commands, images, and PDFs you can attach, read and search. Notes, images and PDFs are stored in the browser's IndexedDB. There is no server or account.

## Run it

```bash
npm install
npm run dev       # development, at http://localhost:5173
npm run build     # production build, in dist/
npm run preview   # serve that build, with the service worker, at http://localhost:4173
```

## Deploy it

`dist/` is plain static files, and asset paths are relative, so it works at a domain root or in a sub-folder. Installing and offline use need HTTPS (`localhost` also counts). Serve `sw.js` with `Cache-Control: no-cache` so updates reach people promptly. Existing users then see a "new version" prompt.

## How it fits together

| Area | Where | Notes |
| --- | --- | --- |
| Data | `src/lib/db.ts`, `actions.ts` | Dexie tables: `notes`, `notebooks`, `files` (PDF metadata and text), `blobs` (PDF bytes), `images` (original image files) |
| Saving | `src/editor/NoteEditor.tsx`, `journalEdit` in `actions.ts` | Debounced to IndexedDB. Edits pending when a page closes also go to a synchronous localStorage journal, applied on next launch |
| Tags | `src/lib/tags.ts` | A tag is a path, such as `work/clients/acme`. The tree is derived from the notes |
| Tasks | `src/lib/tasks.ts`, `src/editor/TaskItemDue.ts` | The document is the source of truth. Tasks are read from `taskItem` nodes, each with a stable id and optional due date |
| Slash commands | `src/editor/slash.ts` | Add a command by adding one entry to `slashItems` |
| PDFs | `src/lib/pdf.ts`, `src/components/PdfViewer.tsx` | pdf.js. Text is extracted on import so global search can reach it. Its data files are copied to `public/pdfjs` at build time for offline use |
| Images | `src/lib/images.ts`, `src/editor/ImageBlock.tsx` | A block that points to a stored file, with its display width as a percentage of the column |
| Theme | `src/styles/tokens.css` | All colours are variables, with one block each for light and dark |

## Backups

Settings has **Export backup** and **Restore backup**. A backup is one readable JSON file with every note, notebook, PDF and image (base64). Restoring merges: if a note exists in both places, the newer copy wins.

## Tests

```bash
npm test                 # unit tests for tags, tasks, dates and search
npm i -D playwright      # once, for the end-to-end check
npm run build && npx vite preview --port 4173 &
node e2e/smoke.cjs       # add a directory to save screenshots there
```
