import { mountScanning } from './components/scanning.js';
import { closeDropdown, mountDropdowns } from './components/dropdown.js';
import { mountThemeToggle } from './components/theme.js';
import { Controller } from './controller.js';
import { exportCsv, importCsv } from './utils/csv.js';
import type { Operation, State } from '../server/model.js';

export function mount(doc: Document, request: typeof fetch = fetch) {
  const element = <T extends HTMLElement>(id: string) =>
    doc.getElementById(id) as T;
  mountDropdowns(doc);
  mountThemeToggle(doc);
  const rows = element<HTMLTableSectionElement>('inventoryRows');
  const editor = element<HTMLFieldSetElement>('editor');
  let scanning: ReturnType<typeof mountScanning> | undefined;
  const filter = element<HTMLDivElement>('typeFilter');
  const filterButton = element<HTMLButtonElement>('typeFilterButton');
  const filterMenu = element<HTMLDivElement>('typeFilterMenu');
  let selectedType = 'all';
  function closeFilter() {
    closeDropdown(filter);
  }
  const typeCreator = element<HTMLDivElement>('typeCreator');
  const addTypeButton = element<HTMLButtonElement>('addTypeButton');
  const typeOverlay = element<HTMLDivElement>('typeOverlay');
  function closeTypeOverlay() {
    typeOverlay.hidden = true;
    addTypeButton.setAttribute('aria-expanded', 'false');
    addTypeButton.focus();
  }
  addTypeButton.addEventListener('click', () => {
    if (!typeOverlay.hidden) {
      closeTypeOverlay();
      return;
    }
    closeFilter();
    typeOverlay.hidden = false;
    addTypeButton.setAttribute('aria-expanded', 'true');
    element<HTMLInputElement>('newType').focus();
  });
  element('cancelTypeButton').addEventListener('click', closeTypeOverlay);
  typeCreator.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTypeOverlay();
    }
  });
  doc.addEventListener('click', (event) => {
    if (!typeOverlay.hidden && !typeCreator.contains(event.target as Node)) {
      typeOverlay.hidden = true;
      addTypeButton.setAttribute('aria-expanded', 'false');
    }
  });
  let sortKey: 'name' | 'qty' = 'name';
  let sortDirection: 'ascending' | 'descending' = 'ascending';
  const status = element<HTMLParagraphElement>('status');
  const retry = element<HTMLButtonElement>('retryBtn');
  const escape = (value: string | number) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  let rendered: State | null = null;
  let preservedQuantity: { id: number; qty: number } | null = null;
  let quantityTimer: number | undefined;
  const controller = new Controller(update, request);
  const linkOverlay = element<HTMLDivElement>('linkOverlay');
  const linkInput = element<HTMLInputElement>('linkedBarcode');
  let linkItem: number | null = null;
  function closeLinkOverlay() {
    linkOverlay.hidden = true;
    editor.inert = false;
    rows
      .querySelector<HTMLElement>(`[data-item="${linkItem}"] .filter-trigger`)
      ?.focus();
  }
  element('cancelLink').addEventListener('click', closeLinkOverlay);
  element('retryLink').addEventListener('click', () => {
    void retrySave();
  });
  linkOverlay.addEventListener('click', (event) => {
    if (event.target === linkOverlay) closeLinkOverlay();
  });
  linkOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLinkOverlay();
    }
    if (event.key === 'Tab') {
      const controls = [
        ...linkOverlay.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
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
  const removeOverlay = element<HTMLDivElement>('removeTypeOverlay');
  const cancelRemove = element<HTMLButtonElement>('cancelRemoveType');
  const confirmRemove = element<HTMLButtonElement>('confirmRemoveType');
  let removingType: number | null = null;
  function closeRemoveOverlay() {
    removeOverlay.hidden = true;
    removingType = null;
    editor.inert = false;
    filterButton.focus();
  }
  cancelRemove.addEventListener('click', closeRemoveOverlay);
  confirmRemove.addEventListener('click', () => {
    if (removingType === null) return;
    const id = removingType;
    closeRemoveOverlay();
    void run({ kind: 'deleteType', id });
  });
  removeOverlay.addEventListener('click', (event) => {
    if (event.target === removeOverlay) closeRemoveOverlay();
  });
  removeOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRemoveOverlay();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      (doc.activeElement === cancelRemove
        ? confirmRemove
        : cancelRemove
      ).focus();
    }
  });
  function draw() {
    const state = controller.state;
    if (
      selectedType !== 'all' &&
      !state.itemTypes.some((type) => String(type.id) === selectedType)
    )
      selectedType = 'all';
    filterButton.textContent =
      selectedType === 'all'
        ? 'All item types'
        : state.itemTypes.find((type) => String(type.id) === selectedType)!
            .name;
    const choice = (value: string, label: string) =>
      `<button type="button" class="filter-choice" data-filter="${value}" aria-pressed="${selectedType === value}">${escape(label)}</button>`;
    filterMenu.innerHTML =
      choice('all', 'All item types') +
      state.itemTypes
        .map(
          (type) =>
            `<div class="filter-option">${choice(String(type.id), type.name)}<button type="button" class="delete-type" data-type="${type.id}" aria-label="Remove ${escape(type.name)}" title="Remove type"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg></button></div>`,
        )
        .join('');
    const items = state.inventory.filter(
      (item) => selectedType === 'all' || item.typeId === Number(selectedType),
    );
    const direction = sortDirection === 'ascending' ? 1 : -1;
    items.sort((a, b) => {
      const comparison =
        sortKey === 'qty'
          ? a.qty - b.qty
          : a.description.localeCompare(b.description, undefined, {
              numeric: true,
              sensitivity: 'base',
            });
      return comparison * direction || a.id - b.id;
    });
    rows.innerHTML = items
      .map(
        (item) => `<tr>
      <td><div class="description-cell"><span class="description-text">${escape(item.description || 'No description')}</span><input aria-label="Description for ${escape(item.barcode)}" data-id="${item.id}" data-field="description" maxlength="1000" value="${escape(item.description)}" title="Enter to save, Escape to cancel" hidden><button type="button" class="edit-description" data-action="editDescription" data-id="${item.id}" aria-label="Edit description for ${escape(item.barcode)}" title="Edit description"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button></div></td>
      <td><select aria-label="Type for ${escape(item.barcode)}" data-id="${item.id}" data-field="typeId"><option value="">No type</option>${state.itemTypes.map((type) => `<option value="${type.id}" ${type.id === item.typeId ? 'selected' : ''}>${escape(type.name)}</option>`).join('')}</select></td>
      <td><div class="filter-dropdown barcode-dropdown" data-item="${item.id}"><button type="button" class="filter-trigger" aria-expanded="false" aria-controls="barcode-menu-${item.id}" aria-label="Barcodes for ${escape(item.description || item.barcode)}">${escape(item.barcode)}</button><div id="barcode-menu-${item.id}" class="filter-menu" role="group" aria-label="Linked barcodes" hidden>${[item.barcode, ...item.aliases].map((code) => `<div class="barcode-option"><span>${escape(code)}${code === item.barcode ? '<small>Primary</small>' : ''}</span><button type="button" class="delete-type" data-action="unlink" data-id="${item.id}" data-code="${escape(code)}" aria-label="Unlink ${escape(code)}" title="${item.aliases.length === 0 ? 'Keep at least one barcode' : 'Unlink barcode'}" ${item.aliases.length === 0 ? 'disabled' : ''}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg></button></div>`).join('')}<button type="button" class="barcode-link" data-action="link" data-id="${item.id}">+ Link barcode</button></div></div></td>
      <td><input aria-label="Quantity for ${escape(item.barcode)}" data-id="${item.id}" data-field="qty" type="number" min="0" max="9007199254740991" step="1" value="${item.qty}"></td>
      <td><button type="button" class="danger" data-action="delete" data-id="${item.id}">Delete</button></td>
    </tr>`,
      )
      .join('');
    element('empty').hidden = items.length > 0;
  }
  function update() {
    scanning?.update();
    linkInput.disabled =
      !controller.ready || controller.busy || controller.pending !== null;
    element<HTMLButtonElement>('submitLink').disabled = linkInput.disabled;
    element<HTMLButtonElement>('retryLink').hidden =
      controller.pending?.operation.kind !== 'link';
    element<HTMLButtonElement>('retryLink').disabled = controller.busy;
    element('linkStatus').textContent = linkOverlay.hidden
      ? ''
      : controller.message;
    status.textContent = controller.message;
    status.hidden = !controller.message;
    const pendingOperation = controller.pending?.operation;
    const savingQuantity =
      pendingOperation?.kind === 'edit' && pendingOperation.field === 'qty';
    editor.disabled =
      !controller.ready ||
      (!savingQuantity && (controller.busy || controller.pending !== null));
    editor.classList.toggle('saving-quantity', savingQuantity);
    if (savingQuantity) editor.setAttribute('aria-busy', 'true');
    else editor.removeAttribute('aria-busy');
    retry.hidden = controller.pending === null || controller.busy;
    retry.disabled = controller.busy;
    if (rendered !== controller.state) {
      rendered = controller.state;
      const savedQuantity =
        preservedQuantity &&
        controller.message === 'Saved.' &&
        controller.state.inventory.some(
          (item) =>
            item.id === preservedQuantity!.id &&
            item.qty === preservedQuantity!.qty,
        );
      if (savedQuantity) preservedQuantity = null;
      else draw();
    }
  }
  async function retrySave() {
    const operation = controller.pending?.operation;
    await controller.retry();
    if (controller.message !== 'Saved.' || !operation) return;
    const input =
      operation.kind === 'addType'
        ? element<HTMLInputElement>('newType')
        : operation.kind === 'link'
          ? element<HTMLInputElement>('linkedBarcode')
          : null;
    if (input) {
      input.value = '';
      if (input.id === 'newType') closeTypeOverlay();
      else if (input.id === 'linkedBarcode') closeLinkOverlay();
      else input.focus();
    }
  }
  async function run(operation: Operation, input?: HTMLInputElement) {
    await controller.execute(operation);
    if (controller.message === 'Saved.' && input) {
      input.value = '';
      if (input.id === 'newType') closeTypeOverlay();
      else if (input.id === 'linkedBarcode') closeLinkOverlay();
      else input.focus();
    }
  }
  async function saveQuantity(input: HTMLInputElement) {
    if (!input.isConnected || controller.busy || controller.pending) return;
    if (!input.checkValidity()) {
      input.reportValidity();
      return;
    }
    const id = Number(input.dataset.id);
    const qty = Number(input.value);
    if (controller.state.inventory.find((item) => item.id === id)?.qty === qty)
      return;
    preservedQuantity = { id, qty };
    await run({ kind: 'edit', id, field: 'qty', value: qty });
  }
  element<HTMLFormElement>('typeForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = element<HTMLInputElement>('newType');
    void run({ kind: 'addType', name: input.value.trim() }, input);
  });
  element<HTMLFormElement>('linkForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = element<HTMLInputElement>('linkedBarcode');
    if (linkItem === null || !input.value.trim()) return;
    void run(
      { kind: 'link', id: linkItem, barcode: input.value.trim() },
      input,
    );
  });
  function finishDescription(input: HTMLInputElement) {
    const cell = input.closest('.description-cell')!;
    input.hidden = true;
    cell.querySelector<HTMLElement>('.description-text')!.hidden = false;
    cell.querySelector<HTMLButtonElement>('.edit-description')!.hidden = false;
  }
  rows.addEventListener('keydown', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.field !== 'description' || input.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      input.value = controller.state.inventory.find(
        (item) => item.id === Number(input.dataset.id),
      )!.description;
      finishDescription(input);
      input
        .closest('.description-cell')!
        .querySelector<HTMLButtonElement>('button')!
        .focus();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      input.dispatchEvent(
        new doc.defaultView!.Event('change', { bubbles: true }),
      );
    }
  });
  rows.addEventListener('focusout', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.field === 'qty') {
      if (quantityTimer !== undefined)
        doc.defaultView!.clearTimeout(quantityTimer);
      quantityTimer = undefined;
      void saveQuantity(input);
      return;
    }
    if (
      input.dataset.field === 'description' &&
      !input.hidden &&
      input.value ===
        controller.state.inventory.find(
          (item) => item.id === Number(input.dataset.id),
        )?.description
    )
      finishDescription(input);
  });
  rows.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.field !== 'qty') return;
    if (quantityTimer !== undefined)
      doc.defaultView!.clearTimeout(quantityTimer);
    quantityTimer = doc.defaultView!.setTimeout(() => {
      quantityTimer = undefined;
      void saveQuantity(input);
    }, 500);
  });
  rows.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const field = input.dataset.field;
    if (field === 'qty') return;
    if (field === 'description' && input.hidden) return;
    if (field !== 'description' && field !== 'typeId') return;
    if (!input.checkValidity()) {
      input.reportValidity();
      return;
    }
    void run({
      kind: 'edit',
      id: Number(input.dataset.id),
      field,
      value:
        field === 'description'
          ? input.value
          : input.value === ''
            ? null
            : Number(input.value),
    });
  });
  rows.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-action]',
    );
    if (!button) return;
    const id = Number(button.dataset.id);
    if (!controller.ready || controller.busy || controller.pending) return;
    if (button.dataset.action === 'editDescription') {
      const cell = button.closest('.description-cell')!;
      cell.querySelector<HTMLElement>('.description-text')!.hidden = true;
      button.hidden = true;
      const input = cell.querySelector<HTMLInputElement>('input')!;
      input.hidden = false;
      input.focus();
      input.select();
      return;
    }
    if (button.dataset.action === 'link') {
      const item = controller.state.inventory.find((item) => item.id === id);
      if (!item) return;
      linkItem = id;
      linkInput.value = '';
      element('linkTarget').textContent = item.description || item.barcode;
      element('linkStatus').textContent = '';
      linkOverlay.hidden = false;
      editor.inert = true;
      linkInput.focus();
      return;
    }
    if (button.dataset.action === 'unlink')
      void run({ kind: 'unlink', id, barcode: button.dataset.code! });
    else if (
      doc.defaultView!.confirm('Delete this item and its linked barcodes?')
    )
      void run({ kind: 'delete', id });
  });
  filterMenu.addEventListener('click', (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-filter]',
    );
    if (choice) {
      selectedType = choice.dataset.filter!;
      closeFilter();
      draw();
      filterButton.focus();
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-type]',
    );
    if (!button || !controller.ready || controller.busy || controller.pending)
      return;
    const type = controller.state.itemTypes.find(
      (type) => type.id === Number(button.dataset.type),
    );
    if (!type) return;
    removingType = type.id;
    element('removeTypeDescription').textContent =
      `Remove “${type.name}”? Assigned items will have no type.`;
    closeFilter();
    editor.inert = true;
    removeOverlay.hidden = false;
    cancelRemove.focus();
  });
  for (const button of doc.querySelectorAll<HTMLButtonElement>('[data-sort]'))
    button.addEventListener('click', () => {
      const nextKey = button.dataset.sort as 'name' | 'qty';
      if (sortKey === nextKey)
        sortDirection =
          sortDirection === 'ascending' ? 'descending' : 'ascending';
      else {
        sortKey = nextKey;
        sortDirection = 'ascending';
      }
      for (const [key, headerId] of [
        ['name', 'nameHeader'],
        ['qty', 'quantityHeader'],
      ] as const) {
        const header = element<HTMLTableCellElement>(headerId);
        const control = header.querySelector<HTMLButtonElement>('button')!;
        const active = sortKey === key;
        header.setAttribute('aria-sort', active ? sortDirection : 'none');
        control.querySelector('span')!.textContent = active
          ? sortDirection === 'ascending'
            ? '↑'
            : '↓'
          : '↕';
        control.setAttribute(
          'aria-label',
          `Sort by ${key === 'name' ? 'name' : 'quantity'} ${active && sortDirection === 'ascending' ? 'descending' : 'ascending'}`,
        );
      }
      draw();
    });
  element('exportBtn').addEventListener('click', () => {
    const link = doc.createElement('a');
    const url = URL.createObjectURL(
      new Blob([exportCsv(controller.state)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    link.href = url;
    link.download = 'inventory.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const importFile = element<HTMLInputElement>('importFile');
  element('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const items = importCsv(await file.text());
        if (
          !doc.defaultView!.confirm(
            `Replace the current inventory with ${items.length} item${items.length === 1 ? '' : 's'} from this CSV?`,
          )
        )
          return;
        await run({ kind: 'import', items });
      } catch (error) {
        controller.message = `Import failed: ${(error as Error).message}`;
        update();
      } finally {
        importFile.value = '';
      }
    })();
  });
  retry.addEventListener('click', () => {
    void retrySave();
  });
  doc.defaultView!.addEventListener('beforeunload', (event) => {
    if (
      controller.busy ||
      controller.pending ||
      quantityTimer !== undefined ||
      scanning?.hasDraft()
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  scanning = mountScanning(doc, controller);
  update();
  void controller.load();
  return controller;
}
if (typeof document !== 'undefined') mount(document);
