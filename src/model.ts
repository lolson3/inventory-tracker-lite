export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Item = {
  id: number;
  barcode: string;
  aliases: string[];
  description: string;
  typeId: number | null;
  qty: number;
};
export type State = {
  revision: number;
  inventory: Item[];
  itemTypes: { id: number; name: string }[];
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Expected an object');
  return value as Record<string, unknown>;
}
export function string(
  value: unknown,
  max: number,
  empty = false,
  trim = true,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new HttpError(400, 'Invalid text value');
  return trim ? value.trim() : value;
}
export function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new HttpError(400, 'Invalid integer');
  return value;
}
export type Operation =
  | { kind: 'scan'; barcode: string }
  | { kind: 'batch'; mode: 'add' | 'remove'; barcodes: string[] }
  | { kind: 'addType'; name: string }
  | { kind: 'deleteType'; id: number }
  | {
      kind: 'edit';
      id: number;
      field: 'description' | 'qty' | 'typeId';
      value: string | number | null;
    }
  | { kind: 'link' | 'unlink'; id: number; barcode: string }
  | { kind: 'delete'; id: number }
  | { kind: 'clear' };
export type Command = {
  requestId: string;
  revision: number;
  operation: Operation;
};
export function command(value: unknown): Command {
  const input = object(value),
    op = object(input.operation);
  const requestId = string(input.requestId, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  )
    throw new HttpError(400, 'Invalid request ID');
  const revision = integer(input.revision);
  let operation: Operation;
  switch (op.kind) {
    case 'batch':
      if (op.mode !== 'add' && op.mode !== 'remove')
        throw new HttpError(400, 'Invalid scan mode');
      if (
        !Array.isArray(op.barcodes) ||
        op.barcodes.length === 0 ||
        op.barcodes.length > 250
      )
        throw new HttpError(
          400,
          'A batch must contain between 1 and 250 scans',
        );
      operation = {
        kind: 'batch',
        mode: op.mode,
        barcodes: op.barcodes.map((code) => string(code, 128)),
      };
      break;
    case 'scan':
      operation = { kind: op.kind, barcode: string(op.barcode, 128) };
      break;
    case 'addType':
      operation = { kind: op.kind, name: string(op.name, 100) };
      break;
    case 'deleteType':
    case 'delete':
      operation = { kind: op.kind, id: integer(op.id, 1) };
      break;
    case 'link':
    case 'unlink':
      operation = {
        kind: op.kind,
        id: integer(op.id, 1),
        barcode: string(op.barcode, 128),
      };
      break;
    case 'clear':
      operation = { kind: op.kind };
      break;
    case 'edit': {
      const id = integer(op.id, 1);
      if (op.field === 'description')
        operation = {
          kind: 'edit',
          id,
          field: op.field,
          value: string(op.value, 1000, true, false),
        };
      else if (op.field === 'qty')
        operation = {
          kind: 'edit',
          id,
          field: op.field,
          value: integer(op.value),
        };
      else if (op.field === 'typeId')
        operation = {
          kind: 'edit',
          id,
          field: op.field,
          value: op.value === null ? null : integer(op.value, 1),
        };
      else throw new HttpError(400, 'Unknown field');
      break;
    }
    default:
      throw new HttpError(400, 'Unknown operation');
  }
  if (
    Object.keys(op).some((key) => !(key in operation)) ||
    Object.keys(input).some(
      (key) => !['requestId', 'revision', 'operation'].includes(key),
    )
  )
    throw new HttpError(400, 'Unknown property');
  return { requestId, revision, operation };
}
