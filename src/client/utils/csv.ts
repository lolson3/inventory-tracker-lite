import type { State } from '../../server/model.js';

export type CsvItem = {
  barcode: string;
  aliases: string[];
  description: string;
  type: string;
  qty: number;
};

const HEADERS = [
  'Primary Barcode',
  'Linked Barcodes',
  'Description',
  'Item Type',
  'Qty',
];

export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportCsv(state: State): string {
  return [
    HEADERS.join(','),
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

function rows(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += character;
    } else if (character === '"' && field === '') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      result.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted value.');
  if (field !== '' || row.length) {
    row.push(field);
    result.push(row);
  }
  return result;
}

const restoreCell = (value: string) =>
  value.replace(/^'(?=[\s\uFEFF]*[=+@-])/u, '');

export function importCsv(text: string): CsvItem[] {
  const parsed = rows(text.replace(/^\uFEFF/u, ''));
  if (
    !parsed.length ||
    parsed[0].length !== HEADERS.length ||
    !parsed[0].every((heading, index) => heading === HEADERS[index])
  )
    throw new Error(`Expected columns: ${HEADERS.join(', ')}.`);
  const items: CsvItem[] = [];
  const barcodes = new Set<string>();
  for (let index = 1; index < parsed.length; index++) {
    const values = parsed[index];
    if (values.length === 1 && values[0] === '') continue;
    if (values.length !== HEADERS.length)
      throw new Error(`Row ${index + 1} must have ${HEADERS.length} columns.`);
    const [rawBarcode, rawAliases, rawDescription, rawType, rawQty] =
      values.map(restoreCell);
    const barcode = rawBarcode.trim();
    const aliases = rawAliases
      ? rawAliases.split(' | ').map((alias) => alias.trim())
      : [];
    if (!barcode) throw new Error(`Row ${index + 1} needs a primary barcode.`);
    if (!/^(0|[1-9]\d*)$/u.test(rawQty))
      throw new Error(`Row ${index + 1} has an invalid quantity.`);
    const qty = Number(rawQty);
    if (!Number.isSafeInteger(qty))
      throw new Error(`Row ${index + 1} has an invalid quantity.`);
    for (const code of [barcode, ...aliases]) {
      if (!code) throw new Error(`Row ${index + 1} has an empty barcode.`);
      if (barcodes.has(code))
        throw new Error(`Barcode “${code}” appears more than once.`);
      barcodes.add(code);
    }
    items.push({
      barcode,
      aliases,
      description: rawDescription,
      type: rawType.trim(),
      qty,
    });
  }
  return items;
}
