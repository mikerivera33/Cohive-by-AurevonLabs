/**
 * OAuth provider config for Google / Apple.
 * Real authorize URLs when CLIENT_ID env vars are set; otherwise the API
 * reports demo mode and the client uses /api/auth/demo.
 */

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

export function oauthConfig() {
  const publicBase = env('COHIVE_PUBLIC_URL') || env('URL') || 'http://127.0.0.1:8080';
  const googleId = env('GOOGLE_CLIENT_ID') || env('VITE_GOOGLE_CLIENT_ID');
  const googleSecret = env('GOOGLE_CLIENT_SECRET');
  const appleId = env('APPLE_CLIENT_ID') || env('VITE_APPLE_CLIENT_ID');
  const appleSecret = env('APPLE_CLIENT_SECRET');

  return {
    publicBase: publicBase.replace(/\/+$/, ''),
    google: {
      configured: Boolean(googleId),
      clientId: googleId,
      clientSecret: googleSecret,
      redirectUri: `${publicBase.replace(/\/+$/, '')}/api/auth/oauth/google/callback`,
    },
    apple: {
      configured: Boolean(appleId),
      clientId: appleId,
      clientSecret: appleSecret,
      redirectUri: `${publicBase.replace(/\/+$/, '')}/api/auth/oauth/apple/callback`,
    },
  };
}

export function providersPayload() {
  const cfg = oauthConfig();
  return {
    google: cfg.google.configured,
    apple: cfg.apple.configured,
    mode: cfg.google.configured || cfg.apple.configured ? 'oauth' : 'demo',
  };
}

/** Build the browser authorize URL for a configured provider. */
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
    u.searchParams.set('response_mode', 'query');
    if (state) u.searchParams.set('state', state);
    return u.toString();
  }
  return null;
}

/**
 * Decode a JWT payload without verifying the signature. Callers must only pass
 * tokens that arrived over TLS from the provider's token endpoint.
 * @returns {Record<string, unknown> | null}
 */
export function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Map an Apple `id_token` to a Cohive profile. Apple's token response has no
 * top-level `email` — the address lives in the id_token. Inventing
 * `apple-${Date.now()}@…` minted a new account on every Sign in with Apple.
 *
 * @param {unknown} idToken
 * @param {string} clientId
 * @returns {{ email: string, name: string, provider: 'apple', verified: true } | null}
 */
export function appleProfileFromIdToken(idToken, clientId) {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return null;
  if (payload.iss !== 'https://appleid.apple.com') return null;
  const aud = payload.aud;
  const audOk = aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
  if (!clientId || !audOk) return null;
  const exp = Number(payload.exp);
  if (Number.isFinite(exp) && exp * 1000 < Date.now() - 60_000) return null;
  const sub = String(payload.sub || '').trim();
  if (!sub || sub.length > 255) return null;

  const email = String(payload.email || '').trim().toLowerCase();
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (email) {
    if (!email.includes('@') || /\s/.test(email) || !emailVerified) return null;
    return { email, name: 'You', provider: 'apple', verified: true };
  }

  // Later Sign Ins may omit email; `sub` is Apple's stable user id.
  const safe = sub.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  if (!safe) return null;
  return { email: `apple-${safe}@cohive.local`, name: 'You', provider: 'apple', verified: true };
}

/**
 * Best-effort code exchange. Returns profile fields when secrets exist and
 * the provider responds; otherwise null (caller may mint a provisional session).
 */
export async function exchangeCode(provider, code) {
  const cfg = oauthConfig();
  if (!code) return null;

  try {
    if (provider === 'google' && cfg.google.clientSecret) {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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
      const access = tokens.access_token;
      if (!access) return null;
      const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + access },
      });
      if (!meRes.ok) return null;
      const me = await meRes.json();
      return {
        email: String(me.email || ''),
        name: String(me.name || me.given_name || 'You'),
        provider: 'google',
        verified: true,
      };
    }

    if (provider === 'apple' && cfg.apple.clientSecret) {
      const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.apple.clientId,
          client_secret: cfg.apple.clientSecret,
          redirect_uri: cfg.apple.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return null;
      const tokens = await tokenRes.json();
      return appleProfileFromIdToken(tokens.id_token, cfg.apple.clientId);
    }
  } catch {
    return null;
  }
  return null;
}
