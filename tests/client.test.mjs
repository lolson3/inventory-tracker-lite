import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { Controller } from '../dist/client/controller.js';
import { mount } from '../dist/client/app.js';
import { mountThemeToggle } from '../dist/client/components/theme.js';
import { csvCell, exportCsv, importCsv } from '../dist/client/utils/csv.js';
const html = readFileSync('public/index.html', 'utf8');
const empty = () => ({ revision: 0, inventory: [], itemTypes: [] });
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('theme button toggles and persists dark mode', (t) => {
  const dom = new JSDOM(html, { url: 'http://localhost' });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  dom.window.localStorage.setItem('inventory-theme', 'dark');
  mountThemeToggle(doc);
  const button = doc.getElementById('themeToggle');
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Switch to light mode');
  button.click();
  assert.equal(doc.documentElement.dataset.theme, 'light');
  assert.equal(dom.window.localStorage.getItem('inventory-theme'), 'light');
  assert.equal(button.getAttribute('aria-label'), 'Switch to dark mode');
});

test('controller blocks mutations before loading and after a failed load', async () => {
  let requests = 0;
  const controller = new Controller(
    () => {},
    async () => {
      requests++;
      throw new Error('Offline');
    },
  );
  await controller.execute({ kind: 'scan', barcode: 'A' });
  assert.equal(requests, 0);
  await controller.load();
  await controller.execute({ kind: 'scan', barcode: 'A' });
  assert.equal(requests, 1);
  assert.equal(controller.ready, false);
  assert.match(controller.message, /Offline/);
});
test('slow loading and saving keep controls locked and do not show premature success', async () => {
  let release;
  const controller = new Controller(
    () => {},
    () => new Promise((resolve) => (release = resolve)),
  );
  const loading = controller.load();
  assert.equal(controller.busy, true);
  assert.equal(controller.ready, false);
  release(response(empty()));
  await loading;
  const saving = controller.execute({ kind: 'scan', barcode: 'A' });
  assert.equal(controller.busy, true);
  assert.equal(controller.message, 'Saving…');
  assert.equal(controller.state.inventory.length, 0);
  release(response({ ...empty(), revision: 1 }));
  await saving;
  assert.equal(controller.message, 'Saved.');
});
test('lost response retries exactly the same request and keeps failed change', async () => {
  const bodies = [];
  let fail = true;
  const controller = new Controller(
    () => {},
    async (path, options) => {
      if (path === '/api/data') return response(empty());
      bodies.push(options.body);
      if (fail) {
        fail = false;
        throw new Error('Disconnected');
      }
      return response({ ...empty(), revision: 1 });
    },
  );
  await controller.load();
  await controller.execute({ kind: 'scan', barcode: 'A' });
  assert.ok(controller.pending);
  assert.match(controller.message, /Retry save/);
  await controller.execute({ kind: 'scan', barcode: 'B' });
  assert.equal(bodies.length, 1);
  await controller.retry();
  assert.equal(bodies[0], bodies[1]);
  assert.equal(controller.pending, null);
});
test('conflict requires reload and does not retry a stale overwrite', async () => {
  const controller = new Controller(
    () => {},
    async (path) =>
      path === '/api/data'
        ? response(empty())
        : response({ error: 'Inventory changed elsewhere' }, 409),
  );
  await controller.load();
  await controller.execute({ kind: 'clear' });
  assert.equal(controller.ready, false);
  assert.equal(controller.pending, null);
  assert.match(controller.message, /refresh the page/);
});
test('DOM starts disabled, load failure retains disabled state, retry recovers', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.getElementById('editor').disabled, true);
  let fail = true;
  const controller = mount(doc, async () => {
    if (fail) throw new Error('Offline');
    return response(empty());
  });
  await tick();
  assert.equal(doc.getElementById('editor').disabled, true);
  fail = false;
  await controller.load();
  assert.equal(doc.getElementById('editor').disabled, false);
});
test('DOM uses stable type IDs, renders hostile text safely, and filters a type named all', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const state = {
    revision: 1,
    itemTypes: [{ id: 8, name: 'all' }],
    inventory: [
      {
        id: 2,
        barcode: '<img src=x onerror=alert(1)>',
        aliases: ['" onclick="alert(1)'],
        description: '<script>alert(1)</script>',
        typeId: 8,
        qty: 1,
      },
      {
        id: 3,
        barcode: 'B',
        aliases: [],
        description: '',
        typeId: null,
        qty: 1,
      },
    ],
  };
  mount(doc, async () => response(state));
  await tick();
  assert.equal(doc.querySelectorAll('#inventoryRows tr').length, 2);
  assert.equal(
    doc.querySelectorAll(
      '#inventoryRows script, #inventoryRows img, #inventoryRows [onclick]',
    ).length,
    0,
  );
  doc.getElementById('typeFilterButton').click();
  doc.querySelector('[data-filter="8"]').click();
  assert.equal(doc.querySelectorAll('#inventoryRows tr').length, 1);
  assert.equal(
    doc.querySelector('[data-field="description"]').value,
    '<script>alert(1)</script>',
  );
});
test('DOM keeps failed edit visible and warns before leaving with pending save', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const state = {
    revision: 1,
    itemTypes: [],
    inventory: [
      {
        id: 9,
        barcode: 'A',
        aliases: [],
        description: 'Before',
        typeId: null,
        qty: 1,
      },
    ],
  };
  const controller = mount(doc, async (path) => {
    if (path === '/api/data') return response(state);
    throw new Error('Network down');
  });
  await tick();
  doc.querySelector('[data-action="editDescription"]').click();
  const input = doc.querySelector('[data-field="description"]');
  input.value = 'Unsaved draft';
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(input.value, 'Unsaved draft');
  assert.ok(controller.pending);
  assert.equal(doc.getElementById('editor').disabled, true);
  assert.equal(doc.getElementById('retryBtn').hidden, false);
  const event = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});
