/**
 * Zero-dependency static server for the production build — what `npm start`
 * runs on the hosting platform. Serves dist/ with correct MIME types,
 * immutable caching for hashed assets, the same security headers as
 * netlify.toml, and an index.html fallback so deep links resolve.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Resolve inside dist/ only — normalize strips any ../ traversal.
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
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control':
        ext === '.html'
          ? 'public, max-age=0, must-revalidate'
          : immutable
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
      'Content-Length': body.length,
      ...SECURITY_HEADERS,
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cohive serving dist/ on :${PORT}`);
});
