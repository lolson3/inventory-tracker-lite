import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Store } from '../dist/server/storage.js';

function fixture(t, legacy) {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-test-'));
  const path = join(directory, 'inventory.sqlite');
  const json = join(directory, 'inventory.json');
  if (legacy !== undefined) writeFileSync(json, JSON.stringify(legacy));
  const stores = [];
  t.after(() => {
    for (const store of stores) {
      try {
        store.close();
      } catch {}
    }
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir()) + '/') ||
        resolve(directory).startsWith(resolve(tmpdir()) + '\\'),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  const open = () => {
    const store = new Store(path, json);
    stores.push(store);
    return store;
  };
  return { directory, path, json, open };
}
const apply = (
  store,
  operation,
  revision = store.read().revision,
  requestId = randomUUID(),
) => store.apply({ operation, revision, requestId });
const legacy = {
  inventory: [
    {
      barcode: '001',
      aliases: ['002'],
      description: ' Example ',
      type: 'Tools',
      qty: 3,
    },
  ],
  itemTypes: ['Tools'],
};

test('legacy migration preserves data, IDs and quantities across restart; imports once', (t) => {
  const f = fixture(t, legacy),
    store = f.open();
  const before = store.read();
  assert.equal(before.inventory[0].qty, 3);
  assert.equal(before.inventory[0].description, ' Example ');
  assert.deepEqual(before.inventory[0].aliases, ['002']);
  assert.equal(before.itemTypes[0].name, 'Tools');
  apply(store, { kind: 'scan', barcode: '002' });
  store.close();
  writeFileSync(f.json, JSON.stringify({ inventory: [], itemTypes: [] }));
  const reopened = f.open().read();
  assert.equal(reopened.inventory[0].qty, 4);
  assert.equal(reopened.inventory[0].id, before.inventory[0].id);
});
for (const [name, data] of [
  ['invalid schema', {}],
  [
    'negative quantity',
    { ...legacy, inventory: [{ ...legacy.inventory[0], qty: -1 }] },
  ],
  [
    'duplicate barcode',
    { ...legacy, inventory: [{ ...legacy.inventory[0], aliases: ['001'] }] },
  ],
  ['unknown type', { ...legacy, itemTypes: [] }],
])
  test(`migration rejects ${name} without modifying source and can retry`, (t) => {
    const f = fixture(t, data),
      original = readFileSync(f.json, 'utf8');
    assert.throws(() => f.open());
    assert.equal(readFileSync(f.json, 'utf8'), original);
    writeFileSync(f.json, JSON.stringify(legacy));
    assert.equal(f.open().read().inventory.length, 1);
  });