test('CSV quotes commas and quotes and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  for (const text of ['=1+1', '+SUM(A1)', '-1', '@SUM(A1)', '  =1', '\t=1'])
    assert.ok(csvCell(text).startsWith('"\''));
  assert.equal(csvCell('00123'), '"00123"');
  assert.match(exportCsv(empty()), /^Primary Barcode,/);
  const state = {
    revision: 1,
    itemTypes: [{ id: 2, name: 'Tools' }],
    inventory: [
      {
        id: 4,
        barcode: '00123',
        aliases: ['ALT'],
        description: '=Cable, "blue"',
        typeId: 2,
        qty: 7,
      },
    ],
  };
  assert.deepEqual(importCsv(exportCsv(state)), [
    {
      barcode: '00123',
      aliases: ['ALT'],
      description: '=Cable, "blue"',
      type: 'Tools',
      qty: 7,
    },
  ]);
  assert.throws(
    () =>
      importCsv(
        'Primary Barcode,Linked Barcodes,Description,Item Type,Qty\nA,A,,,1',
      ),
    /appears more than once/,
  );
});

test('name and quantity headers sort both directions and Delete is red', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  mount(doc, async () =>
    response({
      revision: 1,
      itemTypes: [],
      inventory: [
        {
          id: 1,
          barcode: 'Z',
          aliases: [],
          description: 'Zebra',
          typeId: null,
          qty: 2,
        },
        {
          id: 2,
          barcode: 'A',
          aliases: [],
          description: 'Apple',
          typeId: null,
          qty: 5,
        },
      ],
    }),
  );
  await tick();
  const descriptions = () =>
    [...doc.querySelectorAll('.description-text')].map(
      (element) => element.textContent,
    );
  assert.deepEqual(descriptions(), ['Apple', 'Zebra']);
  doc.querySelector('[data-sort="name"]').click();
  assert.deepEqual(descriptions(), ['Zebra', 'Apple']);
  assert.equal(
    doc.getElementById('nameHeader').getAttribute('aria-sort'),
    'descending',
  );
  doc.querySelector('[data-sort="qty"]').click();
  assert.deepEqual(descriptions(), ['Zebra', 'Apple']);
  doc.querySelector('[data-sort="qty"]').click();
  assert.deepEqual(descriptions(), ['Apple', 'Zebra']);
  assert.equal(
    doc.getElementById('quantityHeader').getAttribute('aria-sort'),
    'descending',
  );
  assert.equal(doc.querySelectorAll('[data-action="delete"].danger').length, 2);
  assert.equal(doc.getElementById('qtySort'), null);
});

