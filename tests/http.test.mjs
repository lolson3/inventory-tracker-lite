import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { Store } from '../dist/server/storage.js';
import { createApp } from '../dist/server/http.js';
import { config } from '../dist/server/config.js';
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-http-'));
  const store = new Store(join(directory, 'db.sqlite'));
  const server = createApp({ store, root: process.cwd(), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    assert.equal(resolve(directory, '..'), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) =>
    fetch(base + '/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { base, post, store };
}
const scan = () => ({
  requestId: randomUUID(),
  revision: 0,
  operation: { kind: 'scan', barcode: 'A' },
});
test('API opens inventory and saves scans without credentials', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/api/data')).status, 200);
  assert.equal((await f.post(scan())).status, 200);
  assert.equal(f.store.read().inventory[0].qty, 1);
});
test('security headers, explicit static routes, method restrictions and host/origin checks', async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.base + '/');
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-security-policy'),
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const path of [
    '/styles.css',
    '/app.js',
    '/controller.js',
    '/utils/csv.js',
    '/components/dropdown.js',
    '/components/scanning.js',
    '/components/theme.js',
  ])
    assert.equal((await fetch(f.base + path)).status, 200);
  for (const path of [
    '/data/inventory.sqlite',
    '/.env',
    '/server.ts',
    '/constructor',
    '/api/missing',
  ])
    assert.equal((await fetch(f.base + path)).status, 404);
  assert.equal(
    (await fetch(f.base + '/api/data', { method: 'PUT' })).status,
    405,
  );
  assert.equal(
    (await f.post(scan(), { Origin: 'https://evil.example' })).status,
    403,
  );
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = request(
      f.base + '/api/data',
      { headers: { Host: 'evil.example' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostileHostStatus, 403);
  const lan = await fixture(t, { host: '0.0.0.0' });
  const lanHostStatus = await new Promise((resolve, reject) => {
    const req = request(
      lan.base + '/api/data',
      { headers: { Host: 'truenas.local:5174' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(lanHostStatus, 200);
});
test('rejects malformed, oversized and wrong-content-type bodies without changing data', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post('{')).status, 400);
  assert.equal((await f.post({ unexpected: true })).status, 400);
  assert.equal(
    (await f.post(scan(), { 'Content-Type': 'text/plain' })).status,
    415,
  );
  assert.equal((await f.post('x'.repeat(300000))).status, 413);
  assert.deepEqual(f.store.read().inventory, []);
});
test('chunked uploads also enforce byte limit', async (t) => {
  const f = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = request(
      f.base + '/api/operations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.write(' '.repeat(150000));
    req.end(' '.repeat(150000));
  });
  assert.equal(status, 413);
  assert.equal(f.store.read().revision, 0);
});
test('concurrent HTTP scans do not lose increments', async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all(
    Array.from({ length: 30 }, () => f.post(scan())),
  );
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(f.store.read().inventory[0].qty, 30);
});
test('request limiting is bounded and returns Retry-After', async (t) => {
  const f = await fixture(t, { rateLimit: 2 });
  await fetch(f.base + '/');
  await fetch(f.base + '/');
  const response = await fetch(f.base + '/');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});
test('storage failures return generic errors without exposing filesystem details', async (t) => {
  let logged = false;
  const f = await fixture(t, { log: () => (logged = true) });
  f.store.close();
  const response = await fetch(f.base + '/api/data');
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /sqlite|[A-Z]:\\/);
  assert.equal(logged, true);
  // Let fixture cleanup safely close an already closed database.
  f.store.close = () => {};
});
test('configuration accepts LAN binding and validates optional HTTPS origins', () => {
  assert.equal(config({}).host, '127.0.0.1');
  for (const PORT of ['0', '-1', 'abc', '1.5', '65536', ''])
    assert.throws(() => config({ PORT }));
  assert.equal(config({ HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.throws(() =>
    config({
      PUBLIC_ORIGIN: 'http://inventory.local',
    }),
  );
  assert.equal(
    config({
      HOST: '0.0.0.0',
      PUBLIC_ORIGIN: 'https://inventory.local',
    }).port,
    5174,
  );
});

test('concurrent batches apply all increments and removal failures leave inventory unchanged', async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      f.post({
        requestId: randomUUID(),
        revision: 0,
        operation: { kind: 'batch', mode: 'add', barcodes: ['A', 'A'] },
      }),
    ),
  );
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(f.store.read().inventory[0].qty, 20);
  const rejected = await f.post({
    requestId: randomUUID(),
    revision: 0,
    operation: { kind: 'batch', mode: 'remove', barcodes: ['A', 'unknown'] },
  });
  assert.equal(rejected.status, 409);
  assert.equal(f.store.read().inventory[0].qty, 20);
});
