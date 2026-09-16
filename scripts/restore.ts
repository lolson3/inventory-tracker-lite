import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
const source = process.argv[2],
  target = process.argv[3];
if (!source || !target)
  throw new Error('Usage: npm run restore -- BACKUP NEW_DATA_DIRECTORY');
const destination = resolve(target);
if (existsSync(destination))
  throw new Error(
    'Restore requires a new directory. Stop the service and select the restored directory afterward.',
  );
const db = new DatabaseSync(resolve(source), { readOnly: true });
try {
  if (
    db.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok' ||
    db.prepare('PRAGMA user_version').get()!.user_version !== 1
  )
    throw new Error('Invalid backup');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Invalid backup references');
  for (const table of ['items', 'types', 'barcodes', 'meta', 'requests'])
    db.prepare(`SELECT * FROM ${table} LIMIT 1`).all();
} finally {
  db.close();
}
mkdirSync(destination, { recursive: true, mode: 0o700 });
copyFileSync(
  resolve(source),
  join(destination, 'inventory.sqlite'),
  constants.COPYFILE_EXCL,
);
console.log(
  `Restored to ${destination}. Stop the service before changing DATA_DIR.`,
);