test('quantity clicks debounce into one save without rebuilding the row', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const item = {
    id: 1,
    barcode: 'A',
    aliases: [],
    description: 'Apple',
    typeId: null,
    qty: 1,
  };
  const commands = [];
  let finishSave;
  mount(doc, async (path, options) => {
    if (path === '/api/data')
      return response({ revision: 1, itemTypes: [], inventory: [item] });
    const command = JSON.parse(options.body);
    commands.push(command);
    await new Promise((resolve) => {
      finishSave = resolve;
    });
    return response({
      revision: 2,
      itemTypes: [],
      inventory: [{ ...item, qty: command.operation.value }],
    });
  });
  await tick();
  const row = doc.querySelector('#inventoryRows tr');
  const input = doc.querySelector('[data-field="qty"]');
  input.value = '2';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.value = '3';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(commands.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 550));
  await tick();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].operation.value, 3);
  assert.equal(doc.getElementById('editor').disabled, false);
  assert.equal(doc.getElementById('editor').getAttribute('aria-busy'), 'true');
  assert.equal(doc.getElementById('retryBtn').hidden, true);
  assert.equal(input.disabled, false);
  assert.equal(doc.querySelector('[data-field="typeId"]').disabled, false);
  assert.equal(doc.querySelector('[data-action="delete"]').disabled, false);
  finishSave();
  await tick();
  assert.equal(doc.querySelector('#inventoryRows tr'), row);
  assert.equal(input.value, '3');
  assert.equal(doc.getElementById('status').textContent, 'Saved.');
  assert.ok(doc.getElementById('status').closest('.filters'));
});

test('Import CSV confirms and sends the parsed inventory', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const commands = [];
  dom.window.confirm = () => true;
  mount(doc, async (path, options) => {
    if (path === '/api/data') return response(empty());
    commands.push(JSON.parse(options.body));
    return response({
      revision: 1,
      itemTypes: [],
      inventory: [
        {
          id: 1,
          barcode: 'A',
          aliases: [],
          description: 'Apple',
          typeId: null,
          qty: 3,
        },
      ],
    });
  });
  await tick();
  const input = doc.getElementById('importFile');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [
      {
        text: async () =>
          'Primary Barcode,Linked Barcodes,Description,Item Type,Qty\nA,,Apple,,3',
      },
    ],
  });
  input.dispatchEvent(new dom.window.Event('change'));
  await tick();
  await tick();
  assert.deepEqual(commands[0].operation, {
    kind: 'import',
    items: [
      {
        barcode: 'A',
        aliases: [],
        description: 'Apple',
        type: '',
        qty: 3,
      },
    ],
  });
  assert.equal(doc.querySelector('.description-text').textContent, 'Apple');
  assert.equal(input.value, '');
});

test('browser fetch retains the global receiver for load and save; reload button is absent', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const methods = [];
  t.mock.method(globalThis, 'fetch', async function (path, options) {
    assert.equal(
      this,
      globalThis,
      'fetch must receive the browser global, not the Controller',
    );
    methods.push(options.method);
    return response({ ...empty(), revision: path === '/api/data' ? 0 : 1 });
  });
  const controller = mount(dom.window.document);
  await tick();
  assert.equal(controller.ready, true);
  assert.equal(dom.window.document.getElementById('reloadBtn'), null);
  await controller.execute({ kind: 'scan', barcode: 'A' });
  assert.equal(controller.message, 'Saved.');
  assert.deepEqual(methods, ['GET', 'POST']);
});

