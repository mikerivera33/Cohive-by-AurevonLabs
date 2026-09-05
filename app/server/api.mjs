/**
 * Cohive HTTP API — auth + server-enforced ACL for trips, members, votes,
 * and rate-limited / sanitized import scanning.
 *
 * Returns a (req, res) handler compatible with node:http, and a fetch-style
 * `handle(Request)` for Netlify Functions.
 */
import { createStore } from './store.mjs';
import { seed } from './seed.mjs';
import { sanitizeImportText } from './sanitize.mjs';
import { takeToken } from './rateLimit.mjs';
import { scanImport as defaultScanImport } from './engine-bundle.mjs';

const SCAN_LIMIT_USER = { limit: 30, windowMs: 60_000 };
const SCAN_LIMIT_IP = { limit: 60, windowMs: 60_000 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(status, body, extraHeaders = {}) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function bearer(reqHeaders) {
  const h = reqHeaders.get?.('authorization') || reqHeaders.authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function clientIp(reqHeaders, fallback = '0.0.0.0') {
  const xf = reqHeaders.get?.('x-forwarded-for') || reqHeaders['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return fallback;
}

/**
 * @param {{ scanImport?: Function, store?: ReturnType<typeof createStore> }} [deps]
 */
export function createApi(deps = {}) {
  const store = deps.store || createStore(seed);
  const scanImportFn = deps.scanImport || defaultScanImport;

  async function dispatch(method, pathname, headers, bodyText, ip) {
    if (method === 'OPTIONS') {
      return { status: 204, headers: { ...CORS }, body: '' };
    }

    const path = pathname.replace(/\/+$/, '') || '/';
    let body = {};
    if (bodyText && method !== 'GET' && method !== 'HEAD') {
      try {
        body = JSON.parse(bodyText);
      } catch {
        return json(400, { error: 'invalid_json' });
      }
    }

    const token = bearer(headers);
    const user = store.getSessionUser(token);

    // ── Auth ──────────────────────────────────────────────────
    if (method === 'POST' && path === '/api/auth/register') {
      const result = store.register(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result);
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const result = store.login(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result);
    }
    if (method === 'POST' && path === '/api/auth/demo') {
      const result = store.demoAuth(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result);
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      store.logout(token);
      return json(200, { ok: true });
    }
    if (method === 'GET' && path === '/api/auth/me') {
      if (!user) return json(401, { error: 'unauthorized' });
      return json(200, { user: store.publicUser(user) });
    }

    // ── Health ────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/health') {
      return json(200, { ok: true, service: 'cohive-api' });
    }

    // Everything below requires auth.
    if (!user && path.startsWith('/api/')) {
      // Allow health only (handled above).
      if (path !== '/api/health') return json(401, { error: 'unauthorized' });
    }

    if (method === 'GET' && path === '/api/trips') {
      return json(200, { trips: store.listTripsForUser(user.id) });
    }

    if (method === 'POST' && path === '/api/trips') {
      const result = store.createTrip(user.id, body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result);
    }

    const tripMatch = path.match(/^\/api\/trips\/([^/]+)(.*)$/);
    if (tripMatch) {
      const tripId = decodeURIComponent(tripMatch[1]);
      const rest = tripMatch[2] || '';

      if (method === 'GET' && rest === '') {
        const result = store.getTrip(tripId, user.id);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, result);
      }

      if (method === 'POST' && rest === '/votes') {
        const result = store.castVote(tripId, user.id, body.spotId, body.tier ?? null);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, result);
      }

      if (method === 'GET' && rest === '/members') {
        const result = store.getTrip(tripId, user.id);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, { members: result.members });
      }

      if (method === 'POST' && rest === '/members') {
        const result = store.addMember(tripId, user.id, body.name);
        if (result.error) return json(result.status, { error: result.error });
        return json(201, result);
      }

      if (method === 'POST' && rest === '/spots') {
        const result = store.addSpot(tripId, user.id, body.candidate, body.source);
        if (result.error) return json(result.status, { error: result.error });
        return json(201, result);
      }

      if (method === 'POST' && rest === '/scan') {
        const denied = store.requireMember(tripId, user.id);
        if (denied) return json(denied.status, { error: denied.error });

        const userKey = `scan:user:${user.id}`;
        const ipKey = `scan:ip:${ip}`;
        const userLim = takeToken(userKey, SCAN_LIMIT_USER);
        if (!userLim.ok) {
          return json(
            429,
            { error: 'rate_limited', scope: 'account', retryAfterSec: userLim.retryAfterSec },
            { 'Retry-After': String(userLim.retryAfterSec) }
          );
        }
        const ipLim = takeToken(ipKey, SCAN_LIMIT_IP);
        if (!ipLim.ok) {
          return json(
            429,
            { error: 'rate_limited', scope: 'ip', retryAfterSec: ipLim.retryAfterSec },
            { 'Retry-After': String(ipLim.retryAfterSec) }
          );
        }

        const cleaned = sanitizeImportText(body.text);
        if (!cleaned) return json(400, { error: 'empty_text' });

        const tripBundle = store.getTrip(tripId, user.id);
        if (tripBundle.error) return json(tripBundle.status, { error: tripBundle.error });
        const trip = tripBundle.trip;

        try {
          const result = scanImportFn(cleaned, {
            city: trip.city,
            lat: trip.lat,
            lng: trip.lng,
          });
          // Candidates are derived from sanitized text only — never echo raw paste.
          return json(200, {
            source: result.source,
            candidates: result.candidates,
            sanitizedLength: cleaned.length,
          });
        } catch (e) {
          return json(500, { error: 'scan_failed', message: String(e?.message || e) });
        }
      }
    }

    return json(404, { error: 'not_found' });
  }

  /** Fetch-style entry (Netlify Functions / tests). */
  async function handle(request) {
    const url = new URL(request.url);
    const headers = request.headers;
    const bodyText =
      request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    const ip = clientIp(headers);
    const result = await dispatch(request.method, url.pathname, headers, bodyText, ip);
    return new Response(result.body, { status: result.status, headers: result.headers });
  }

  /** node:http entry. */
  async function nodeHandler(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (!url.pathname.startsWith('/api')) {
        res.writeHead(404);
        res.end();
        return false;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const headers = {
        get: (k) => req.headers[k.toLowerCase()],
        authorization: req.headers.authorization,
        'x-forwarded-for': req.headers['x-forwarded-for'],
      };
      const ip = clientIp(headers, req.socket?.remoteAddress || '0.0.0.0');
      const result = await dispatch(req.method || 'GET', url.pathname, headers, bodyText, ip);
      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return true;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error', message: String(e?.message || e) }));
      return true;
    }
  }

  return { handle, nodeHandler, store };
}
