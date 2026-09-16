import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './model.js';
import type { Store } from './storage.js';

const BODY_LIMIT = 262144;
function readBody(request: IncomingMessage): Promise<unknown> {
  if (
    request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new HttpError(415, 'Expected application/json');
  if (Number(request.headers['content-length']) > BODY_LIMIT)
    throw new HttpError(413, 'Request too large');
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        chunks.length = 0;
        reject(new HttpError(413, 'Request too large'));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > BODY_LIMIT) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    request.on('error', reject);
    request.on('aborted', () =>
      reject(new HttpError(400, 'Request interrupted')),
    );
  });
}
export function createApp(options: {
  store: Store;
  root: string;
  publicOrigin?: string;
  rateLimit?: number;
  log?: (error: unknown) => void;
}) {
  const { store, root, publicOrigin } = options;
  const assets: Record<string, [string, string]> = {
    '/': ['inventory_program.html', 'text/html; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app.js': ['dist/client/app.js', 'text/javascript; charset=utf-8'],
    '/scanning.js': [
      'dist/client/scanning.js',
      'text/javascript; charset=utf-8',
    ],
    '/dropdown.js': [
      'dist/client/dropdown.js',
      'text/javascript; charset=utf-8',
    ],
    '/controller.js': [
      'dist/client/controller.js',
      'text/javascript; charset=utf-8',
    ],
    '/csv.js': ['dist/client/csv.js', 'text/javascript; charset=utf-8'],  '/img/inventory-favicon-16x16.png': [
    'img/inventory-favicon-16x16.png',
    'image/png',
  ],
  };
  let windowStart = Date.now(),
    requests = 0;
  return createServer(
    {
      requestTimeout: 15000,
      headersTimeout: 10000,
      keepAliveTimeout: 5000,
      maxHeaderSize: 8192,
    },
    async (request, response) => {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Cache-Control', 'no-store');
      if (publicOrigin)
        response.setHeader('Strict-Transport-Security', 'max-age=31536000');
      const json = (status: number, data: unknown) => {
        response.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify(data));
      };
      try {
        if (Date.now() - windowStart >= 60000) {
          windowStart = Date.now();
          requests = 0;
        }
        if (++requests > (options.rateLimit ?? 1200)) {
          response.setHeader('Retry-After', '60');
          throw new HttpError(429, 'Too many requests; wait a minute');
        }
        const url = new URL(
          request.url ?? '/',
          `http://${request.headers.host ?? 'invalid'}`,
        );
        const host = new URL(`http://${request.headers.host ?? 'invalid'}`)
          .hostname;
        if (
          ![
            'localhost',
            '127.0.0.1',
            '[::1]',
            ...(publicOrigin ? [new URL(publicOrigin).hostname] : []),
          ].includes(host)
        )
          throw new HttpError(403, 'Host not allowed');
        if (
          request.headers.origin &&
          request.headers.origin !==
            (publicOrigin ?? `http://${request.headers.host}`)
        )
          throw new HttpError(403, 'Origin not allowed');
        if (url.pathname.startsWith('/api/')) {
          if (url.pathname === '/api/data' && request.method === 'GET') {
            json(200, store.read());
            return;
          }
          if (url.pathname === '/api/operations' && request.method === 'POST') {
            json(200, store.apply(await readBody(request)));
            return;
          }
          if (['/api/data', '/api/operations'].includes(url.pathname)) {
            response.setHeader(
              'Allow',
              url.pathname === '/api/data' ? 'GET' : 'POST',
            );
            throw new HttpError(405, 'Method not allowed');
          }
          throw new HttpError(404, 'Not found');
        }
        const asset = Object.hasOwn(assets, url.pathname)
          ? assets[url.pathname]
          : undefined;
        if (!asset) throw new HttpError(404, 'Not found');
        if (!['GET', 'HEAD'].includes(request.method ?? '')) {
          response.setHeader('Allow', 'GET, HEAD');
          throw new HttpError(405, 'Method not allowed');
        }
        const body = await readFile(join(root, asset[0]));
        response.writeHead(200, { 'Content-Type': asset[1] });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) {
        request.resume();
        if (!(error instanceof HttpError))
          (options.log ?? console.error)(error);
        if (!response.destroyed && !response.writableEnded)
          json(error instanceof HttpError ? error.status : 500, {
            error:
              error instanceof HttpError
                ? error.message
                : 'Server error. Your change may not have saved; retry safely.',
          });
      }
    },
  );
}