test('type dropdown deletes by stable ID, resets selection, and hides loaded status', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const commands = [];
  dom.window.confirm = () => {
    throw new Error('Native confirmation must not be used');
  };
  const state = {
    revision: 3,
    inventory: [],
    itemTypes: [{ id: 42, name: 'Tools' }],
  };
  mount(doc, async (path, options) => {
    if (path === '/api/data') return response(state);
    commands.push(JSON.parse(options.body));
    return response({ ...state, revision: 4, itemTypes: [] });
  });
  await tick();
  assert.equal(doc.getElementById('status').hidden, true);
  assert.equal(doc.getElementById('status').textContent, '');
  assert.equal(doc.getElementById('typeList'), null);
  const trigger = doc.getElementById('typeFilterButton');
  const menu = doc.getElementById('typeFilterMenu');
  trigger.click();
  doc.querySelector('[data-filter="42"]').click();
  assert.equal(trigger.textContent, 'Tools');
  trigger.click();
  const icon = doc.querySelector('.delete-type svg');
  icon.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(commands.length, 0);
  const overlay = doc.getElementById('removeTypeOverlay');
  assert.equal(overlay.hidden, false);
  assert.equal(doc.activeElement, doc.getElementById('cancelRemoveType'));
  assert.match(
    doc.getElementById('removeTypeDescription').textContent,
    /Tools/,
  );
  doc.getElementById('cancelRemoveType').click();
  assert.equal(overlay.hidden, true);
  assert.equal(commands.length, 0);
  trigger.click();
  icon.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  overlay.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(overlay.hidden, true);
  trigger.click();
  icon.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  doc.getElementById('confirmRemoveType').click();
  assert.equal(overlay.hidden, true);
  await tick();
  assert.deepEqual(commands[0].operation, { kind: 'deleteType', id: 42 });
  assert.equal(trigger.textContent, 'All item types');
  assert.equal(doc.querySelector('.delete-type'), null);
  trigger.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('add-type overlay focuses input, preserves failed entry, and closes after retry', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  let fail = true;
  const commands = [];
  mount(doc, async (path, options) => {
    if (path === '/api/data') return response(empty());
    commands.push(JSON.parse(options.body));
    if (fail) {
      fail = false;
      throw new Error('Offline');
    }
    return response({
      ...empty(),
      revision: 1,
      itemTypes: [{ id: 7, name: 'Tools' }],
    });
  });
  await tick();
  assert.equal(doc.querySelector('[data-filter="none"]'), null);
  const button = doc.getElementById('addTypeButton');
  const overlay = doc.getElementById('typeOverlay');
  const input = doc.getElementById('newType');
  assert.equal(overlay.hidden, true);
  button.click();
  assert.equal(overlay.hidden, false);
  assert.equal(doc.activeElement, input);
  doc.getElementById('cancelTypeButton').click();
  assert.equal(overlay.hidden, true);
  button.click();
  input.value = 'Tools';
  doc
    .getElementById('typeForm')
    .dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
  await tick();
  assert.equal(input.value, 'Tools');
  assert.equal(overlay.hidden, false);
  doc.getElementById('retryBtn').click();
  await tick();
  assert.deepEqual(commands[0].operation, { kind: 'addType', name: 'Tools' });
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(overlay.hidden, true);
  assert.equal(input.value, '');
  assert.equal(doc.activeElement, button);
  assert.ok(doc.querySelector('[data-filter="7"]'));
});

test('barcode dropdown links scanned input to its item and retains failed scans for retry', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const item = {
    id: 12,
    barcode: 'PRIMARY',
    aliases: ['ALIAS'],
    description: 'Cable',
    typeId: null,
    qty: 5,
  };
  const state = { revision: 2, inventory: [item], itemTypes: [] };
  let fail = true;
  const commands = [];
  mount(doc, async (path, options) => {
    if (path === '/api/data') return response(state);
    commands.push(JSON.parse(options.body));
    if (fail) {
      fail = false;
      throw new Error('Offline');
    }
    return response({
      ...state,
      revision: 3,
      inventory: [{ ...item, aliases: ['ALIAS', 'SCANNED'] }],
    });
  });
  await tick();
  assert.equal(doc.getElementById('entrySelect'), null);
  const details = doc.querySelector('.barcode-dropdown');
  assert.equal(details.querySelector('.filter-trigger').textContent, 'PRIMARY');
  assert.equal(details.querySelectorAll('[data-action="unlink"]').length, 2);
  details.querySelector('.filter-trigger').click();
  details.querySelector('[data-action="link"]').click();
  const overlay = doc.getElementById('linkOverlay');
  const input = doc.getElementById('linkedBarcode');
  assert.equal(overlay.hidden, false);
  assert.equal(doc.activeElement, input);
  input.value = 'SCANNED';
  doc
    .getElementById('linkForm')
    .dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
  await tick();
  assert.equal(input.value, 'SCANNED');
  assert.equal(overlay.hidden, false);
  doc.getElementById('retryLink').click();
  await tick();
  assert.deepEqual(commands[0].operation, {
    kind: 'link',
    id: 12,
    barcode: 'SCANNED',
  });
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(overlay.hidden, true);
  assert.equal(doc.getElementById('editor').inert, false);
  assert.equal(doc.querySelectorAll('.barcode-option').length, 3);
  assert.equal(doc.querySelector('[data-field="qty"]').value, '5');
});

