/**
 * Zero-dependency static server + Cohive API for the production build.
 * Serves dist/ with security headers and mounts /api/* with auth + ACL.
 * Durability: file-backed store via COHIVE_DATA_FILE (default data/cohive-store.json).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApi } from './server/api.mjs';
import { seed } from './server/seed.mjs';
import { createStoreAsync } from './server/store.mjs';
import { defaultPersistPath } from './server/persist.mjs';

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const persistPath = defaultPersistPath();
const store = await createStoreAsync(seed, { persistPath });
const api = createApi({ store });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api')) {
      await api.nodeHandler(req, res);
      return;
    }

    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '\\') path = '/index.html';
    let file = join(DIST, path);
    if (!file.startsWith(DIST)) file = join(DIST, 'index.html');

    let body;
    let served = file;
    try {
      const s = await stat(file);
      if (s.isDirectory()) throw new Error('dir');
      body = await readFile(file);
    } catch {
      served = join(DIST, 'index.html');
      body = await readFile(served);
    }

    const ext = extname(served);
    const immutable = served.includes(`${join('dist', 'assets')}`) || /-[\w]{8,}\./.test(served);
    const fontCache = ext === '.woff2';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control':
        ext === '.html'
          ? 'public, max-age=0, must-revalidate'
          : immutable || fontCache
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
      'Content-Length': body.length,
      ...SECURITY_HEADERS,
    });
    res.end(body);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Cohive serving dist/ + /api on :${PORT}` +
      (persistPath ? ` (persist: ${persistPath})` : ' (memory-only store)')
  );
});
