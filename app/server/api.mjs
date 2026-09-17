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
import {
  appleNameFromUserField,
  authorizeUrl,
  demoAllowed,
  exchangeCode as defaultExchangeCode,
  oauthConfig,
  providersPayload,
} from './oauth.mjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { mailConfigured, sendMagicLink } from './mail.mjs';

const SCAN_LIMIT_USER = { limit: 30, windowMs: 60_000 };
const SCAN_LIMIT_IP = { limit: 60, windowMs: 60_000 };
const AUTH_LIMIT_IP = { limit: 20, windowMs: 60_000 };

const CORS_ORIGIN = process.env.COHIVE_CORS_ORIGIN || '*';

const CORS = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  // Cookies only ride along when the origin is pinned — never with '*'.
  ...(CORS_ORIGIN !== '*' ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
};

const SESSION_COOKIE = 'cohive_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
/** Binds an OAuth callback to the browser that started it (login CSRF). */
const OAUTH_STATE_COOKIE = 'cohive_oauth_state';
const OAUTH_STATE_MAX_AGE = 10 * 60;
/** Carries a fresh session from a redirect landing to the SPA — never the URL. */
const HANDOFF_COOKIE = 'cohive_handoff';
const HANDOFF_PATH = '/api/auth/oauth/complete';
const HANDOFF_MAX_AGE = 120;

