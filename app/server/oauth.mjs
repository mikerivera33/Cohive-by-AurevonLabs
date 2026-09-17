/**
 * OAuth for Google / Apple — configuration, authorize URLs, code exchange and
 * identity verification.
 *
 * Hardening rules (README → Identity):
 *  • `exchangeCode` returns a profile only when the provider proves the email
 *    (Google userinfo `email_verified`, Apple id_token `email_verified`), and
 *    always carries the provider's stable `sub`. Callers fail closed on null.
 *  • Apple id_tokens are signature-checked against Apple's JWKS (RS256) with
 *    iss / aud / exp verified; nothing here ever invents an email.
 *  • Apple requires `response_mode=form_post` with name/email scopes, and its
 *    client secret is a short-lived ES256 JWT — minted here from the .p8 key
 *    when no static APPLE_CLIENT_SECRET is set.
 *  • Demo sign-in is a development convenience: off in production unless
 *    COHIVE_ALLOW_DEMO=1.
 */
import { createPrivateKey, createPublicKey, createSign, verify as cryptoVerify } from 'node:crypto';

const APPLE_ISS = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Apple caps client secrets at 6 months; renew well inside that. */
const APPLE_SECRET_TTL_S = 150 * 24 * 60 * 60;
const APPLE_SECRET_RENEW_MS = 24 * 60 * 60 * 1000;

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

export function oauthConfig() {
  const publicBase = (env('COHIVE_PUBLIC_URL') || env('URL') || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const googleId = env('GOOGLE_CLIENT_ID') || env('VITE_GOOGLE_CLIENT_ID');
  const appleId = env('APPLE_CLIENT_ID') || env('VITE_APPLE_CLIENT_ID');
  const apple = {
    configured: Boolean(appleId),
    clientId: appleId,
    clientSecret: env('APPLE_CLIENT_SECRET'),
    teamId: env('APPLE_TEAM_ID'),
    keyId: env('APPLE_KEY_ID'),
    privateKey: env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    redirectUri: `${publicBase}/api/auth/oauth/apple/callback`,
  };
  return {
    publicBase,
    secure: publicBase.startsWith('https://'),
    google: {
      configured: Boolean(googleId),
      clientId: googleId,
      clientSecret: env('GOOGLE_CLIENT_SECRET'),
      redirectUri: `${publicBase}/api/auth/oauth/google/callback`,
    },
    apple,
  };
}

/** Demo sign-in mints unproven sessions — never in production unless explicitly allowed. */
export function demoAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.COHIVE_ALLOW_DEMO === '1';
}

export function providersPayload() {
  const cfg = oauthConfig();
  return {
    google: cfg.google.configured,
    apple: cfg.apple.configured,
    demo: demoAllowed(),
    mode: cfg.google.configured || cfg.apple.configured ? 'oauth' : 'demo',
  };
}

/** Build the browser authorize URL for a configured provider; `state` binds the callback to this browser. */
export function authorizeUrl(provider, state) {
  const cfg = oauthConfig();
  if (provider === 'google') {
    if (!cfg.google.configured) return null;
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', cfg.google.clientId);
    u.searchParams.set('redirect_uri', cfg.google.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('access_type', 'online');
    u.searchParams.set('prompt', 'select_account');
    if (state) u.searchParams.set('state', state);
    return u.toString();
  }
  if (provider === 'apple') {
    if (!cfg.apple.configured) return null;
    const u = new URL('https://appleid.apple.com/auth/authorize');
    u.searchParams.set('client_id', cfg.apple.clientId);
    u.searchParams.set('redirect_uri', cfg.apple.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'name email');
    // Apple only allows the name/email scopes with form_post: the callback is a cross-site POST.
    u.searchParams.set('response_mode', 'form_post');
    if (state) u.searchParams.set('state', state);
    return u.toString();
  }
  return null;
}

/* ── JWT helpers ─────────────────────────────────────────────── */

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const b64urlJson = (o) => b64url(JSON.stringify(o));

/** Split a JWT into header / payload / signature without trusting any of it. */
export function decodeJwt(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!isObj(header) || !isObj(payload)) return null;
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
  } catch {
    return null;
  }
}

/** Payload of `jwt` when its RS256 signature verifies against one of `keys` (a JWKS), else null. */
export function verifyRs256(jwt, keys) {
  const t = decodeJwt(jwt);
  if (!t || t.header.alg !== 'RS256') return null;
  const jwk = (Array.isArray(keys) ? keys : []).find((k) => isObj(k) && k.kty === 'RSA' && k.kid === t.header.kid);
  if (!jwk) return null;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    return cryptoVerify('sha256', Buffer.from(t.signingInput), key, t.signature) ? t.payload : null;
  } catch {
    return null;
  }
}

