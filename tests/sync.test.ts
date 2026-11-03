import 'fake-indexeddb/auto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { baseNote, deleteForever } from '../src/lib/actions';
import { importBackup } from '../src/lib/backup';
import { db } from '../src/lib/db';
import { enableServerSync, syncNow } from '../src/lib/sync';

let server: { close(): void; address(): { port: number } };
let dir: string;
// Imported through variables because the project has no Node type definitions.
const load = (path: string) => import(/* @vite-ignore */ path);
let fs: { mkdtemp(p: string): Promise<string>; rm(p: string, o: object): Promise<void> };

beforeAll(async () => {
  fs = await load('node:fs/promises');
  dir = await fs.mkdtemp(`${(await load('node:os')).tmpdir()}/cn-sync-`);
  server = await (await load('../server/sync.mjs')).startServer({ token: 'secret', dir });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => realFetch(`http://127.0.0.1:${server.address().port}/${url}`, init);
});
afterAll(async () => {
  server.close();
  await fs.rm(dir, { recursive: true });
});

/** A second device, faked by wiping this one and syncing from scratch. */
const freshDevice = async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await enableServerSync('secret');
};

it('moves notes, images and deletes between devices through the server', async () => {
  const keep = baseNote({ title: 'Καλημέρα', content: { type: 'doc', content: [{ type: 'noteImage', attrs: { imageId: 'img1' } }] } });
  const gone = baseNote({ title: 'gone' });
  await db.notes.bulkAdd([keep, gone]);
  await db.images.add({ id: 'img1', name: 'a.png', size: 3, width: 1, height: 1, createdAt: Date.now(), blob: new Blob(['png'], { type: 'image/png' }) });
  await enableServerSync('secret');

  await freshDevice();
  expect((await db.notes.get(keep.id))?.title).toBe('Καλημέρα');
  const img = await db.images.get('img1');
  expect(img?.blob.type).toBe('image/png');
  expect(await img?.blob.text()).toBe('png');

  await deleteForever([gone.id]);
  await syncNow();

  await freshDevice();
  expect(await db.notes.get(gone.id)).toBeUndefined();
  expect(await db.notes.get(keep.id)).toBeDefined();
});

it('passes on old edits that arrive through a backup file', async () => {
  await syncNow();
  const old = baseNote({ title: 'from the file', updatedAt: 1000 });
  const file = new File([JSON.stringify({ format: 'clean-notes-backup', notes: [old], notebooks: [], files: [], blobs: [] })], 'b.json');
  await importBackup(file);
  await syncNow();
  await freshDevice();
  expect((await db.notes.get(old.id))?.title).toBe('from the file');
});

it('sends an image again if the server dropped it while another note still used it', async () => {
  const first = baseNote({ content: { type: 'doc', content: [{ type: 'noteImage', attrs: { imageId: 'img2' } }] } });
  await db.notes.add(first);
  await db.images.add({ id: 'img2', name: 'b.png', size: 3, width: 1, height: 1, createdAt: Date.now(), blob: new Blob(['two'], { type: 'image/png' }) });
  await syncNow();
  // Another device deletes the only note the server knows uses the image, so the server drops it.
  await fetch(`api/sync`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    body: JSON.stringify({ since: 0, records: [{ table: 'tombstones', id: first.id, time: Date.now() + 1, data: { id: first.id, table: 'notes', deletedAt: Date.now() + 1 } }] }),
  });
  // A copy made here before that delete arrived still uses it.
  await db.notes.add(baseNote({ content: first.content, updatedAt: Date.now() + 2 }));
  await syncNow();
  await freshDevice();
  expect(await (await db.images.get('img2'))?.blob.text()).toBe('two');
});

it('reports a wrong token without wiping anything', async () => {
  await db.meta.put({ key: 'syncToken', value: 'wrong' });
  const before = await db.notes.count();
  await syncNow();
  expect(await db.notes.count()).toBe(before);
});
