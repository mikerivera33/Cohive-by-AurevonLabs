/**
 * Netlify Function — mounts the same Cohive API under /api/*.
 * In-memory store (ephemeral per isolate). For durable ACL, point at a DB later.
 */
import { createApi } from '../../server/api.mjs';

const api = createApi();

export default async (req) => api.handle(req);

export const config = {
  path: '/api/*',
  method: ['GET', 'POST', 'OPTIONS'],
};
