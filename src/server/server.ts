import { join, resolve } from 'node:path';
import { config } from './config.js';
import { Store } from './storage.js';
import { createApp } from './http.js';

const root = resolve();
const settings = config();
const store = new Store(
  join(settings.dataDir, 'inventory.sqlite'),
  join(settings.dataDir, 'inventory.json'),
);
const server = createApp({ ...settings, store, root });
server.maxConnections = 100;
server.on('error', (error) => {
  console.error(error);
  store.close();
  process.exitCode = 1;
});
server.listen(settings.port, settings.host, () =>
  console.log(
    `Inventory tracker listening on ${settings.publicOrigin ?? `http://${settings.host}:${settings.port}`}`,
  ),
);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    store.close();
  });
  setTimeout(() => {
    server.closeAllConnections();
  }, 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
