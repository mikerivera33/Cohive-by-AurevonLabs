import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import { chipStyle, memberDot, press } from '../lib/styles';
import { useApp } from '../store/AppStore';

type Step = 'intro' | 'auth' | 'hive' | 'invite';

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
  padding: '40px 30px',
  position: 'relative',
  zIndex: 2,
  animation: 'cvrise .5s ease both',
};

const KICKER: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '.24em',
  textTransform: 'uppercase',
  color: 'var(--honey)',
};

const CTA: CSSProperties = {
  borderRadius: 14,
  padding: 16,
  fontSize: 13.5,
};

/** Slow-drifting honeycomb behind every onboarding pane. */
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

export function Onboarding() {
  const { finishOnboarding } = useApp();
  const [step, setStep] = useState<Step>('intro');
  const [slide, setSlide] = useState(0);
  const [hiveName, setHiveName] = useState('');
  const [hiveKind, setHiveKind] = useState(HIVE_KINDS[0]);
  const [invitees, setInvitees] = useState([
    { name: 'Maya', color: '#A78BFA' },
    { name: 'Ben', color: '#34D399' },
  ]);
  const [newInvite, setNewInvite] = useState('');

  const sl = SLIDES[slide] || SLIDES[0];

  const addInvite = () => {
    const n = newInvite.trim();
    if (!n) return;
    setInvitees((prev) => [...prev, { name: n, color: '#60A5FA' }]);
    setNewInvite('');
  };

  return (
    <div
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

          <div
            key={slide}
            style={{ marginTop: 'auto', animation: 'cvrise .55s cubic-bezier(.2,.9,.25,1.12) both' }}
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
                style={{
                  width: i === slide ? 26 : 8,
                  height: 8,
                  borderRadius: 99,
                  background: i === slide ? 'var(--grad)' : 'var(--lineB)',
                  transition: 'all .35s cubic-bezier(.2,.9,.25,1.2)',
                }}
              />
            ))}
            <button
              className="press ctaBtn"
              onClick={() => (slide < SLIDES.length - 1 ? setSlide((s) => s + 1) : setStep('auth'))}
              style={{ ...press(0.96), marginLeft: 'auto', borderRadius: 99, padding: '15px 30px', fontSize: 13 }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'auth' && (
        <div style={PANE}>
          <div
            className="hex"
            aria-hidden
            style={{
              width: 56,
              height: 56,
              background: 'var(--grad)',
              marginBottom: 22,
              animation: 'cvpop .6s cubic-bezier(.2,.9,.3,1.3) both',
            }}
          />
          <h1 className="grot" style={{ fontWeight: 700, fontSize: 32, letterSpacing: '-.03em', margin: '0 0 10px' }}>
            Welcome to
            <br />
            the hive.
          </h1>
          <p style={{ color: 'var(--soft)', fontSize: 14.5, lineHeight: 1.55, margin: '0 0 30px' }}>
            One account. Every plan you share — trips, homes, dinners — kept with the people you share them
            with.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <button
              className="press grot"
              onClick={() => setStep('hive')}
              style={{
                ...press(0.98),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                background: 'var(--ink)',
                color: 'var(--bg)',
                border: 'none',
                borderRadius: 14,
                padding: 15,
                fontWeight: 600,
                fontSize: 14.5,
                cursor: 'pointer',
              }}
            >
               Continue with Apple
            </button>
            <button
              className="press grot"
              onClick={() => setStep('hive')}
              style={{
                ...press(0.98),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                background: 'var(--panelS)',
                color: 'var(--ink)',
                border: '1px solid var(--lineB)',
                borderRadius: 14,
                padding: 15,
                fontWeight: 600,
                fontSize: 14.5,
                cursor: 'pointer',
              }}
            >
              G&#8202; Continue with Google
            </button>
            <button
              className="grot"
              onClick={() => setStep('hive')}
              style={{
                background: 'none',
                color: 'var(--honey)',
                border: 'none',
                padding: 13,
                fontWeight: 600,
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              Continue with email
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--soft)', textAlign: 'center', margin: '22px 0 0' }}>
            Private by default. Your hive sees your picks — no one else does.
          </p>
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
              className="grot"
              onClick={addInvite}
              aria-label="Add invitee"
              style={{
                background: 'var(--panelS)',
                border: '1px solid var(--lineB)',
                color: 'var(--honey)',
                borderRadius: 12,
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
            className="press ctaBtn"
            onClick={() => finishOnboarding(hiveName)}
            style={{ ...press(0.98), ...CTA, marginTop: 28 }}
          >
            Enter your hive
          </button>
        </div>
      )}
    </div>
  );
}
