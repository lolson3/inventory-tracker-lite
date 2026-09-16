import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  command,
  HttpError,
  integer,
  object,
  string,
  type State,
  type Operation,
} from './model.js';

export class Store {
  private db: DatabaseSync;
  constructor(path: string, legacyPath?: string, initialize = true) {
    if (!initialize && !existsSync(path))
      throw new Error('Database does not exist');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;',
      );
      const version = this.db.prepare('PRAGMA user_version').get()!
        .user_version;
      if (version !== 0 && version !== 1)
        throw new Error('Unsupported database schema version');
      if (!initialize && version !== 1)
        throw new Error('Database has not been initialized');
      if (version === 0) {
        this.transaction(() => {
          this.db.exec(`
            CREATE TABLE types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);
            CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL DEFAULT '', type_id INTEGER REFERENCES types(id) ON DELETE SET NULL, qty INTEGER NOT NULL CHECK(qty BETWEEN 0 AND 9007199254740991));
            CREATE TABLE barcodes (code TEXT PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)));
            CREATE UNIQUE INDEX one_primary ON barcodes(item_id) WHERE is_primary=1;
            CREATE TABLE meta (revision INTEGER NOT NULL);
            INSERT INTO meta VALUES (0);
            CREATE TABLE requests (id TEXT PRIMARY KEY, command TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            PRAGMA user_version=1;
          `);
          if (legacyPath && existsSync(legacyPath))
            this.importLegacy(JSON.parse(readFileSync(legacyPath, 'utf8')));
        });
      }
      if (this.db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok')
        throw new Error('Database integrity check failed');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private importLegacy(value: unknown) {
    const data = object(value);
    if (
      !Array.isArray(data.inventory) ||
      data.inventory.length > 100000 ||
      !Array.isArray(data.itemTypes) ||
      data.itemTypes.length > 1000
    )
      throw new Error('Invalid legacy inventory');
    const types = new Map<string, number>();
    for (const raw of data.itemTypes) {
      const name = string(raw, 100);
      const id = Number(
        this.db
          .prepare('INSERT INTO types(name,name_key) VALUES (?,?)')
          .run(name, name.toLowerCase()).lastInsertRowid,
      );
      types.set(name, id);
    }
    for (const raw of data.inventory) {
      const item = object(raw),
        code = string(item.barcode, 128),
        type = string(item.type, 100, true);
      if (!Array.isArray(item.aliases) || item.aliases.length > 100)
        throw new Error('Invalid legacy aliases');
      if (type && !types.has(type)) throw new Error('Unknown legacy item type');
      const id = Number(
        this.db
          .prepare('INSERT INTO items(description,type_id,qty) VALUES (?,?,?)')
          .run(
            string(item.description, 1000, true, false),
            types.get(type) ?? null,
            integer(item.qty),
          ).lastInsertRowid,
      );
      this.db.prepare('INSERT INTO barcodes VALUES (?,?,1)').run(code, id);
      for (const alias of item.aliases)
        this.db
          .prepare('INSERT INTO barcodes VALUES (?,?,0)')
          .run(string(alias, 128), id);
    }
  }
  read(): State {
    // A read transaction keeps the revision and rows consistent across processes.
    this.db.exec('BEGIN');
    try {
      const revision = Number(
        this.db.prepare('SELECT revision FROM meta').get()!.revision,
      );
      const itemTypes = this.db
        .prepare('SELECT id,name FROM types ORDER BY name_key')
        .all() as State['itemTypes'];
      const codes = this.db
        .prepare('SELECT * FROM barcodes ORDER BY code')
        .all();
      const codesByItem = new Map<
        number,
        { primary: string; aliases: string[] }
      >();
      for (const code of codes) {
        const id = Number(code.item_id);
        const entry = codesByItem.get(id) ?? { primary: '', aliases: [] };
        if (code.is_primary === 1) entry.primary = String(code.code);
        else entry.aliases.push(String(code.code));
        codesByItem.set(id, entry);
      }
      const inventory = this.db
        .prepare(
          'SELECT id,description,type_id AS typeId,qty FROM items ORDER BY id',
        )
        .all()
        .map((row) => ({
          id: Number(row.id),
          description: String(row.description),
          typeId: row.typeId === null ? null : Number(row.typeId),
          qty: Number(row.qty),
          barcode: codesByItem.get(Number(row.id))!.primary,
          aliases: codesByItem.get(Number(row.id))!.aliases,
        }));
      this.db.exec('COMMIT');
      return { revision, itemTypes, inventory };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  apply(value: unknown): State {
    const cmd = command(value);
    this.transaction(() => {
      const encoded = JSON.stringify(cmd),
        prior = this.db
          .prepare('SELECT command FROM requests WHERE id=?')
          .get(cmd.requestId);
      if (prior) {
        if (prior.command !== encoded)
          throw new HttpError(
            409,
            'Request ID already used for another change',
          );
        return;
      }
      const revision = Number(
        this.db.prepare('SELECT revision FROM meta').get()!.revision,
      );
      if (
        cmd.operation.kind !== 'scan' &&
        cmd.operation.kind !== 'batch' &&
        cmd.revision !== revision
      )
        throw new HttpError(
          409,
          'Inventory changed elsewhere. Reload and review your change.',
        );
      this.mutate(cmd.operation);
      this.db.prepare('UPDATE meta SET revision=revision+1').run();
      this.db
        .prepare('INSERT INTO requests(id,command) VALUES (?,?)')
        .run(cmd.requestId, encoded);
    });
    return this.read();
  }
  private mutate(op: Operation) {
    const db = this.db;
    if (
      'id' in op &&
      op.kind !== 'deleteType' &&
      !db.prepare('SELECT id FROM items WHERE id=?').get(op.id)
    )
      throw new HttpError(404, 'Item not found');
    switch (op.kind) {
      case 'batch': {
        for (const barcode of op.barcodes) {
          if (op.mode === 'add') {
            this.mutate({ kind: 'scan', barcode });
          } else {
            const row = db
              .prepare('SELECT item_id FROM barcodes WHERE code=?')
              .get(barcode);
            if (!row)
              throw new HttpError(
                409,
                `Unknown barcode: ${barcode}. No changes were applied.`,
              );
            const result = db
              .prepare('UPDATE items SET qty=qty-1 WHERE id=? AND qty>0')
              .run(row.item_id);
            if (!result.changes)
              throw new HttpError(
                409,
                `Not enough stock for barcode: ${barcode}. No changes were applied.`,
              );
          }
        }
        break;
      }
      case 'scan': {
        const row = db
          .prepare('SELECT item_id FROM barcodes WHERE code=?')
          .get(op.barcode);
        if (row) {
          const result = db
            .prepare(
              'UPDATE items SET qty=qty+1 WHERE id=? AND qty<9007199254740991',
            )
            .run(row.item_id);
          if (!result.changes)
            throw new HttpError(409, 'Quantity limit reached');
        } else {
          if (
            Number(db.prepare('SELECT count(*) AS n FROM items').get()!.n) >=
            100000
          )
            throw new HttpError(409, 'Item limit reached');
          const id = db
            .prepare('INSERT INTO items(qty) VALUES (1)')
            .run().lastInsertRowid;
          db.prepare('INSERT INTO barcodes VALUES (?,?,1)').run(op.barcode, id);
        }
        break;
      }
      case 'addType':
        if (
          db
            .prepare('SELECT id FROM types WHERE name_key=?')
            .get(op.name.toLowerCase())
        )
          throw new HttpError(409, 'Item type already exists');
        if (
          Number(db.prepare('SELECT count(*) AS n FROM types').get()!.n) >= 1000
        )
          throw new HttpError(409, 'Item type limit reached');
        db.prepare('INSERT INTO types(name,name_key) VALUES (?,?)').run(
          op.name,
          op.name.toLowerCase(),
        );
        break;
      case 'deleteType':
        if (!db.prepare('DELETE FROM types WHERE id=?').run(op.id).changes)
          throw new HttpError(404, 'Item type not found');
        break;
      case 'edit': {
        if (
          op.field === 'typeId' &&
          op.value !== null &&
          !db.prepare('SELECT id FROM types WHERE id=?').get(op.value)
        )
          throw new HttpError(400, 'Unknown item type');
        const column = {
          description: 'description',
          qty: 'qty',
          typeId: 'type_id',
        }[op.field];
        db.prepare(`UPDATE items SET ${column}=? WHERE id=?`).run(
          op.value,
          op.id,
        );
        break;
      }
      case 'link':
        if (
          db.prepare('SELECT code FROM barcodes WHERE code=?').get(op.barcode)
        )
          throw new HttpError(409, 'Barcode already belongs to an item');
        if (
          Number(
            db
              .prepare(
                'SELECT count(*) AS n FROM barcodes WHERE item_id=? AND is_primary=0',
              )
              .get(op.id)!.n,
          ) >= 100
        )
          throw new HttpError(409, 'Alias limit reached');
        db.prepare('INSERT INTO barcodes VALUES (?,?,0)').run(
          op.barcode,
          op.id,
        );
        break;
      case 'unlink': {
        const barcode = db
          .prepare('SELECT is_primary FROM barcodes WHERE code=? AND item_id=?')
          .get(op.barcode, op.id);
        if (!barcode) throw new HttpError(404, 'Linked barcode not found');
        const replacement = db
          .prepare(
            'SELECT code FROM barcodes WHERE item_id=? AND code<>? ORDER BY code LIMIT 1',
          )
          .get(op.id, op.barcode);
        if (!replacement)
          throw new HttpError(
            409,
            'Keep at least one barcode linked to the item',
          );
        db.prepare('DELETE FROM barcodes WHERE code=? AND item_id=?').run(
          op.barcode,
          op.id,
        );
        if (barcode.is_primary === 1)
          db.prepare('UPDATE barcodes SET is_primary=1 WHERE code=?').run(
            replacement.code,
          );
        break;
      }
      case 'delete':
        db.prepare('DELETE FROM items WHERE id=?').run(op.id);
        break;
      case 'clear':
        db.prepare('DELETE FROM items').run();
        break;
      case 'import': {
        db.prepare('DELETE FROM items').run();
        db.prepare('DELETE FROM types').run();
        const types = new Map<string, number>();
        for (const item of op.items) {
          const key = item.type.toLowerCase();
          if (item.type && !types.has(key)) {
            const id = Number(
              db
                .prepare('INSERT INTO types(name,name_key) VALUES (?,?)')
                .run(item.type, key).lastInsertRowid,
            );
            types.set(key, id);
          }
          const id = Number(
            db
              .prepare(
                'INSERT INTO items(description,type_id,qty) VALUES (?,?,?)',
              )
              .run(item.description, types.get(key) ?? null, item.qty)
              .lastInsertRowid,
          );
          db.prepare('INSERT INTO barcodes VALUES (?,?,1)').run(
            item.barcode,
            id,
          );
          for (const alias of item.aliases)
            db.prepare('INSERT INTO barcodes VALUES (?,?,0)').run(alias, id);
        }
        break;
      }
    }
  }
  async backup(path: string) {
    await backup(this.db, path);
  }
  close() {
    this.db.close();
  }
}
