/**
 * Netlify Function — mounts the same Cohive API under /api/*.
 * Memory-only store per isolate (set COHIVE_DATA_FILE only with a writable
 * volume; prefer a real DB/Blobs adapter for multi-instance durability).
 */
import { createApi } from '../../server/api.mjs';

const api = createApi();

export default async (req) => api.handle(req);

export const config = {
  path: '/api/*',
  method: ['GET', 'POST', 'OPTIONS'],
};