test('scans from stale clients increment atomically; duplicate request survives restart', (t) => {
  const f = fixture(t),
    store = f.open();
  const cmd = {
    operation: { kind: 'scan', barcode: 'A' },
    revision: 0,
    requestId: randomUUID(),
  };
  store.apply(cmd);
  apply(store, { kind: 'scan', barcode: 'A' }, 0);
  assert.equal(store.apply(cmd).inventory[0].qty, 2);
  store.close();
  assert.equal(f.open().apply(cmd).inventory[0].qty, 2);
});
test('rejects stale edits and reused request IDs with different contents', (t) => {
  const store = fixture(t).open();
  const state = apply(store, { kind: 'scan', barcode: 'A' });
  apply(store, { kind: 'scan', barcode: 'A' });
  assert.throws(
    () =>
      apply(
        store,
        { kind: 'edit', id: state.inventory[0].id, field: 'qty', value: 99 },
        state.revision,
      ),
    { status: 409 },
  );
  const id = randomUUID();
  apply(store, { kind: 'scan', barcode: 'B' }, 0, id);
  assert.throws(() => apply(store, { kind: 'scan', barcode: 'C' }, 0, id), {
    status: 409,
  });
  assert.equal(store.read().inventory[0].qty, 2);
});
test('type assignment, link/unlink, delete and clear preserve relational integrity', (t) => {
  const store = fixture(t).open();
  let state = apply(store, { kind: 'scan', barcode: 'A' }),
    id = state.inventory[0].id;
  state = apply(store, { kind: 'addType', name: 'all' });
  const typeId = state.itemTypes[0].id;
  apply(store, { kind: 'edit', id, field: 'typeId', value: typeId });
  apply(store, { kind: 'link', id, barcode: 'alias' });
  assert.equal(
    apply(store, { kind: 'scan', barcode: 'alias' }).inventory[0].qty,
    2,
  );
  assert.throws(() => apply(store, { kind: 'link', id, barcode: 'A' }), {
    status: 409,
  });
  assert.throws(
    () => apply(store, { kind: 'unlink', id, barcode: 'missing' }),
    {
      status: 404,
    },
  );
  assert.throws(() => apply(store, { kind: 'addType', name: 'ALL' }), {
    status: 409,
  });
  assert.equal(
    apply(store, { kind: 'deleteType', id: typeId }).inventory[0].typeId,
    null,
  );
  assert.deepEqual(
    apply(store, { kind: 'unlink', id, barcode: 'alias' }).inventory[0].aliases,
    [],
  );
  apply(store, { kind: 'delete', id });
  state = apply(store, { kind: 'scan', barcode: 'A' });
  assert.notEqual(state.inventory[0].id, id);
  assert.equal(apply(store, { kind: 'clear' }).inventory.length, 0);
});
test('CSV import replaces inventory atomically and consolidates item types', (t) => {
  const store = fixture(t).open();
  apply(store, { kind: 'scan', barcode: 'OLD' });
  const imported = apply(store, {
    kind: 'import',
    items: [
      {
        barcode: 'A',
        aliases: ['A2'],
        description: 'Apple',
        type: 'Food',
        qty: 4,
      },
      {
        barcode: 'B',
        aliases: [],
        description: 'Bread',
        type: 'food',
        qty: 2,
      },
    ],
  });
  assert.deepEqual(
    imported.inventory.map(({ barcode, aliases, description, qty }) => ({
      barcode,
      aliases,
      description,
      qty,
    })),
    [
      { barcode: 'A', aliases: ['A2'], description: 'Apple', qty: 4 },
      { barcode: 'B', aliases: [], description: 'Bread', qty: 2 },
    ],
  );
  assert.deepEqual(
    imported.itemTypes.map(({ name }) => name),
    ['Food'],
  );
  assert.ok(
    imported.inventory.every(
      (item) => item.typeId === imported.itemTypes[0].id,
    ),
  );
  assert.equal(
    imported.inventory.some((item) => item.barcode === 'OLD'),
    false,
  );
  assert.throws(
    () =>
      apply(store, {
        kind: 'import',
        items: [
          {
            barcode: 'duplicate',
            aliases: ['duplicate'],
            description: '',
            type: '',
            qty: 0,
          },
        ],
      }),
    { status: 400 },
  );
  assert.deepEqual(store.read(), imported);
});
test('invalid mutations roll back without changing revision or contents', (t) => {
  const store = fixture(t).open();
  const state = apply(store, { kind: 'scan', barcode: 'A' }),
    id = state.inventory[0].id;
  for (const operation of [
    { kind: 'edit', id, field: 'qty', value: -1 },
    { kind: 'edit', id, field: 'qty', value: 1.5 },
    { kind: 'edit', id, field: 'qty', value: Number.MAX_SAFE_INTEGER + 1 },
    { kind: 'edit', id, field: 'typeId', value: 999 },
    { kind: 'edit', id, field: 'unknown', value: 1 },
    { kind: 'scan', barcode: 'x'.repeat(129) },
    { kind: 'scan', barcode: '\n' },
    { kind: 'scan', barcode: 'A', extra: true },
    { kind: 'unknown' },
  ]) {
    assert.throws(() => apply(store, operation));
    assert.deepEqual(store.read(), state);
  }
});
test('quantity overflow is rejected without losing existing stock', (t) => {
  const store = fixture(t).open();
  const id = apply(store, { kind: 'scan', barcode: 'A' }).inventory[0].id;
  apply(store, {
    kind: 'edit',
    id,
    field: 'qty',
    value: Number.MAX_SAFE_INTEGER,
  });
  assert.throws(() => apply(store, { kind: 'scan', barcode: 'A' }), {
    status: 409,
  });
  assert.equal(store.read().inventory[0].qty, Number.MAX_SAFE_INTEGER);
});
test('independent processes serialize writes to the same SQLite database', async (t) => {
  const f = fixture(t),
    store = f.open();
  const moduleUrl = new URL('../dist/server/storage.js', import.meta.url).href;
  await Promise.all(
    Array.from(
      { length: 3 },
      () =>
        new Promise((resolve, reject) => {
          const script = `import { Store } from ${JSON.stringify(moduleUrl)}; import { randomUUID } from 'node:crypto'; const s=new Store(${JSON.stringify(f.path)}); for(let i=0;i<20;i++) s.apply({requestId:randomUUID(),revision:0,operation:{kind:'scan',barcode:'parallel'}}); s.close();`;
          const child = spawn(process.execPath, [
            '--input-type=module',
            '-e',
            script,
          ]);
          let error = '';
          child.stderr.on('data', (chunk) => (error += chunk));
          child.on('error', reject);
          child.on('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(error)),
          );
        }),
    ),
  );
  assert.equal(store.read().inventory[0].qty, 60);
});
test('online backup and restore CLI preserve all state and reject overwrite', async (t) => {
  const f = fixture(t, legacy),
    store = f.open();
  apply(store, { kind: 'scan', barcode: '002' });
  const backup = join(f.directory, 'backup.sqlite');
  await store.backup(backup);
  const restored = join(f.directory, 'restored');
  const run = () =>
    spawnSync(process.execPath, ['dist/cli/restore.js', backup, restored], {
      encoding: 'utf8',
    });
  assert.equal(run().status, 0);
  const copy = new Store(join(restored, 'inventory.sqlite'));
  try {
    assert.deepEqual(copy.read(), store.read());
  } finally {
    copy.close();
  }
  assert.notEqual(run().status, 0);
});