/** HttpOnly session cookie for the web app; native clients keep using Bearer. */
function sessionCookie(token) {
  const secure = /^https:/.test(oauthConfig().publicBase) ? '; Secure' : '';
  return token
    ? `${SESSION_COOKIE}=${token}; Path=/api; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`
    : `${SESSION_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

function cookieValue(reqHeaders, name) {
  const raw = String(reqHeaders.get?.('cookie') || reqHeaders.cookie || '');
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? m[1].trim() : '';
}

function cookieToken(reqHeaders) {
  const v = cookieValue(reqHeaders, SESSION_COOKIE);
  return /^[a-f0-9]{48}$/.test(v) ? v : '';
}

/** HttpOnly cookie scoped to one path. `sameSite` None is only valid over https (Apple's form_post callback needs it). */
function scopedCookie(name, value, { path, maxAge, sameSite = 'Lax' }) {
  const secure = oauthConfig().secure;
  const site = sameSite === 'None' && !secure ? 'Lax' : sameSite;
  return `${name}=${value}; Path=${path}; Max-Age=${value ? maxAge : 0}; HttpOnly; SameSite=${site}${secure ? '; Secure' : ''}`;
}
const stateCookie = (v) => scopedCookie(OAUTH_STATE_COOKIE, v, { path: '/api/auth/oauth', maxAge: OAUTH_STATE_MAX_AGE, sameSite: 'None' });
const handoffCookie = (v) => scopedCookie(HANDOFF_COOKIE, v, { path: HANDOFF_PATH, maxAge: HANDOFF_MAX_AGE });

function equalSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/** Attach one or more Set-Cookie headers to a result. */
function withCookies(result, cookies) {
  return { ...result, headers: { ...result.headers, 'Set-Cookie': cookies } };
}

/** Result headers → fetch Headers (arrays become repeated Set-Cookie lines). */
function toFetchHeaders(resultHeaders) {
  const out = new Headers();
  for (const [k, v] of Object.entries(resultHeaders || {})) {
    if (Array.isArray(v)) for (const item of v) out.append(k, item);
    else if (v != null && v !== '') out.set(k, String(v));
  }
  return out;
}

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

/** Where an invite lands: the web app, which stores the code and accepts it after sign-in. */
function inviteUrl(code) {
  return code ? `${oauthConfig().publicBase}/?invite=${encodeURIComponent(code)}` : null;
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
  const exchangeCode = deps.exchangeCode || defaultExchangeCode;

  /** Which hive a request touches, so its change counter can be bumped / stamped. */
  async function hiveOfPath(path, method, parsed) {
    let m = path.match(/^\/api\/hives\/([^/]+)/);
    if (m) return decodeURIComponent(m[1]);
    m = path.match(/^\/api\/trips\/([^/]+)/);
    if (m) return (await store.hiveOfTrip(decodeURIComponent(m[1]))) || null;
    if (method === 'POST' && (path === '/api/trips' || /^\/api\/invites\/[^/]+\/accept$/.test(path))) {
      return parsed?.trip?.hiveId || parsed?.hiveId || parsed?.invite?.hiveId || null;
    }
    return null;
  }

  /**
   * Route, then keep the hive's change counter in sync: every successful
   * mutation bumps it, and every successful hive/trip response carries
   * `sync: { hiveId, version }` so clients know what they have already seen.
   */
  async function dispatch(method, pathname, headers, bodyText, ip, search = '') {
    const res = await route(method, pathname, headers, bodyText, ip, search);
    if (res.status >= 300 || !res.body || method === 'OPTIONS') return res;
    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      return res;
    }
    if (!parsed || typeof parsed !== 'object') return res;
    const path = pathname.replace(/\/+$/, '') || '/';
    const hiveId = await hiveOfPath(path, method, parsed);
    if (!hiveId) return res;
    const sync = method === 'GET' ? await store.peekHiveVersion(hiveId) : await store.bumpHive(hiveId);
    if (!sync || sync.error) return res;
    return { ...res, body: JSON.stringify({ ...parsed, sync: { hiveId: String(hiveId), version: sync.version } }) };
  }

  async function route(method, pathname, headers, bodyText, ip, search = '') {
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

    const token = bearer(headers) || cookieToken(headers);
    const user = await store.getSessionUser(token);

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
      const result = await store.register(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result, { 'Set-Cookie': sessionCookie(result.token) });
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const result = await store.login(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result, { 'Set-Cookie': sessionCookie(result.token) });
    }
    if (method === 'POST' && path === '/api/auth/demo') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      if (!demoAllowed()) return json(403, { error: 'demo_disabled' });
      const result = await store.demoAuth(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result, { 'Set-Cookie': sessionCookie(result.token) });
    }

    // ── Magic links (passwordless email) ──────────────────────
    if (method === 'POST' && path === '/api/auth/magic') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const result = await store.requestMagicLink(body);
      if (result.error) return json(result.status, { error: result.error });
      const link = `${oauthConfig().publicBase}/api/auth/magic/verify?token=${result.token}`;
      if (mailConfigured()) {
        try {
          await sendMagicLink({ to: result.email, link });
        } catch {
          return json(502, { error: 'mail_failed' });
        }
        return json(200, { ok: true, email: result.email, sent: true });
      }
      if (process.env.NODE_ENV === 'production') return json(503, { error: 'mail_not_configured' });
      // Local / preview: hand the link back so the flow stays testable end to end.
      return json(200, { ok: true, email: result.email, sent: false, devLink: link });
    }
    if (method === 'GET' && path === '/api/auth/magic/verify') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const base = oauthConfig().publicBase;
      const result = await store.consumeMagicLink(String(query.get('token') || ''));
      if (result.error) return redirect(`${base}/?start=onboarding&auth_error=${encodeURIComponent(result.error)}`);
      // The session rides in HttpOnly cookies only — never the landing URL (logs, history, Referer).
      return withCookies(redirect(`${base}/?start=onboarding&authed=1&mode=magic`), [sessionCookie(result.token), handoffCookie(result.token)]);
    }
    if (method === 'POST' && path === '/api/auth/magic/verify') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const result = await store.consumeMagicLink(String(body.token || ''));
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result, { 'Set-Cookie': sessionCookie(result.token) });
    }
    if (method === 'GET' && path === '/api/auth/providers') {
      return json(200, providersPayload());
    }
    const oauthStart = path.match(/^\/api\/auth\/oauth\/(google|apple)$/);
    if (method === 'GET' && oauthStart) {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const state = randomBytes(16).toString('hex');
      const url = authorizeUrl(oauthStart[1], state);
      if (!url) return json(501, { error: 'oauth_not_configured', provider: oauthStart[1], demo: demoAllowed() });
      return withCookies(redirect(url), [stateCookie(state)]);
    }
    const oauthCallback = path.match(/^\/api\/auth\/oauth\/(google|apple)\/callback$/);
    if ((method === 'GET' || method === 'POST') && oauthCallback) {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const provider = oauthCallback[1];
      const base = oauthConfig().publicBase;
      const fail = (reason) => withCookies(redirect(`${base}/?start=onboarding&auth_error=${reason}`), [stateCookie('')]);
      // Fail closed: the callback must carry the state this browser started with, a code, and a
      // verified identity. Nothing else mints a session.
      const presented = String(body.state || query.get('state') || '').trim();
      if (!equalSecret(cookieValue(headers, OAUTH_STATE_COOKIE), presented)) return fail('oauth_denied');
      const code = String(body.code || query.get('code') || '').trim();
      if (!code) return fail('oauth_failed');
      const profile = await exchangeCode(provider, code, { user: body.user });
      if (!profile?.verified || !profile.sub) return fail('oauth_failed');
      const result = await store.oauthUpsert({ ...profile, name: profile.name || appleNameFromUserField(body.user) });
      if (result.error) return fail(result.error);
      return withCookies(redirect(`${base}/?start=onboarding&authed=1&mode=oauth`), [
        stateCookie(''),
        sessionCookie(result.token),
        handoffCookie(result.token),
      ]);
    }
    if (method === 'POST' && path === HANDOFF_PATH) {
      // Single use: the SPA trades the short-lived handoff cookie for its Bearer token.
      const limited = rateLimitAuth();
      if (limited) return limited;
      const handoff = cookieValue(headers, HANDOFF_COOKIE);
      const sessionUser = /^[a-f0-9]{48}$/.test(handoff) ? await store.getSessionUser(handoff) : null;
      if (!sessionUser) return withCookies(json(401, { error: 'unauthorized' }), [handoffCookie('')]);
      return withCookies(json(200, { user: store.publicUser(sessionUser), token: handoff }), [handoffCookie('')]);
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      await store.logout(token);
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('') });
    }
    if (method === 'DELETE' && path === '/api/auth/me') {
      if (!user) return json(401, { error: 'unauthorized' });
      const result = await store.deleteAccount(user.id);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('') });
    }

    // Invite preview is public: it renders "Maya invited you to Tokyo" before sign-in.
    const invitePreview = path.match(/^\/api\/invites\/([^/]+)$/);
    if (method === 'GET' && invitePreview) {
      const result = await store.getInvite(decodeURIComponent(invitePreview[1]));
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result);
    }
    if (method === 'GET' && path === '/api/auth/me') {
      if (!user) return json(401, { error: 'unauthorized' });
      return json(200, await store.meProfile(user));
    }
    if (method === 'POST' && path === '/api/auth/me/profile') {
      if (!user) return json(401, { error: 'unauthorized' });
      const result = await store.updateProfile(user.id, body);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result);
    }

    // ── Billing: normalised events from RevenueCat / Stripe / App Store adapters ──
    if (method === 'POST' && path === '/api/billing/webhook') {
      const limited = rateLimitAuth();
      if (limited) return limited;
      const secret = process.env.COHIVE_BILLING_SECRET || '';
      if (!secret) return json(503, { error: 'billing_not_configured' });
      const given = String(headers.get?.('x-cohive-signature') || headers['x-cohive-signature'] || '');
      const want = createHmac('sha256', secret).update(bodyText || '').digest('hex');
      const a = Buffer.from(given, 'utf8');
      const b = Buffer.from(want, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) return json(401, { error: 'bad_signature' });
      const result = await store.applyEntitlement(body);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result);
    }
    // Demo purchases mirror the pricing sheet server-side — never in production.
    if (method === 'POST' && path === '/api/billing/demo-purchase') {
      if (!user) return json(401, { error: 'unauthorized' });
      if (process.env.NODE_ENV === 'production') return json(403, { error: 'billing_not_configured' });
      const result = await store.demoPurchase(user.id, body.tier);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result);
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
      return json(200, { trips: await store.listTripsForUser(user.id) });
    }

    // ── Hives: the membership unit (trips, Nest and Table live inside) ──
    if (method === 'GET' && path === '/api/hives') {
      return json(200, { hives: await store.listHivesForUser(user.id) });
    }
    if (method === 'POST' && path === '/api/hives') {
      const result = await store.createHive(user.id, body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result);
    }
    const hiveMatch = path.match(/^\/api\/hives\/([^/]+)(.*)$/);
    if (hiveMatch) {
      const hiveId = decodeURIComponent(hiveMatch[1]);
      const rest = hiveMatch[2] || '';
      const send = (status, result, extra) =>
        result.error ? json(result.status, { error: result.error }) : json(status, extra ? { ...result, ...extra } : result);

      if (method === 'GET' && rest === '') return send(200, await store.getHive(hiveId, user.id));
      if (method === 'GET' && rest === '/version') return send(200, await store.hiveVersion(hiveId, user.id));
      if (method === 'POST' && rest === '/trips') return send(201, await store.createTrip(user.id, { ...body, hiveId }));
      if (method === 'POST' && rest === '/members') {
        const result = await store.addMember(hiveId, user.id, body.name);
        return send(201, result, result.error ? undefined : { url: inviteUrl(result.invite?.code) });
      }
      if (method === 'POST' && rest === '/invites') {
        const result = await store.createInvite(hiveId, user.id, body);
        return send(201, result, result.error ? undefined : { url: inviteUrl(result.invite.code) });
      }
      if (method === 'POST' && rest === '/nest') return send(201, await store.addListing(hiveId, user.id, body));
      const react = rest.match(/^\/nest\/(\d+)\/react$/);
      if (method === 'POST' && react) return send(200, await store.toggleReaction(hiveId, user.id, react[1], body.emoji));
      if (method === 'POST' && rest === '/table') return send(201, await store.addRestaurant(hiveId, user.id, body));
      const dish = rest.match(/^\/table\/(\d+)$/);
      if (method === 'POST' && dish) return send(200, await store.updateRestaurant(hiveId, user.id, dish[1], body));
      return json(404, { error: 'not_found' });
    }

    if (method === 'POST' && path === '/api/trips') {
      const result = await store.createTrip(user.id, body);
      if (result.error) return json(result.status, { error: result.error });
      return json(201, result);
    }

    const inviteAccept = path.match(/^\/api\/invites\/([^/]+)\/accept$/);
    if (method === 'POST' && inviteAccept) {
      const result = await store.acceptInvite(decodeURIComponent(inviteAccept[1]), user.id);
      if (result.error) return json(result.status, { error: result.error });
      return json(200, result);
    }

    const tripMatch = path.match(/^\/api\/trips\/([^/]+)(.*)$/);
    if (tripMatch) {
      const tripId = decodeURIComponent(tripMatch[1]);
      const rest = tripMatch[2] || '';

      if (method === 'GET' && rest === '') {
        const result = await store.getTrip(tripId, user.id);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, result);
      }

      if (method === 'POST' && rest === '/votes') {
        const result = await store.castVote(tripId, user.id, body.spotId, body.tier ?? null);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, result);
      }

      if (method === 'GET' && rest === '/members') {
        const result = await store.getTrip(tripId, user.id);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, { members: result.members });
      }

      // Members and invites belong to the trip's hive; these paths stay as aliases.
      if (method === 'POST' && (rest === '/members' || rest === '/invites')) {
        const hiveId = await store.hiveOfTrip(tripId);
        if (!hiveId) return json(404, { error: 'trip_not_found' });
        const result =
          rest === '/members'
            ? await store.addMember(hiveId, user.id, body.name)
            : await store.createInvite(hiveId, user.id, body);
        if (result.error) return json(result.status, { error: result.error });
        return json(201, { ...result, url: inviteUrl(result.invite?.code) });
      }

      // Money — the store only ever moves the session user's own funds.
      if (method === 'GET' && rest === '/fund') {
        const result = await store.getFund(tripId, user.id);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, result);
      }

      if (method === 'POST' && rest === '/fund/contributions') {
        const result = await store.contribute(tripId, user.id, body.amount);
        if (result.error) return json(result.status, { error: result.error });
        return json(201, result);
      }

      if (method === 'POST' && rest === '/fund/withdrawals') {
        const result = await store.withdraw(tripId, user.id, body.amount);
        if (result.error) {
          return json(result.status, { error: result.error, withdrawable: result.withdrawable });
        }
        return json(201, result);
      }

      const voidMatch = rest.match(/^\/expenses\/(\d+)\/void$/);
      if (method === 'POST' && voidMatch) {
        const result = await store.voidExpense(tripId, user.id, voidMatch[1]);
        if (result.error) return json(result.status, { error: result.error });
        return json(200, result);
      }

      if (method === 'POST' && rest === '/expenses') {
        const result = await store.addExpense(tripId, user.id, body);
        if (result.error) {
          return json(result.status, { error: result.error, shortfalls: result.shortfalls });
        }
        return json(201, result);
      }

      if (method === 'POST' && rest === '/spots') {
        const result = await store.addSpot(tripId, user.id, body.candidate, body.source);
        if (result.error) return json(result.status, { error: result.error });
        return json(201, result);
      }

      if (method === 'POST' && rest === '/scan') {
        const denied = await store.requireMember(tripId, user.id);
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

        const tripBundle = await store.getTrip(tripId, user.id);
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
    return new Response(result.body, { status: result.status, headers: toFetchHeaders(result.headers) });
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
