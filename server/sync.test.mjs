import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from './sync.mjs';

test('sync keeps the newest record, returns changes since a seq, and stores blobs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cn-sync-'));
  const server = await startServer({ token: 't', dir });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headers = { authorization: 'Bearer t' };
  const sync = (since, records) =>
    fetch(`${base}/sync`, { method: 'POST', headers, body: JSON.stringify({ since, records }) }).then((r) => r.json());
  try {
    assert.equal((await fetch(`${base}/sync`, { method: 'POST', body: '{}' })).status, 401);

    const a = await sync(0, [{ table: 'notes', id: 'n1', time: 100, data: { title: 'Καλημέρα ς' } }]);
    assert.deepEqual(a.records, [], 'own push is not echoed back');

    const b = await sync(0, [{ table: 'notes', id: 'n1', time: 50, data: { title: 'older' } }]);
    assert.equal(b.records.length, 1);
    assert.equal(b.records[0].data.title, 'Καλημέρα ς', 'older edit loses, sender gets the newer one');

    await sync(a.seq, [{ table: 'tombstones', id: 'n1', time: 200, data: { id: 'n1', table: 'notes', deletedAt: 200 } }]);
    const c = await sync(a.seq, []);
    assert.deepEqual(c.records.map((r) => r.table), ['tombstones']);

    assert.equal((await fetch(`${base}/blob/x1`, { method: 'HEAD', headers })).status, 404);
    await fetch(`${base}/blob/x1`, { method: 'PUT', headers, body: 'hello' });
    assert.equal(await (await fetch(`${base}/blob/x1`, { headers })).text(), 'hello');
    assert.equal((await fetch(`${base}/blob/..%2Fx`, { headers })).status, 404);

    server.close();
    const again = await startServer({ token: 't', dir });
    const port = again.address().port;
    const d = await fetch(`http://127.0.0.1:${port}/api/sync`, { method: 'POST', headers, body: JSON.stringify({ since: 0, records: [] }) }).then((r) => r.json());
    assert.equal(d.records.length, 2, 'state survives a restart');
    again.close();
  } finally {
    server.close();
    await rm(dir, { recursive: true });
  }
});
