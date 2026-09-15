import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type InventoryItem = {
  barcode: string;
  aliases: string[];
  description: string;
  type: string;
  qty: number;
};

type InventoryData = {
  inventory: InventoryItem[];
  itemTypes: string[];
};

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = root.endsWith('dist') ? dirname(root) : root;
const htmlPath = join(projectRoot, 'inventory_program.html');
const cssPath = join(projectRoot, 'styles.css');
const dataDir = join(projectRoot, 'data');
const dataPath = join(dataDir, 'inventory.json');
const host = '0.0.0.0';
const port = Number(process.env.PORT) || 3001;
const emptyData: InventoryData = { inventory: [], itemTypes: [] };

async function readData(): Promise<InventoryData> {
  try {
    return JSON.parse(await readFile(dataPath, 'utf8')) as InventoryData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyData;
    throw error;
  }
}

async function writeData(data: InventoryData): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${dataPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, dataPath);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, { 'Content-Type': contentType });
  response.end(body);
}

export const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      send(response, 200, await readFile(htmlPath, 'utf8'), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && request.url === '/styles.css') {
      send(response, 200, await readFile(cssPath, 'utf8'), 'text/css; charset=utf-8');
      return;
    }

    if (request.url === '/api/data' && request.method === 'GET') {
      send(response, 200, JSON.stringify(await readData()), 'application/json');
      return;
    }

    if (request.url === '/api/data' && request.method === 'PUT') {
      await writeData(await readBody(request) as InventoryData);
      response.writeHead(204).end();
      return;
    }

    send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch (error) {
    console.error(error);
    send(response, 500, 'Server error', 'text/plain; charset=utf-8');
  }
});

server.listen(port, host, () => {
  console.log(`Inventory tracker listening on http://${host}:${port}`);
});
