// Clean Notes sync server. Node stdlib only, one user, behind nginx at /api/.
// Env: SYNC_TOKEN (required), DATA_DIR (default /var/lib/clean-notes), PORT (default 8787).
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { timingSafeEqual } from 'node:crypto';

export async function startServer({ token, dir, port = 0 }) {
  if (!token) throw new Error('SYNC_TOKEN is required');
  const blobDir = join(dir, 'blobs');
  await mkdir(blobDir, { recursive: true });
  const file = join(dir, 'records.json');
  let state = { seq: 0, records: {} };
  try {
    state = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // shortcut: whole state rewritten per sync; fine for one user's notes, move to SQLite if it gets slow.
  let saving = Promise.resolve();
  const save = () =>
    (saving = saving.then(async () => {
      await writeFile(file + '.tmp', JSON.stringify(state));
      await rename(file + '.tmp', file);
    }));

  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (req) => {
    const got = Buffer.from(req.headers.authorization ?? '');
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readJson = async (req) => {
    let s = '';
    // Decodes across chunk edges, so Greek and other multi-byte text stays intact.
    req.setEncoding('utf8');
    for await (const chunk of req) s += chunk;
    return JSON.parse(s);
  };
  const TABLES = new Set(['notes', 'notebooks', 'tombstones', 'files', 'images']);
  const DAY = 24 * 60 * 60 * 1000;

  /** Forgets deleted notes and notebooks, and PDFs and images no note refers to. Saves before removing any bytes. */
  async function cleanUp() {
    for (const r of Object.values(state.records)) {
      if (r.table !== 'tombstones' || !['notes', 'notebooks'].includes(r.data?.table)) continue;
      // Only the tombstone stays, so deleted content does not linger here.
      const deadKey = `${r.data.table}:${r.id}`;
      if (state.records[deadKey]?.time <= r.time) delete state.records[deadKey];
    }
    const used = new Set();
    const walk = (n) => {
      if (n?.type === 'pdfAttachment' && n.attrs?.fileId) used.add(String(n.attrs.fileId));
      if (n?.type === 'noteImage' && n.attrs?.imageId) used.add(String(n.attrs.imageId));
      n?.content?.forEach(walk);
    };
    for (const r of Object.values(state.records)) if (r.table === 'notes') walk(r.data?.content);
    const removed = [];
    for (const [key, r] of Object.entries(state.records)) {
      if ((r.table === 'files' || r.table === 'images') && !used.has(r.id)) {
        delete state.records[key];
        removed.push(r.id);
      }
    }
    await save();
    const owns = (id) => state.records[`files:${id}`] || state.records[`images:${id}`];
    // Checked again here, in case another sync re-sent the record while this one was saving.
    for (const id of removed) if (!owns(id)) await rm(join(blobDir, id), { force: true });
    // Bytes without a record are kept a day: a device uploads them just before it sends the record.
    for (const name of await readdir(blobDir)) {
      if (owns(name)) continue;
      const info = await stat(join(blobDir, name)).catch(() => null);
      if (info && Date.now() - info.mtimeMs > DAY) await rm(join(blobDir, name), { force: true });
    }
  }

  await cleanUp();

  const server = createServer(async (req, res) => {
    try {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/api/sync') {
        const { since, records } = await readJson(req);
        if (typeof since !== 'number' || !Array.isArray(records)) return send(res, 400, { error: 'bad request' });
        // Key to seq, so a newer copy another device sends while this request waits is still returned.
        const accepted = new Map();
        for (const r of records) {
          if (!TABLES.has(r?.table) || typeof r.id !== 'string' || typeof r.time !== 'number') continue;
          const key = `${r.table}:${r.id}`;
          const cur = state.records[key];
          if (cur && cur.time >= r.time) continue;
          // A row deleted after this edit stays deleted.
          if ((r.table === 'notes' || r.table === 'notebooks') && state.records[`tombstones:${r.id}`]?.time >= r.time) continue;
          state.records[key] = { table: r.table, id: r.id, time: r.time, data: r.data, seq: ++state.seq };
          accepted.set(key, state.seq);
        }
        if (accepted.size) await cleanUp();
        const out = Object.entries(state.records)
          .filter(([key, r]) => r.seq > since && accepted.get(key) !== r.seq)
          .map(([, r]) => r);
        return send(res, 200, { seq: state.seq, records: out });
      }
      const m = url.pathname.match(/^\/api\/blob\/([\w-]{1,100})$/);
      if (m) {
        const path = join(blobDir, m[1]);
        if (req.method === 'PUT') {
          await pipeline(req, createWriteStream(path + '.tmp'));
          await rename(path + '.tmp', path);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const info = await stat(path).catch(() => null);
          if (!info) return send(res, 404, { error: 'not found' });
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size });
          if (req.method === 'HEAD') return res.end();
          return void (await pipeline(createReadStream(path), res));
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'server error' });
      else res.destroy();
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startServer({
    token: process.env.SYNC_TOKEN,
    dir: process.env.DATA_DIR ?? '/var/lib/clean-notes',
    port: Number(process.env.PORT ?? 8787),
  });
  console.log(`Clean Notes sync listening on ${server.address().port}`);
}
