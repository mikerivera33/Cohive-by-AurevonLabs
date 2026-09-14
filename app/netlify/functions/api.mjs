/**
 * Netlify Function — mounts the same Cohive API under /api/*.
 * Memory-only store per isolate (set COHIVE_DATA_FILE only with a writable
 * volume; prefer a real DB/Blobs adapter for multi-instance durability).
 */
import { createApi } from '../../server/api.mjs';
import { createStore } from '../../server/store.mjs';
import { createPgStore } from '../../server/store-pg.mjs';
import { seed } from '../../server/seed.mjs';

// DATABASE_URL (Neon / Supabase) makes the function stateless and durable.
const store = process.env.DATABASE_URL
  ? await createPgStore(seed, { url: process.env.DATABASE_URL })
  : createStore(seed);
const api = createApi({ store });

export default async (req) => api.handle(req);

export const config = {
  path: '/api/*',
  method: ['GET', 'POST', 'DELETE', 'OPTIONS'],
};
