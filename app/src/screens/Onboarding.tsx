import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import { apiAuthProviders, oauthStartPath, type AuthProviders } from '../lib/api';
import { chipStyle, memberDot, press } from '../lib/styles';
import { useApp } from '../store/AppStore';

type Step = 'gateway' | 'contact' | 'intro' | 'hive' | 'invite';
type AuthProvider = 'apple' | 'google' | 'email' | 'phone';

const SLIDES = [
  {
    kicker: 'Capture',
    title: 'Every idea,\nkept.',
    body: 'Reels, listings, that bar your cousin swears by — drop a link and your hive files it under trips, homes, or dinners. Nothing dies in the group chat.',
  },
  {
    kicker: 'Vote',
    title: 'Decide without\na debate.',
    body: 'Vote in tiers — must, maybe, if there’s time. The shortlist writes itself; no one has to play chair.',
  },
  {
    kicker: 'Book',
    title: 'From shortlist\nto booked.',
    body: 'Your concierge engine drafts the day-by-day plan with real clock times, then books the winners in a tap.',
  },
];

const HIVE_KINDS = ['Trip · Bucketlist', 'Home · Nest', 'Dinners · Table'];

const PANE: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: '40px 28px',
  position: 'relative',
  zIndex: 2,
  animation: 'cvrise .5s var(--ease-out) both',
};

const KICKER: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '.24em',
  textTransform: 'uppercase',
  color: 'var(--honey)',
};

const CTA: CSSProperties = {
  borderRadius: 999,
  padding: '16px 22px',
  fontSize: 13.5,
};

function looksLikeEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function looksLikePhone(v: string) {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/** Soft drifting hex accents behind onboarding panes. */
function HexField() {
  const hexes = useMemo(
    () =>
      [0, 1, 2, 3, 4, 5].map((i) => ({
        key: i,
        style: {
          position: 'absolute' as const,
          width: 46 + i * 22,
          height: 46 + i * 22,
          opacity: 0.05 + (i % 3) * 0.035,
          background: 'var(--grad)',
          left: ['72%', '8%', '82%', '-6%', '55%', '20%'][i],
          top: ['6%', '14%', '52%', '66%', '82%', '40%'][i],
          animation: `cvfloat ${5 + i * 1.4}s ease-in-out ${i * 0.6}s infinite`,
        },
      })),
    []
  );
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {hexes.map((h) => (
        <div key={h.key} className="hex" style={h.style} />
      ))}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#EA4335"
        d="M9 7.2v3.5h4.9c-.2 1.2-1.5 3.5-4.9 3.5A5.4 5.4 0 1 1 9 3.6c1.5 0 2.6.7 3.2 1.2l2.2-2.1A8.3 8.3 0 1 0 9 17.3c4.8 0 8-3.4 8-8.1 0-.5 0-.9-.1-1.3H9z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden>
      <path
        fill="currentColor"
        d="M12.7 9.4c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.8-.7C4 4.6 2.4 5.7 1.4 7.5c-1.9 3.3-.5 8.2 1.4 10.9.9 1.3 2 2.8 3.4 2.7 1.4 0 1.9-.9 3.5-.9s2.1.9 3.5.8c1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.4-3 1.4-3.1-.1 0-2.7-1-2.7-4.2zM10.6 3.2c.7-.9 1.2-2.1 1.1-3.3-1 .1-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.2.1 2.3-.6 3-1.5z"
      />
    </svg>
  );
}

