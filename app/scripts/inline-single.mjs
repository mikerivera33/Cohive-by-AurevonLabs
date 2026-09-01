/**
 * Folds the dist-single build into one self-contained HTML file at
 * deploy/cohive.html. The CSP is rewritten to allow exactly the inlined
 * script by its sha256 hash — still no arbitrary script execution.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist-single';
let html = readFileSync(join(DIST, 'index.html'), 'utf8');

// Inline the stylesheet(s).
html = html.replace(
  /<link rel="stylesheet"[^>]*href="\/(assets\/[^"]+\.css)"[^>]*>/g,
  (_, path) => '<style>' + readFileSync(join(DIST, path), 'utf8') + '</style>'
);

// Inline the module script and hash it for the CSP.
const hashes = [];
html = html.replace(
  /<script type="module"[^>]*src="\/(assets\/[^"]+\.js)"[^>]*><\/script>/g,
  (_, path) => {
    const js = readFileSync(join(DIST, path), 'utf8');
    hashes.push("'sha256-" + createHash('sha256').update(js).digest('base64') + "'");
    return '<script type="module">' + js + '</script>';
  }
);
if (!hashes.length) throw new Error('no module script found to inline');

// Only the hashed inline script may run.
html = html.replace(/script-src 'self'/, 'script-src ' + hashes.join(' '));

// These point at files that don't travel with a single-document deploy.
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '');
html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');

if (/src="\/assets\//.test(html) || /href="\/assets\//.test(html)) {
  throw new Error('external asset references remain — not self-contained');
}

mkdirSync('deploy', { recursive: true });
writeFileSync(join('deploy', 'cohive.html'), html);
console.log(
  'deploy/cohive.html written —',
  (Buffer.byteLength(html) / 1024).toFixed(0) + 'KB, CSP hash ' + hashes.join(', ')
);
