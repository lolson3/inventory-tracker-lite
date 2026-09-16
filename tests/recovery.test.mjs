import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../dist/server/storage.js';
import { JSDOM } from 'jsdom';
import { mount } from '../dist/client/app.js';

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'inventory-recovery-'));
  t.after(() => {
    assert.equal(resolve(path, '..'), resolve(tmpdir()));
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}
test('backup CLI rejects uninitialized database instead of backing up empty inventory', (t) => {
  const path = directory(t),
    database = join(path, 'inventory.sqlite');
  writeFileSync(database, '');
  const result = spawnSync(
    process.execPath,
    ['dist/cli/backup.js', join(path, 'backup.sqlite')],
    { env: { ...process.env, DATA_DIR: path }, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not been initialized/);
  assert.equal(existsSync(join(path, 'backup.sqlite')), false);
});
test('backup CLI stores default backups inside the data directory', (t) => {
  const path = directory(t);
  new Store(join(path, 'inventory.sqlite')).close();
  const result = spawnSync(process.execPath, ['dist/cli/backup.js'], {
    env: { ...process.env, DATA_DIR: path },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readdirSync(join(path, 'backups')).length, 1);
});
test('corrupt database and corrupt restore source fail without replacing inventory', (t) => {
  const path = directory(t),
    database = join(path, 'inventory.sqlite');
  writeFileSync(database, 'not a database');
  assert.throws(() => new Store(database));
  assert.equal(readFileSync(database, 'utf8'), 'not a database');
  const result = spawnSync(
    process.execPath,
    ['dist/cli/restore.js', database, join(path, 'restored')],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(path, 'restored')), false);
});
test('database write failure rolls back mutation and request receipt', (t) => {
  const path = join(directory(t), 'inventory.sqlite'),
    store = new Store(path),
    fault = new DatabaseSync(path);
  try {
    const first = {
      requestId: randomUUID(),
      revision: 0,
      operation: { kind: 'scan', barcode: 'A' },
    };
    store.apply(first);
    fault.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;",
    );
    const next = {
      requestId: randomUUID(),
      revision: 1,
      operation: { kind: 'scan', barcode: 'A' },
    };
    assert.throws(() => store.apply(next), /simulated storage failure/);
    assert.equal(store.read().inventory[0].qty, 1);
    assert.equal(store.read().revision, 1);
    fault.exec('DROP TRIGGER fail_receipt');
    assert.equal(store.apply(next).inventory[0].qty, 2);
  } finally {
    fault.close();
    store.close();
  }
});
test('successful batch retry clears scans and displays saved quantity', async (t) => {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  let fail = true;
  mount(doc, async (path) => {
    if (path === '/api/data')
      return Response.json({ revision: 0, inventory: [], itemTypes: [] });
    if (fail) {
      fail = false;
      throw new Error('Lost response');
    }
    return Response.json({
      revision: 1,
      inventory: [
        {
          id: 1,
          barcode: 'A',
          aliases: [],
          description: '',
          typeId: null,
          qty: 1,
        },
      ],
      itemTypes: [],
    });
  });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
  doc.getElementById('addInventory').click();
  const input = doc.getElementById('batchBarcode');
  input.value = 'A';
  doc
    .getElementById('batchForm')
    .dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
  await tick();
  assert.match(doc.getElementById('batchScans').textContent, /A/);
  doc.getElementById('retryBatch').click();
  await tick();
  assert.equal(input.value, '');
  assert.equal(doc.querySelector('[data-field="qty"]').value, '1');
  assert.equal(doc.getElementById('status').textContent, 'Saved.');
});
