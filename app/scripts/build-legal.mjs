/**
 * legal/*.md → public/legal/*.html. The markdown is the source of truth;
 * run `npm run build:legal` after editing it. Tiny converter on purpose:
 * headings, paragraphs (two trailing spaces = line break), lists, quotes,
 * rules and bold — nothing else appears in the documents.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const lines = (block) => block.split('\n').map((l) => inline(l.replace(/ {2}$/, ''))).join('<br>\n');

function toHtml(md) {
  const out = [];
  for (const block of md.trim().split(/\n\s*\n/)) {
    const b = block.trim();
    if (b === '---') out.push('<hr>');
    else if (b.startsWith('# ')) out.push(`<h1>${inline(b.slice(2))}</h1>`);
    else if (b.startsWith('## ')) out.push(`<h2>${inline(b.slice(3))}</h2>`);
    else if (b.startsWith('> ')) out.push(`<aside>${lines(b.replace(/^> /gm, ''))}</aside>`);
    else if (b.startsWith('- ')) out.push(`<ul>${b.split(/\n- /).map((li) => `<li>${lines(li.replace(/^- /, ''))}</li>`).join('')}</ul>`);
    else out.push(`<p>${lines(b)}</p>`);
  }
  return out.join('\n');
}

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">
  <title>${esc(title)}</title>
  <style>
    :root { color-scheme: light dark; --bg: #F3F5F9; --ink: #0A0F1C; --soft: #5B6478; --honey: #A8690A; --line: #D9DEE8; --panel: #FFFFFF; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0A0F1C; --ink: #F2F4F8; --soft: #9AA3B5; --honey: #F5A524; --line: #22304A; --panel: #121A2B; } }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 15.5px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: env(safe-area-inset-top, 0) 20px calc(48px + env(safe-area-inset-bottom, 0)); }
    main { max-width: 68ch; margin: 0 auto; }
    h1 { font-size: 26px; line-height: 1.2; letter-spacing: -.01em; margin: 24px 0 14px; }
    h2 { font-size: 17px; margin: 30px 0 8px; }
    p, li { margin: 0 0 12px; }
    ul { padding-left: 20px; }
    aside { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--honey); border-radius: 10px; padding: 10px 14px; margin: 0 0 14px; color: var(--soft); font-size: 14px; }
    hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }
    a { color: var(--honey); }
    nav { display: flex; gap: 16px; padding-top: 18px; font-size: 13.5px; }
    strong { font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <nav><a href="/">← Back to Cohive</a><a href="/legal/terms.html">Terms</a><a href="/legal/privacy.html">Privacy</a></nav>
${body}
  </main>
</body>
</html>
`;

mkdirSync(join(root, 'app', 'public', 'legal'), { recursive: true });
for (const [src, dest, title] of [
  ['TERMS_OF_SERVICE.md', 'terms.html', 'Terms of Service — Cohive by AurevonLabs'],
  ['PRIVACY_POLICY.md', 'privacy.html', 'Privacy Policy — Cohive by AurevonLabs'],
]) {
  const html = page(title, toHtml(readFileSync(join(root, 'legal', src), 'utf8')));
  writeFileSync(join(root, 'app', 'public', 'legal', dest), html);
  console.log('wrote public/legal/' + dest);
}
