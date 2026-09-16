import type { State } from '../src/model.js';
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportCsv(state: State): string {
  return [
    'Primary Barcode,Linked Barcodes,Description,Item Type,Qty',
    ...state.inventory.map((item) =>
      [
        item.barcode,
        item.aliases.join(' | '),
        item.description,
        state.itemTypes.find((type) => type.id === item.typeId)?.name ?? '',
        item.qty,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\r\n');
}