export function Onboarding() {
  const { finishOnboarding, authenticate, acceptAuthToken } = useApp();
  const [step, setStep] = useState<Step>('gateway');
  const [slide, setSlide] = useState(0);
  const [hiveName, setHiveName] = useState('');
  const [hiveKind, setHiveKind] = useState(HIVE_KINDS[0]);
  const [invitees, setInvitees] = useState([
    { name: 'Maya', color: '#A78BFA' },
    { name: 'Ben', color: '#34D399' },
  ]);
  const [newInvite, setNewInvite] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [contact, setContact] = useState('');
  const [contactError, setContactError] = useState('');
  const [providers, setProviders] = useState<AuthProviders>({
    google: false,
    apple: false,
    mode: 'demo',
  });
  const [authModeNote, setAuthModeNote] = useState<'demo' | 'oauth' | 'oauth_provisional'>('demo');

  const sl = SLIDES[slide] || SLIDES[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await apiAuthProviders();
      if (!cancelled) setProviders(p);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // OAuth callback lands with ?token=&authed=1 — accept session and advance.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const authed = params.get('authed');
    const mode = params.get('mode');
    if (!token && authed !== '1') return;
    let cancelled = false;
    (async () => {
      if (token) await acceptAuthToken(token);
      if (cancelled) return;
      if (mode === 'oauth' || mode === 'oauth_provisional') {
        setAuthModeNote(mode);
      } else if (providers.mode === 'oauth') {
        setAuthModeNote('oauth');
      }
      setStep('intro');
      params.delete('token');
      params.delete('authed');
      params.delete('mode');
      const next = params.toString();
      const clean = window.location.pathname + (next ? '?' + next : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
    })();
    return () => {
      cancelled = true;
    };
  }, [acceptAuthToken, providers.mode]);

  const continueDemo = async (provider: AuthProvider, opts?: { contact?: string }) => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await authenticate(provider, opts);
      setAuthModeNote('demo');
      setStep('intro');
    } finally {
      setAuthBusy(false);
    }
  };

  const continueWithSocial = async (provider: 'apple' | 'google') => {
    if (authBusy) return;
    const enabled = provider === 'google' ? providers.google : providers.apple;
    if (enabled) {
      setAuthBusy(true);
      window.location.assign(oauthStartPath(provider));
      return;
    }
    await continueDemo(provider);
  };

  const submitContact = async () => {
    const raw = contact.trim();
    if (!raw) {
      setContactError('Enter an email or phone number to continue.');
      return;
    }
    const asEmail = looksLikeEmail(raw);
    const asPhone = looksLikePhone(raw);
    if (!asEmail && !asPhone) {
      setContactError('Use a valid email address or phone number.');
      return;
    }
    setContactError('');
    await continueDemo(asEmail ? 'email' : 'phone', { contact: raw });
  };

  const addInvite = () => {
    const n = newInvite.trim();
    if (!n) return;
    setInvitees((prev) => [...prev, { name: n, color: '#60A5FA' }]);
    setNewInvite('');
  };

  return (
    <main
      aria-label="Welcome to Cohive"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <HexField />

      {step === 'gateway' && (
        <div className="gw-pane" style={{ ...PANE, justifyContent: 'flex-end', paddingBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'auto', paddingTop: 8 }}>
            <div
              className="hex"
              aria-hidden
              style={{
                width: 36,
                height: 36,
                background: 'var(--grad)',
                boxShadow: 'var(--glow)',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="grot" style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-.02em' }}>
                Cohive
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  letterSpacing: '.28em',
                  textTransform: 'uppercase',
                  color: 'var(--soft)',
                }}
              >
                by AurevonLabs
              </span>
            </div>
            <button
              type="button"
              onClick={() => finishOnboarding()}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: 'var(--soft)',
                fontFamily: "'Outfit', system-ui, sans-serif",
                fontSize: 13,
                cursor: 'pointer',
                padding: '8px 4px',
              }}
            >
              Skip
            </button>
          </div>

          <div className="grot" style={{ ...KICKER, marginBottom: 14 }}>
            Begin
          </div>
          <h1
            className="grot"
            style={{
              fontWeight: 700,
              fontSize: 34,
              lineHeight: 1.08,
              letterSpacing: '-.03em',
              margin: '0 0 12px',
            }}
          >
            Your hive
            <br />
            starts here.
          </h1>
          <p style={{ color: 'var(--soft)', fontSize: 15, lineHeight: 1.55, margin: '0 0 28px', maxWidth: '34ch' }}>
            Sign in to keep trips, homes, and dinners with the people you actually plan with.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} role="group" aria-label="Sign in options">
            <button
              type="button"
              className="press gw-btn gw-btn--google"
              onClick={() => void continueWithSocial('google')}
              disabled={authBusy}
              aria-label="Continue with Google"
            >
              <GoogleMark />
              Continue with Google
            </button>
            <button
              type="button"
              className="press gw-btn gw-btn--apple"
              onClick={() => void continueWithSocial('apple')}
              disabled={authBusy}
              aria-label="Continue with Apple"
            >
              <AppleMark />
              Continue with Apple
            </button>
            <button
              type="button"
              className="press gw-btn gw-btn--contact"
              onClick={() => setStep('contact')}
              disabled={authBusy}
              aria-label="Start with email or phone number"
            >
              Start with email / phone
            </button>
          </div>

          <p
            style={{
              fontSize: 11.5,
              color: 'var(--soft)',
              textAlign: 'center',
              margin: '20px 0 0',
              lineHeight: 1.45,
            }}
          >
            {providers.mode === 'oauth'
              ? 'Google and Apple connect through configured OAuth when available.'
              : 'Demo session — continues into the app without provider keys.'}
          </p>
        </div>
      )}

      {step === 'contact' && (
        <div style={PANE}>
          <button
            type="button"
            onClick={() => setStep('gateway')}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: 'none',
              color: 'var(--honey)',
              fontFamily: "'Outfit', system-ui, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '0 0 18px',
            }}
          >
            ← Back
          </button>
          <div className="grot" style={{ ...KICKER, marginBottom: 12 }}>
            Email or phone
          </div>
          <h1 className="grot" style={{ fontWeight: 700, fontSize: 30, letterSpacing: '-.03em', margin: '0 0 10px' }}>
            How should we
            <br />
            reach you?
          </h1>
          <p style={{ color: 'var(--soft)', fontSize: 14.5, lineHeight: 1.55, margin: '0 0 22px' }}>
            We’ll use this to open your hive. No password needed for the demo path.
          </p>
          <label className="sr-only" htmlFor="gw-contact">
            Email or phone number
          </label>
          <input
            id="gw-contact"
            value={contact}
            onChange={(e) => {
              setContact(e.target.value);
              if (contactError) setContactError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && void submitContact()}
            placeholder="you@email.com or +1 555 0100"
            autoComplete="username"
            inputMode="email"
            aria-invalid={Boolean(contactError)}
            aria-describedby={contactError ? 'gw-contact-error' : undefined}
          />
          {contactError ? (
            <p id="gw-contact-error" role="alert" style={{ color: '#F87171', fontSize: 12.5, margin: '10px 0 0' }}>
              {contactError}
            </p>
          ) : null}
          <button
            type="button"
            className="press ctaBtn"
            onClick={() => void submitContact()}
            disabled={authBusy}
            style={{ ...press(0.98), ...CTA, marginTop: 22, opacity: authBusy ? 0.7 : 1 }}
          >
            Continue
          </button>
        </div>
      )}

      {step === 'intro' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: 'calc(var(--safe-top, 42px) + 22px) 30px 40px',
            position: 'relative',
            zIndex: 2,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="hex" aria-hidden style={{ width: 30, height: 30, background: 'var(--grad)' }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="grot" style={{ fontWeight: 700, fontSize: 21, letterSpacing: '-.02em' }}>
                Cohive
              </span>
              <span
                style={{ fontSize: 8, letterSpacing: '.28em', textTransform: 'uppercase', color: 'var(--soft)' }}
              >
                by AurevonLabs
              </span>
            </div>
            <button
              type="button"
              onClick={() => finishOnboarding()}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: 'var(--soft)',
                fontFamily: "'Outfit', system-ui, sans-serif",
                fontSize: 13,
                cursor: 'pointer',
                padding: '8px 4px',
              }}
            >
              Skip
            </button>
          </div>

          {authModeNote !== 'oauth' && (
            <p
              style={{
                margin: '14px 0 0',
                fontSize: 11,
                color: 'var(--sky)',
                letterSpacing: '.04em',
              }}
            >
              {authModeNote === 'oauth_provisional'
                ? 'Signed in via OAuth return (provisional session).'
                : 'Signed in with a demo session — welcome.'}
            </p>
          )}

          <div
            key={slide}
            style={{ marginTop: 'auto', animation: 'cvrise .55s var(--ease-spring) both' }}
          >
            <div className="grot" style={{ ...KICKER, marginBottom: 14 }}>
              {sl.kicker}
            </div>
            <h1
              className="grot"
              style={{
                fontWeight: 700,
                fontSize: 38,
                lineHeight: 1.05,
                letterSpacing: '-.03em',
                margin: '0 0 16px',
                whiteSpace: 'pre-line',
              }}
            >
              {sl.title}
            </h1>
            <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--soft)', margin: 0, maxWidth: '34ch' }}>
              {sl.body}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 34 }}>
            {SLIDES.map((_, i) => (
              <div
                key={i}
                aria-hidden
                style={{
                  width: i === slide ? 26 : 8,
                  height: 8,
                  borderRadius: 99,
                  background: i === slide ? 'var(--grad)' : 'var(--lineB)',
                  transition: 'all .35s var(--ease-spring)',
                }}
              />
            ))}
            <button
              type="button"
              className="press ctaBtn"
              onClick={() => (slide < SLIDES.length - 1 ? setSlide((s) => s + 1) : setStep('hive'))}
              style={{ ...press(0.96), marginLeft: 'auto', borderRadius: 99, padding: '15px 30px', fontSize: 13 }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'hive' && (
        <div style={PANE}>
          <div className="grot" style={{ ...KICKER, marginBottom: 12 }}>
            Step 1 of 2
          </div>
          <h1 className="grot" style={{ fontWeight: 700, fontSize: 32, letterSpacing: '-.03em', margin: '0 0 10px' }}>
            Name your
            <br />
            first hive.
          </h1>
          <p style={{ color: 'var(--soft)', fontSize: 14.5, margin: '0 0 24px' }}>
            A hive is a shared space per group — the trip crew, the household, date night.
          </p>
          <input
            value={hiveName}
            onChange={(e) => setHiveName(e.target.value)}
            placeholder="e.g. Tokyo Crew"
            aria-label="Hive name"
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 30px' }}>
            {HIVE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="press"
                onClick={() => setHiveKind(k)}
                aria-pressed={hiveKind === k}
                style={{ ...chipStyle(hiveKind === k), ...press(0.96) }}
              >
                {k}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="press ctaBtn"
            onClick={() => setStep('invite')}
            style={{ ...press(0.98), ...CTA }}
          >
            Create hive
          </button>
        </div>
      )}

      {step === 'invite' && (
        <div style={PANE}>
          <div className="grot" style={{ ...KICKER, marginBottom: 12 }}>
            Step 2 of 2
          </div>
          <h1 className="grot" style={{ fontWeight: 700, fontSize: 32, letterSpacing: '-.03em', margin: '0 0 10px' }}>
            Bring your
            <br />
            people.
          </h1>
          <p style={{ color: 'var(--soft)', fontSize: 14.5, margin: '0 0 24px' }}>
            Plans stay with relationships, not apps. Invite once — every future trip, listing and dinner lives
            here.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {invitees.map((m) => (
              <span key={m.name} className="memberPill" style={{ animation: 'cvpop .4s ease both' }}>
                <span style={memberDot(m.color)} />
                {m.name}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <input
              value={newInvite}
              onChange={(e) => setNewInvite(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addInvite()}
              placeholder="Add by name or email"
              aria-label="Add by name or email"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="grot"
              onClick={addInvite}
              aria-label="Add invitee"
              style={{
                background: 'var(--panelS)',
                border: '1px solid var(--lineB)',
                color: 'var(--honey)',
                borderRadius: 'var(--r-sm)',
                padding: '0 18px',
                fontWeight: 700,
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="press ctaBtn"
            onClick={() => finishOnboarding(hiveName)}
            style={{ ...press(0.98), ...CTA, marginTop: 28 }}
          >
            Enter your hive
          </button>
        </div>
      )}
    </main>
  );
}
