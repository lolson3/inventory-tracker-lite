import type { Controller } from './controller.js';

export function mountScanning(doc: Document, controller: Controller) {
  const get = <T extends HTMLElement>(id: string) =>
    doc.getElementById(id) as T;
  const overlay = get<HTMLDivElement>('scanOverlay');
  const input = get<HTMLInputElement>('batchBarcode');
  const done = get<HTMLButtonElement>('finishBatch');
  const cancel = get<HTMLButtonElement>('cancelBatch');
  const retry = get<HTMLButtonElement>('retryBatch');
  const list = get<HTMLOListElement>('batchScans');
  const editor = get<HTMLFieldSetElement>('editor');
  let mode: 'add' | 'remove' = 'add';
  let scans: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempted = false;
  let localMessage = '';
  const locked = () => controller.busy || controller.pending !== null;
  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function render() {
    list.replaceChildren();
    scans.forEach((barcode, index) => {
      const item = controller.state.inventory.find(
        (item) => item.barcode === barcode || item.aliases.includes(barcode),
      );
      const row = doc.createElement('li');
      const label = doc.createElement('span');
      label.textContent = `${item?.description || item?.barcode || (mode === 'add' ? 'New item' : 'Unknown barcode')} — ${barcode} (${mode === 'add' ? '+1' : '−1'})`;
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = '×';
      remove.setAttribute(
        'aria-label',
        `Discard scan ${index + 1}: ${barcode}`,
      );
      remove.disabled = locked();
      remove.addEventListener('click', () => {
        if (!locked()) {
          scans.splice(index, 1);
          localMessage = '';
          render();
          input.focus();
        }
      });
      row.append(label, remove);
      list.append(row);
    });
    get('batchCount').textContent =
      `${scans.length} scan${scans.length === 1 ? '' : 's'} collected`;
    update();
  }
  function collect() {
    clearTimer();
    if (locked()) return false;
    const code = input.value.trim();
    if (!code) {
      input.value = '';
      return true;
    }
    if (scans.length >= 250)
      localMessage =
        'This batch is full (250 scans). Save it with Done before scanning more.';
    else if (code.length > 128 || /[\u0000-\u001f\u007f]/u.test(code))
      localMessage = 'Invalid barcode. Correct the input before continuing.';
    else {
      scans.push(code);
      input.value = '';
      localMessage = '';
      render();
      list.scrollTop = list.scrollHeight;
      return true;
    }
    update();
    return false;
  }
  function close() {
    clearTimer();
    overlay.hidden = true;
    editor.inert = false;
    scans = [];
    input.value = '';
    attempted = false;
    localMessage = '';
    get<HTMLButtonElement>(
      mode === 'add' ? 'addInventory' : 'removeInventory',
    ).focus();
  }
  function open(next: 'add' | 'remove') {
    if (!controller.ready || locked()) return;
    mode = next;
    scans = [];
    attempted = false;
    localMessage = '';
    input.value = '';
    get('scanTitle').textContent =
      next === 'add' ? 'Add inventory' : 'Remove inventory';
    overlay.hidden = false;
    editor.inert = true;
    render();
    input.focus();
  }
  async function finish() {
    if (locked() || !controller.ready || !collect()) return;
    if (!scans.length) {
      close();
      return;
    }
    attempted = true;
    await controller.execute({ kind: 'batch', mode, barcodes: [...scans] });
    if (controller.message === 'Saved.') close();
    else {
      render();
      input.focus();
    }
  }
  function update() {
    if (overlay.hidden) return;
    input.disabled = locked() || !controller.ready;
    done.disabled = input.disabled;
    cancel.disabled = locked();
    retry.hidden = controller.pending?.operation.kind !== 'batch';
    retry.disabled = controller.busy;
    list.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = locked();
    });
    get('batchStatus').textContent =
      localMessage || (attempted ? controller.message : '');
  }
  get('addInventory').addEventListener('click', () => open('add'));
  get('removeInventory').addEventListener('click', () => open('remove'));
  input.addEventListener('input', () => {
    clearTimer();
    // The configured scanner has no suffix; an input pause delimits each scan.
    timer = setTimeout(collect, 150);
  });
  get<HTMLFormElement>('batchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void finish();
  });
  cancel.addEventListener('click', () => {
    if (!locked()) close();
  });
  retry.addEventListener('click', async () => {
    if (controller.busy) return;
    await controller.retry();
    if (controller.message === 'Saved.') close();
    else render();
  });
  overlay.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      scans.length === 0 &&
      !input.value &&
      !locked()
    )
      close();
    if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      void finish();
    }
    if (event.key === 'Tab') {
      const controls = [
        ...overlay.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
          'input, button',
        ),
      ].filter((control) => !control.disabled && !control.hidden);
      const index = controls.indexOf(doc.activeElement as HTMLInputElement);
      event.preventDefault();
      controls[
        (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      ]?.focus();
    }
  });
  doc.defaultView!.addEventListener('pagehide', clearTimer);
  return {
    update,
    hasDraft: () =>
      !overlay.hidden && (scans.length > 0 || input.value.length > 0),
  };
}
