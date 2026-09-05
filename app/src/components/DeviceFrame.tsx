import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const FRAME_W = 402;
const FRAME_H = 874;
/** Below this the app goes full-bleed — a bezel around a real phone is nonsense. */
const FRAME_BREAKPOINT = 900;

function StatusBar({ dark, time = '9:41' }: { dark: boolean; time?: string }) {
  const c = dark ? '#fff' : '#000';
  return (
    <div
      style={{
        display: 'flex',
        gap: 154,
        alignItems: 'center',
        justifyContent: 'center',
        padding: '21px 24px 19px',
        boxSizing: 'border-box',
        position: 'relative',
        zIndex: 20,
        width: '100%',
      }}
    >
      <div
        style={{
          flex: 1,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 1.5,
        }}
      >
        <span
          style={{
            fontFamily: '-apple-system, "SF Pro", system-ui',
            fontWeight: 590,
            fontSize: 17,
            lineHeight: '22px',
            color: c,
          }}
        >
          {time}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          paddingTop: 1,
          paddingRight: 1,
        }}
      >
        <svg width="19" height="12" viewBox="0 0 19 12" aria-hidden>
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill={c} />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill={c} />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill={c} />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill={c} />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12" aria-hidden>
          <path
            d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z"
            fill={c}
          />
          <path
            d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z"
            fill={c}
          />
          <circle cx="8.5" cy="10.5" r="1.5" fill={c} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden>
          <rect
            x="0.5"
            y="0.5"
            width="23"
            height="12"
            rx="3.5"
            stroke={c}
            strokeOpacity="0.35"
            fill="none"
          />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c} />
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill={c} fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

/**
 * On a phone (or inside Capacitor) the app fills the screen and reads the real
 * safe-area insets. On a desktop-sized viewport it renders inside an iOS bezel,
 * which is how the design was presented — same layout either way, driven by the
 * `--safe-top` / `--safe-bottom` variables the chrome reads.
 */
export function DeviceFrame({ dark, children }: { dark: boolean; children: ReactNode }) {
  const [framed, setFramed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= FRAME_BREAKPOINT
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${FRAME_BREAKPOINT}px)`);
    const onChange = () => setFramed(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!framed) {
    return (
      <div
        style={
          {
            position: 'fixed',
            inset: 0,
            overflow: 'hidden',
            '--safe-top': 'calc(env(safe-area-inset-top, 0px) + 16px)',
            '--safe-bottom': 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '26px 12px',
        boxSizing: 'border-box',
        background: dark
          ? 'radial-gradient(900px 520px at 80% 0%, rgba(78,180,255,0.16), transparent 55%), radial-gradient(800px 480px at 10% 90%, rgba(27,79,216,0.2), transparent 50%), #050914'
          : 'radial-gradient(900px 520px at 80% 0%, rgba(143,208,255,0.45), transparent 55%), radial-gradient(800px 480px at 10% 90%, rgba(59,158,255,0.22), transparent 50%), #e8f1fa',
      }}
    >
      <div
        style={{
          width: FRAME_W,
          height: FRAME_H,
          borderRadius: 48,
          overflow: 'hidden',
          position: 'relative',
          background: dark ? '#000' : '#F2F2F7',
          boxShadow: dark
            ? '0 40px 90px rgba(8,24,56,0.55), 0 0 0 1px rgba(120,170,230,0.16)'
            : '0 40px 90px rgba(40,90,160,0.18), 0 0 0 1px rgba(30,70,130,0.1)',
          fontFamily: '-apple-system, system-ui, sans-serif',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* dynamic island */}
        <div
          style={{
            position: 'absolute',
            top: 11,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 126,
            height: 37,
            borderRadius: 24,
            background: '#000',
            zIndex: 50,
          }}
        />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, pointerEvents: 'none' }}>
          <StatusBar dark={dark} />
        </div>

        <div
          style={
            {
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              '--safe-top': '42px',
              '--safe-bottom': '26px',
            } as React.CSSProperties
          }
        >
          <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>
        </div>

        {/* home indicator */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 60,
            height: 34,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-end',
            paddingBottom: 8,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 139,
              height: 5,
              borderRadius: 100,
              background: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.25)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
