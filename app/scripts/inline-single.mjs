/**
 * Folds the dist-single build into one self-contained HTML file at
 * deploy/cohive.html. The CSP is rewritten to allow exactly the inlined
 * script by its sha256 hash — still no arbitrary script execution.
 *
 * Self-hosted font files referenced as /fonts/*.woff2 are inlined as data
 * URIs so the single document never hits fonts.googleapis.com / gstatic.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist-single';
let html = readFileSync(join(DIST, 'index.html'), 'utf8');

function fontDataUri(filename) {
  const path = join('public', 'fonts', filename);
  if (!existsSync(path)) throw new Error('missing font for inline: ' + filename);
  const b64 = readFileSync(path).toString('base64');
  return 'data:font/woff2;base64,' + b64;
}

/** Rewrite /fonts/*.woff2 URLs inside a CSS string to data URIs. */
function inlineFontUrls(css) {
  return css.replace(/url\(\s*(['"]?)\/fonts\/([^'")\s]+)\1\s*\)/g, (_, _q, file) => {
    return 'url(' + fontDataUri(file) + ')';
  });
}

/** Match HTML tags that may span lines (preload / stylesheet / script). */
function stripTagsMatching(src, test) {
  return src.replace(/<link\b[\s\S]*?>/gi, (tag) => (test(tag) ? '' : tag));
}

// Drop any leftover Google Fonts tags from older shells (belt-and-braces).
html = stripTagsMatching(
  html,
  (tag) => /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(tag)
);

// Inline the stylesheet(s), embedding self-hosted fonts as data URIs.
html = html.replace(
  /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
  (tag) => {
    const m = tag.match(/href=["']\/(assets\/[^"']+\.css)["']/i);
    if (!m) return tag;
    return '<style>' + inlineFontUrls(readFileSync(join(DIST, m[1]), 'utf8')) + '</style>';
  }
);
// rel may appear after href
html = html.replace(/<link\b(?![^>]*rel=)[^>]*href=["']\/(assets\/[^"']+\.css)["'][^>]*>/gi, (_, path) => {
  return '<style>' + inlineFontUrls(readFileSync(join(DIST, path), 'utf8')) + '</style>';
});

// Inline the module script and hash it for the CSP.
const hashes = [];
html = html.replace(
  /<script\b[^>]*type=["']module["'][^>]*><\/script>/gi,
  (tag) => {
    const m = tag.match(/src=["']\/(assets\/[^"']+\.js)["']/i);
    if (!m) return tag;
    const js = readFileSync(join(DIST, m[1]), 'utf8');
    hashes.push("'sha256-" + createHash('sha256').update(js).digest('base64') + "'");
    return '<script type="module">' + js + '</script>';
  }
);
if (!hashes.length) throw new Error('no module script found to inline');

// CSP: hashed inline script only; data: fonts for inlined woff2; no Google Fonts.
html = html.replace(/script-src 'self'/, 'script-src ' + hashes.join(' '));
html = html.replace(/font-src 'self'/, "font-src 'self' data:");
html = html.replace(/\s*https:\/\/fonts\.googleapis\.com/g, '');
html = html.replace(/\s*https:\/\/fonts\.gstatic\.com/g, '');

// These point at files that don't travel with a single-document deploy.
html = stripTagsMatching(
  html,
  (tag) =>
    /rel=["']manifest["']/i.test(tag) ||
    /rel=["']apple-touch-icon["']/i.test(tag) ||
    /rel=["']modulepreload["']/i.test(tag) ||
    (/rel=["']preload["']/i.test(tag) && /as=["']font["']/i.test(tag)) ||
    /href=["']\/fonts\//i.test(tag)
);

if (/src="\/assets\//.test(html) || /href="\/assets\//.test(html)) {
  throw new Error('external asset references remain — not self-contained');
}
if (/\/fonts\//.test(html)) {
  throw new Error('external /fonts/ references remain — not self-contained');
}
if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html)) {
  throw new Error('Google Fonts egress remains in single-file deploy');
}

mkdirSync('deploy', { recursive: true });
writeFileSync(join('deploy', 'cohive.html'), html);
console.log(
  'deploy/cohive.html written —',
  (Buffer.byteLength(html) / 1024).toFixed(0) + 'KB, CSP hash ' + hashes.join(', ')
);
