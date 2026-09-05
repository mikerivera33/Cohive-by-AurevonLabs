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
import { MAX_JSON_BODY_BYTES, parseJsonBody } from './safeJson.mjs';
import { scanImport as defaultScanImport } from './engine-bundle.mjs';
import { authorizeUrl, exchangeCode, oauthConfig, providersPayload } from './oauth.mjs';

const SCAN_LIMIT_USER = { limit: 30, windowMs: 60_000 };
const SCAN_LIMIT_IP = { limit: 60, windowMs: 60_000 };
const AUTH_LIMIT_IP = { limit: 20, windowMs: 60_000 };

const CORS_ORIGIN = process.env.COHIVE_CORS_ORIGIN || '*';

const CORS = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
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

function redirect(location, extraHeaders = {}) {
  return {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      ...CORS,
      ...extraHeaders,
    },
    body: '',
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

  async function dispatch(method, pathname, headers, bodyText, ip, search = '') {
    if (method === 'OPTIONS') {
      return { status: 204, headers: { ...CORS }, body: '' };
    }

    const path = pathname.replace(/\/+$/, '') || '/';
    const query = new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : '');
    let body = {};
    if (bodyText && method !== 'GET' && method !== 'HEAD') {
      const ct = String(headers.get?.('content-type') || headers['content-type'] || '');
      if (ct.includes('application/x-www-form-urlencoded')) {
        const form = new URLSearchParams(bodyText);
        body = Object.fromEntries(form.entries());
      } else {
        const parsed = parseJsonBody(bodyText);
        if (!parsed.ok) {
          return json(parsed.error === 'body_too_large' ? 413 : 400, { error: parsed.error });
        }
        body = parsed.value;
      }
    }

    const token = bearer(headers);
    const user = store.getSessionUser(token);

    function rateLimitAuth() {
      const lim = takeToken(`auth:ip:${ip}`, AUTH_LIMIT_IP);
      if (!lim.ok) {
        return json(
          429,
          { error: 'rate_limited', scope: 'ip', retryAfterSec: lim.retryAfterSec },
          { 'Retry-After': String(lim.retryAfterSec) }
        );
      }
      return null;
    }

    // ── Auth ──────────────────────────────────────────────────
    if (method === 'POST' && path === '/api/auth/register') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const result = store.register(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result);
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const result = store.login(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result);
    }
    if (method === 'POST' && path === '/api/auth/demo') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const result = store.demoAuth(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result);
    }
    if (method === 'GET' && path === '/api/auth/providers') {
      return json(200, providersPayload());
    }
    if (method === 'GET' && path === '/api/auth/oauth/google') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const url = authorizeUrl('google', 'cohive');
      if (!url) return json(501, { error: 'oauth_not_configured', provider: 'google', demo: true });
      return redirect(url);
    }
    if (method === 'GET' && path === '/api/auth/oauth/apple') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const url = authorizeUrl('apple', 'cohive');
      if (!url) return json(501, { error: 'oauth_not_configured', provider: 'apple', demo: true });
      return redirect(url);
    }
    if (
      (method === 'GET' || method === 'POST') &&
      (path === '/api/auth/oauth/google/callback' || path === '/api/auth/oauth/apple/callback')
    ) {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const provider = path.includes('/apple/') ? 'apple' : 'google';
      const cfg = oauthConfig();
      const code = String(body.code || query.get('code') || '').trim();
      const appHome = `${cfg.publicBase}/?start=onboarding&authed=1`;
      const profile = await exchangeCode(provider, code);
      const result = profile
        ? store.oauthUpsert(profile)
        : store.oauthUpsert({
            provider,
            email: '',
            name: 'You',
            verified: false,
          });
      const dest = `${appHome}&token=${encodeURIComponent(result.token)}&mode=${encodeURIComponent(result.mode)}`;
      return redirect(dest);
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
    const result = await dispatch(
      request.method,
      url.pathname,
      headers,
      bodyText,
      ip,
      url.search
    );
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
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_JSON_BODY_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: 'body_too_large' }));
          return true;
        }
        chunks.push(c);
      }
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const headers = {
        get: (k) => req.headers[k.toLowerCase()],
        authorization: req.headers.authorization,
        'content-type': req.headers['content-type'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
      };
      const ip = clientIp(headers, req.socket?.remoteAddress || '0.0.0.0');
      const result = await dispatch(
        req.method || 'GET',
        url.pathname,
        headers,
        bodyText,
        ip,
        url.search
      );
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