let jwksCache = { keys: null, at: 0 };
async function appleKeys(fetchImpl) {
  if (jwksCache.keys && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(APPLE_JWKS_URL);
  if (!res.ok) return jwksCache.keys || [];
  const data = await res.json();
  jwksCache = { keys: Array.isArray(data?.keys) ? data.keys : [], at: Date.now() };
  return jwksCache.keys;
}

/**
 * Apple id_token → `{ provider, sub, email, name, verified: true }` or null.
 * The signature must verify against `keys`, iss/aud must match, exp must be
 * in the future and any email must be marked verified. Apple omits the email
 * on some repeat authorisations, so `sub` — not the email — is the identity.
 */
export function appleProfileFromIdToken(idToken, clientId, keys, now = Date.now()) {
  if (!clientId) return null;
  const p = verifyRs256(idToken, keys);
  if (!p || p.iss !== APPLE_ISS) return null;
  if (!(p.aud === clientId || (Array.isArray(p.aud) && p.aud.includes(clientId)))) return null;
  const exp = Number(p.exp);
  if (!Number.isFinite(exp) || exp * 1000 < now - 60_000) return null;
  const sub = String(p.sub || '').trim();
  if (!sub || sub.length > 255) return null;
  const email = String(p.email || '').trim().toLowerCase();
  if (email) {
    const verified = p.email_verified === true || p.email_verified === 'true';
    if (!verified || !email.includes('@') || /\s/.test(email)) return null;
  }
  return { provider: 'apple', sub, email, name: '', verified: true };
}

/** Apple posts a `user` JSON field (with the name) on the first authorisation only. */
export function appleNameFromUserField(raw) {
  try {
    const u = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const n = u?.name;
    return [n?.firstName, n?.lastName]
      .filter((x) => typeof x === 'string' && x.trim())
      .join(' ')
      .trim()
      .slice(0, 64);
  } catch {
    return '';
  }
}

let appleSecretCache = { value: '', exp: 0 };
/**
 * Apple's client secret is an ES256 JWT signed with the Sign in with Apple
 * key. A static APPLE_CLIENT_SECRET wins; otherwise it is minted from
 * APPLE_TEAM_ID + APPLE_KEY_ID + APPLE_PRIVATE_KEY and renewed daily.
 */
export function appleClientSecret(now = Date.now()) {
  const cfg = oauthConfig().apple;
  if (cfg.clientSecret) return cfg.clientSecret;
  if (!(cfg.teamId && cfg.keyId && cfg.privateKey && cfg.clientId)) return '';
  if (appleSecretCache.value && appleSecretCache.exp - now > APPLE_SECRET_RENEW_MS) return appleSecretCache.value;
  const iat = Math.floor(now / 1000);
  const exp = iat + APPLE_SECRET_TTL_S;
  const header = b64urlJson({ alg: 'ES256', kid: cfg.keyId });
  const payload = b64urlJson({ iss: cfg.teamId, iat, exp, aud: APPLE_ISS, sub: cfg.clientId });
  const key = createPrivateKey(cfg.privateKey);
  const sig = createSign('sha256').update(`${header}.${payload}`).sign({ key, dsaEncoding: 'ieee-p1363' });
  appleSecretCache = { value: `${header}.${payload}.${b64url(sig)}`, exp: exp * 1000 };
  return appleSecretCache.value;
}

/**
 * Exchange an authorization code for a verified identity:
 * `{ provider, sub, email, name, verified: true }`, or null. Callers must
 * fail closed — a session is never minted from an unverified profile.
 * `extra.user` is Apple's first-login name field from the form_post body.
 */
export async function exchangeCode(provider, code, extra = {}, fetchImpl = fetch) {
  const cfg = oauthConfig();
  if (!code) return null;
  try {
    if (provider === 'google' && cfg.google.clientSecret) {
      const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.google.clientId,
          client_secret: cfg.google.clientSecret,
          redirect_uri: cfg.google.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return null;
      const tokens = await tokenRes.json();
      if (!tokens.access_token) return null;
      const meRes = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + tokens.access_token },
      });
      if (!meRes.ok) return null;
      const me = await meRes.json();
      const email = String(me.email || '').trim().toLowerCase();
      const sub = String(me.sub || '').trim();
      if (!email || !sub || me.email_verified !== true) return null;
      return { provider: 'google', sub, email, name: String(me.name || me.given_name || '').slice(0, 64), verified: true };
    }

    if (provider === 'apple' && cfg.apple.configured) {
      const secret = appleClientSecret();
      if (!secret) return null;
      const tokenRes = await fetchImpl('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.apple.clientId,
          client_secret: secret,
          redirect_uri: cfg.apple.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return null;
      const tokens = await tokenRes.json();
      const profile = appleProfileFromIdToken(tokens.id_token, cfg.apple.clientId, await appleKeys(fetchImpl));
      return profile ? { ...profile, name: appleNameFromUserField(extra.user) } : null;
    }
  } catch {
    return null;
  }
  return null;
}
