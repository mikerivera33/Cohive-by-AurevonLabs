/**
 * File-backed snapshot persistence for the Cohive API store.
 * Single-node durable path — set COHIVE_DATA_FILE (default data/cohive-store.json
 * on Node hosts). On Netlify Functions the filesystem is ephemeral unless a
 * volume/Blobs adapter is wired; leave COHIVE_DATA_FILE unset there.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const STORE_VERSION = 1;

/**
 * @param {string | null | undefined} path
 * @returns {Promise<object | null>}
 */
export async function loadSnapshot(path) {
  if (!path) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw);
    if (!data || data.version !== STORE_VERSION) return null;
    return data;
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
    console.warn('[cohive-store] failed to load snapshot:', e?.message || e);
    return null;
  }
}

/**
 * Atomic-ish write: write temp then rename.
 * @param {string} path
 * @param {object} snapshot
 */
export async function saveSnapshot(path, snapshot) {
  if (!path) return;
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = path + '.tmp';
  const body = JSON.stringify({ ...snapshot, version: STORE_VERSION, savedAt: new Date().toISOString() });
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, path);
}

/**
 * Resolve the default persist path for this process.
 * @returns {string | null}
 */
export function defaultPersistPath() {
  if (process.env.COHIVE_DATA_FILE === '') return null;
  if (process.env.COHIVE_DATA_FILE) return process.env.COHIVE_DATA_FILE;
  // Netlify / serverless: no durable local disk by default.
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) return null;
  return new URL('../data/cohive-store.json', import.meta.url).pathname;
}
