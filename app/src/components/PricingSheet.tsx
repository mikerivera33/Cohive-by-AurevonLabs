import { useEffect, useRef } from 'react';

import { press } from '../lib/styles';
import { useApp } from '../store/AppStore';
import type { PlanTier } from '../types';

interface TierDef {
  name: PlanTier;
  price: string;
  per: string;
  tag: string;
  feats: string[];
  cta: string;
  featured: boolean;
}

const TIERS: TierDef[] = [
  {
    name: 'Free',
    price: '$0',
    per: '',
    tag: 'Everything usable — 3 hives, 3 trips',
    feats: ['All three hives, voting & AI plans', 'Universal link scanner', 'Exports: .ics, Maps, copy'],
    cta: 'Current plan',
    featured: false,
  },
  {
    name: 'Cohive+',
    price: '$4.99',
    per: '/mo',
    tag: 'Every feature, unlimited hives & trips',
    feats: [
      'Unlimited hives, trips & members',
      'Link travel & social accounts',
      'Offline maps',
      'Priority scanner',
      'Permanent 10% referral code',
    ],
    cta: 'Start monthly',
    featured: false,
  },
  {
    name: 'Cohive+ Annual',
    price: '$33',
    per: '/yr',
    tag: 'The full concierge',
    feats: [
      'Everything in Cohive+',
      'In-app booking — OpenTable & Resy',
      'Shared calendars that fill themselves',
      'Permanent 10% referral code',
      'Renewal reminder 3 days ahead',
    ],
    cta: 'Go Annual',
    featured: true,
  },
  {
    name: 'Platinum',
    price: '$129',
    per: ' once',
    tag: 'Lifetime. Yours forever.',
    feats: ['Everything in Annual, for life', 'Permanent 10% referral code', 'Founding-member badge'],
    cta: 'Own it',
    featured: false,
  },
];

export function PricingSheet() {
  const { pricingOpen, closePricing, purchase } = useApp();
  const sheetRef = useRef<HTMLDivElement>(null);

  // Escape closes; Tab cycles inside the sheet; focus returns to the opener.
  useEffect(() => {
    if (!pricingOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePricing();
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [pricingOpen, closePricing]);

  if (!pricingOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cohive plans"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <button
        onClick={closePricing}
        aria-label="Close plans"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(4,7,14,.6)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        style={{
          position: 'relative',
          border: '1px solid var(--lineB)',
          borderRadius: '36px 36px 0 0',
          maxHeight: '82%',
          overflowY: 'auto',
          padding: '14px 20px 34px',
          animation: 'cvslide .48s cubic-bezier(.2,.85,.25,1.1) both',
          outline: 'none',
          background: 'linear-gradient(180deg, var(--bg2), var(--bg))',
        }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: 'var(--lineB)', margin: '0 auto 16px' }} />
        <h2 className="grot" style={{ fontWeight: 700, fontSize: 23, letterSpacing: '-.02em', margin: '0 0 4px' }}>
          Honest pricing.
          <br />
          <em className="gradText" style={{ fontStyle: 'normal' }}>
            Radical idea, we know.
          </em>
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--soft)', margin: '0 0 16px' }}>
          No surprise billing. A reminder before anything renews. Cancel in one tap.
        </p>

        {TIERS.map((p) => (
          <div
            key={p.name}
            style={{
              position: 'relative',
              background: p.featured ? 'var(--panelS)' : 'var(--panel)',
              border: p.featured ? '1.5px solid var(--honey)' : '1px solid var(--line)',
              boxShadow: p.featured ? 'var(--glow)' : 'none',
              borderRadius: 28,
              padding: '16px 18px',
              marginBottom: 12,
              backdropFilter: 'blur(16px)',
            }}
          >
            {p.featured && (
              <span
                className="grot"
                style={{
                  position: 'absolute',
                  top: -9,
                  left: 16,
                  background: 'var(--grad)',
                  color: 'var(--onGrad)',
                  fontWeight: 700,
                  fontSize: 8.5,
                  letterSpacing: '.16em',
                  borderRadius: 99,
                  padding: '4px 11px',
                }}
              >
                MOST POPULAR
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <b className="grot" style={{ fontSize: 16 }}>
                {p.name}
              </b>
              <span className="grot gradText" style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 20 }}>
                {p.price}
              </span>
              <span style={{ fontSize: 11, color: 'var(--soft)' }}>{p.per}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--soft)', margin: '3px 0 8px' }}>{p.tag}</div>
            {p.feats.map((f) => (
              <div key={f} style={{ fontSize: 12, color: 'var(--soft)', padding: '3px 0' }}>
                <span style={{ color: 'var(--honey)' }}>⬡</span> {f}
              </div>
            ))}
            <button
              className="press grot"
              onClick={() => purchase(p.name)}
              style={{
                ...press(0.97),
                width: '100%',
                marginTop: 10,
                background: p.featured ? 'var(--grad)' : 'rgba(78, 180, 255, 0.06)',
                color: p.featured ? 'var(--onGrad)' : 'var(--honey)',
                border: p.featured ? 'none' : '1px solid var(--lineB)',
                borderRadius: 999,
                padding: '12px 16px',
                fontWeight: 700,
                fontSize: 11.5,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                boxShadow: p.featured ? 'var(--glow)' : 'none',
              }}
            >
              {p.cta}
            </button>
          </div>
        ))}
        <p style={{ fontSize: 10, color: 'var(--soft)', textAlign: 'center', margin: '8px 0 0' }}>
          Demo — nothing here charges anything.
        </p>
      </div>
    </div>
  );
}