test('unlinking the primary promotes an alias without changing stock; last barcode is protected', (t) => {
  const store = fixture(t).open();
  const id = apply(store, { kind: 'scan', barcode: 'primary' }).inventory[0].id;
  apply(store, { kind: 'link', id, barcode: 'alias' });
  const item = apply(store, { kind: 'unlink', id, barcode: 'primary' })
    .inventory[0];
  assert.equal(item.barcode, 'alias');
  assert.deepEqual(item.aliases, []);
  assert.equal(item.qty, 1);
  assert.throws(() => apply(store, { kind: 'unlink', id, barcode: 'alias' }), {
    status: 409,
  });
  assert.equal(
    apply(store, { kind: 'scan', barcode: 'alias' }).inventory[0].qty,
    2,
  );
});

test('add batches count duplicates and aliases atomically and retry only once', (t) => {
  const store = fixture(t).open();
  const id = apply(store, { kind: 'scan', barcode: 'A' }).inventory[0].id;
  apply(store, { kind: 'link', id, barcode: 'alias' });
  const requestId = randomUUID();
  const operation = {
    kind: 'batch',
    mode: 'add',
    barcodes: ['A', 'alias', 'B', 'B'],
  };
  const state = apply(store, operation, 0, requestId);
  assert.equal(state.inventory.find((item) => item.barcode === 'A').qty, 3);
  assert.equal(state.inventory.find((item) => item.barcode === 'B').qty, 2);
  assert.deepEqual(apply(store, operation, 0, requestId), state);
});

test('remove batches decrement through aliases and retain zero-stock items', (t) => {
  const store = fixture(t).open();
  const id = apply(store, { kind: 'scan', barcode: 'A' }).inventory[0].id;
  apply(store, { kind: 'link', id, barcode: 'alias' });
  apply(store, { kind: 'scan', barcode: 'A' });
  const operation = { kind: 'batch', mode: 'remove', barcodes: ['A', 'alias'] };
  const requestId = randomUUID();
  const state = apply(store, operation, 0, requestId);
  assert.equal(state.inventory[0].qty, 0);
  assert.deepEqual(state.inventory[0].aliases, ['alias']);
  assert.deepEqual(apply(store, operation, 0, requestId), state);
});

test('unknown or insufficient removals roll back every scan', (t) => {
  const store = fixture(t).open();
  apply(store, { kind: 'scan', barcode: 'A' });
  const before = store.read();
  for (const barcodes of [
    ['A', 'unknown'],
    ['A', 'A'],
  ]) {
    assert.throws(
      () => apply(store, { kind: 'batch', mode: 'remove', barcodes }),
      { status: 409 },
    );
    assert.deepEqual(store.read(), before);
  }
});

test('invalid batches are rejected and add overflow rolls back the batch', (t) => {
  const store = fixture(t).open();
  const id = apply(store, { kind: 'scan', barcode: 'A' }).inventory[0].id;
  apply(store, {
    kind: 'edit',
    id,
    field: 'qty',
    value: Number.MAX_SAFE_INTEGER,
  });
  const before = store.read();
  for (const operation of [
    { kind: 'batch', mode: 'add', barcodes: [] },
    { kind: 'batch', mode: 'add', barcodes: Array(251).fill('A') },
    { kind: 'batch', mode: 'invalid', barcodes: ['A'] },
    { kind: 'batch', mode: 'add', barcodes: [null] },
    { kind: 'batch', mode: 'add', barcodes: ['B', 'A'] },
  ]) {
    assert.throws(() => apply(store, operation));
    assert.deepEqual(store.read(), before);
  }
});