test('description stays static until Edit; Escape cancels and Enter saves', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const item = {
    id: 5,
    barcode: 'A',
    aliases: [],
    description: 'Original',
    typeId: null,
    qty: 1,
  };
  const commands = [];
  mount(doc, async (path, options) => {
    if (path === '/api/data')
      return response({ revision: 1, inventory: [item], itemTypes: [] });
    const command = JSON.parse(options.body);
    commands.push(command);
    return response({
      revision: 2,
      inventory: [{ ...item, description: command.operation.value }],
      itemTypes: [],
    });
  });
  await tick();
  const input = doc.querySelector('[data-field="description"]');
  const edit = doc.querySelector('.edit-description');
  assert.equal(input.hidden, true);
  assert.equal(doc.querySelector('.description-text').textContent, 'Original');
  edit.click();
  assert.equal(input.hidden, false);
  assert.equal(doc.activeElement, input);
  input.value = 'Cancelled';
  input.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(input.hidden, true);
  assert.equal(input.value, 'Original');
  assert.equal(commands.length, 0);
  edit.click();
  input.value = 'Updated';
  input.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  );
  await tick();
  assert.deepEqual(commands[0].operation, {
    kind: 'edit',
    id: 5,
    field: 'description',
    value: 'Updated',
  });
  assert.equal(doc.querySelector('.description-text').textContent, 'Updated');
  assert.equal(doc.querySelector('[data-field="description"]').hidden, true);
});

test('continuous scanning queues items without saving until Enter finishes the batch', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const commands = [];
  mount(doc, async (path, options) => {
    if (path === '/api/data') return response(empty());
    commands.push(JSON.parse(options.body));
    return response({ ...empty(), revision: 1 });
  });
  await tick();
  assert.equal(doc.getElementById('scanForm'), null);
  assert.equal(doc.querySelector('#editor legend'), null);
  doc.getElementById('addInventory').click();
  const input = doc.getElementById('batchBarcode');
  assert.equal(doc.activeElement, input);
  for (const code of ['A', 'A']) {
    input.value = code;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  assert.equal(doc.querySelectorAll('#batchScans li').length, 2);
  assert.equal(commands.length, 0);
  const unload = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  input.value = 'B';
  input.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }),
  );
  await tick();
  assert.deepEqual(commands[0].operation, {
    kind: 'batch',
    mode: 'add',
    barcodes: ['A', 'A', 'B'],
  });
  assert.equal(doc.getElementById('scanOverlay').hidden, true);
});

test('rejected removal batch remains editable and Done retries corrected scans', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const commands = [];
  mount(doc, async (path, options) => {
    if (path === '/api/data') return response(empty());
    commands.push(JSON.parse(options.body));
    return commands.length === 1
      ? response({ error: 'Unknown barcode. No changes were applied.' }, 409)
      : response({ ...empty(), revision: 1 });
  });
  await tick();
  doc.getElementById('removeInventory').click();
  const input = doc.getElementById('batchBarcode');
  input.value = 'wrong';
  doc.getElementById('finishBatch').click();
  await tick();
  assert.equal(doc.getElementById('scanOverlay').hidden, false);
  assert.equal(input.disabled, false);
  assert.match(
    doc.getElementById('batchStatus').textContent,
    /Unknown barcode/,
  );
  doc.querySelector('#batchScans button').click();
  input.value = 'right';
  doc.getElementById('finishBatch').click();
  await tick();
  assert.deepEqual(commands[1].operation, {
    kind: 'batch',
    mode: 'remove',
    barcodes: ['right'],
  });
  assert.notEqual(commands[0].requestId, commands[1].requestId);
  assert.equal(doc.getElementById('scanOverlay').hidden, true);
});

test('cancelling a scanning session discards its scans without saving', async (t) => {
  const dom = new JSDOM(html, {
    url: 'http://localhost',
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  let saves = 0;
  mount(doc, async (path) => {
    if (path !== '/api/data') saves++;
    return response(empty());
  });
  await tick();
  doc.getElementById('addInventory').click();
  const input = doc.getElementById('batchBarcode');
  input.value = 'A';
  input.dispatchEvent(new dom.window.Event('input'));
  doc.getElementById('cancelBatch').click();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(saves, 0);
  assert.equal(doc.getElementById('scanOverlay').hidden, true);
  doc.getElementById('removeInventory').click();
  assert.equal(doc.querySelectorAll('#batchScans li').length, 0);
});
