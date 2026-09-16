import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Store } from '../server/storage.js';
const dataDirectory = resolve(process.env.DATA_DIR ?? 'data');
const source = join(dataDirectory, 'inventory.sqlite');
const destination = resolve(
  process.argv[2] ??
    join(
      dataDirectory,
      'backups',
      `inventory-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    ),
);
if (!existsSync(source)) throw new Error('Source database does not exist');
if (existsSync(destination))
  throw new Error('Backup destination already exists');
const { mkdirSync } = await import('node:fs');
mkdirSync(resolve(destination, '..'), { recursive: true, mode: 0o700 });
const store = new Store(source, undefined, false);
try {
  await store.backup(destination);
  console.log(`Backup created: ${destination}`);
} finally {
  store.close();
}
