/**
 * Ingest-time sanitization for untrusted import text (captions, pasted URLs).
 * Strip markup and dangerous schemes before anything is scanned or stored.
 * Sanitize on ingest — never rely on display escaping as the security boundary.
 */

const MAX_IMPORT_CHARS = 8_000;

const DANGEROUS_SCHEME =
  /(?:^|[\s"'`=(])(?:javascript|data|vbscript|blob|file|about)\s*:/gi;

const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Collapse risky URL-like tokens that survive tag stripping. */
function neutralizeSchemes(text: string): string {
  return text.replace(DANGEROUS_SCHEME, (match) => match.replace(/:/g, '∶'));
}

/**
 * Returns plain text safe to persist and scan. Empty/whitespace-only input
 * becomes `''`. Length is capped so scanners cannot be fed multi-MB pastes.
 */
export function sanitizeImportText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let text = raw.normalize('NFKC');
  text = text.replace(CONTROL_CHARS, '');
  text = text.replace(HTML_COMMENT, ' ');
  text = text.replace(HTML_TAG, ' ');
  // Decode a few common entities so leftover markup cannot hide schemes.
  text = text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/gi, '&');
  // Second pass after entity decode.
  text = text.replace(HTML_TAG, ' ');
  text = neutralizeSchemes(text);
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > MAX_IMPORT_CHARS) text = text.slice(0, MAX_IMPORT_CHARS);
  return text;
}

export const IMPORT_TEXT_MAX = MAX_IMPORT_CHARS;
