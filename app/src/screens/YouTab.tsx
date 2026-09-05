import { copyText } from '../lib/clipboard';
import { press } from '../lib/styles';
import { useApp } from '../store/AppStore';

/** Row label + brand dot colour. */
type Account = [string, string];

const TRAVEL_ACCOUNTS: Account[] = [
  ['Airbnb', '#FF5A5F'],
  ['Hotels.com', '#D32F2F'],
  ['Expedia', '#FDC02F'],
  ['Priceline', '#0068EF'],
  ['Uber', '#9CA3AF'],
  ['Resy', '#FF462D'],
  ['American — AAdvantage', '#E11B22'],
  ['United Airlines', '#4C9EEB'],
  ['Delta Air Lines', '#C8102E'],
  ['Southwest Airlines', '#F9B612'],
  ['Frontier Airlines', '#00A650'],
];

const SOCIAL_ACCOUNTS: Account[] = [
  ['X', '#B9C2CF'],
  ['TikTok', '#69C9D0'],
  ['Instagram', '#E1306C'],
  ['Threads', '#D1D5DB'],
  ['YouTube', '#FF3D3D'],
  ['Pinterest', '#E60023'],
  ['VSCO', '#A3A3A3'],
  ['Snapchat', '#FFFC00'],
  ['LinkedIn', '#0A66C2'],
  ['Facebook', '#1877F2'],
];

function AccountRows({ accounts }: { accounts: Account[] }) {
  const { linked, connectionsUnlocked, toggleLink, openPricing } = useApp();

  return (
    <>
      {accounts.map(([name, color]) => {
        const on = linked.includes(name);
        return (
          <div key={name} className="listRow">
            <span
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: color,
                boxShadow: `0 0 7px ${color}`,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {name}
            <button
              className="press grot"
              onClick={() => (connectionsUnlocked ? toggleLink(name) : openPricing())}
              aria-pressed={connectionsUnlocked ? on : undefined}
              style={{
                ...press(0.95),
                marginLeft: 'auto',
                flexShrink: 0,
                borderRadius: 99,
                padding: '5px 12px',
                fontSize: 10.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all .18s ease',
                border: on ? '1px solid var(--honey)' : '1px solid var(--line)',
                background: on ? 'rgba(245,165,36,.12)' : 'none',
                color: on ? 'var(--honey)' : 'var(--soft)',
              }}
            >
              {!connectionsUnlocked ? '🔒 Cohive+' : on ? 'Connected ✓' : 'Connect'}
            </button>
          </div>
        );
      })}
    </>
  );
}

export function YouTab() {
  const { planTier, refCode, light, toggleTheme, openPricing, replayOnboarding, say } = useApp();

  const isFree = planTier === 'Free';
  const planName = isFree ? 'Free plan' : planTier;
  const planSub = isFree
    ? 'Everything’s usable. Booking, account linking and your referral code live upstairs.'
    : planTier === 'Platinum'
      ? 'Lifetime access. Account linking unlocked — connect everything below.'
      : 'All features unlocked — account linking included. Connect everything below.';

  const onCopyRef = async () => {
    const ok = await copyText(refCode);
    say(ok ? 'Referral code copied — 10% on every paid signup' : 'Couldn’t reach the clipboard');
  };

  return (
    <div style={{ animation: 'cvrise .4s cubic-bezier(.2,.9,.25,1.1) both' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, margin: '8px 0 20px' }}>
        <div
          className="grot"
          style={{
            width: 52,
            height: 52,
            borderRadius: 99,
            background: 'var(--grad)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: 20,
            color: 'var(--onGrad)',
          }}
        >
          M
        </div>
        <div>
          <b className="grot" style={{ fontSize: 18 }}>
            Mike
          </b>
          <div style={{ fontSize: 12, color: 'var(--soft)' }}>3 hives · 1 active trip</div>
        </div>
      </div>

      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--lineB)',
          borderRadius: 24,
          padding: '16px 18px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 3, background: 'var(--grad)' }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b className="grot" style={{ fontSize: 16 }}>
            {planName}
          </b>
          <span style={{ fontSize: 11, color: 'var(--soft)' }}>3 of 3 hives · 1 of 3 trips</span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--soft)', margin: '6px 0 12px' }}>{planSub}</p>
        <button
          className="press ctaBtn"
          onClick={openPricing}
          style={{ ...press(0.96), borderRadius: 14, padding: '12px 18px', fontSize: 11.5, letterSpacing: '.09em' }}
        >
          See Cohive+ plans
        </button>
      </div>

      {!isFree ? (
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--honey)',
            borderRadius: 24,
            padding: '16px 18px',
            marginTop: 16,
            position: 'relative',
            overflow: 'hidden',
            boxShadow: 'var(--glow)',
          }}
        >
          <div
            className="grot"
            style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--honey)' }}
          >
            Your referral code
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 6px' }}>
            <b className="grot" style={{ fontSize: 21, letterSpacing: '.06em' }}>
              {refCode}
            </b>
            <button
              className="press ctaBtn"
              onClick={onCopyRef}
              style={{
                ...press(0.95),
                marginLeft: 'auto',
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 10.5,
                letterSpacing: '.07em',
                boxShadow: 'none',
              }}
            >
              Copy
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--soft)', margin: 0, lineHeight: 1.55 }}>
            Never expires. Earn <b style={{ color: 'var(--honey)' }}>10% commission</b> on every signup with
            your code — paid only when that signup purchases a paid plan.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--panel)',
            border: '1px dashed var(--lineB)',
            borderRadius: 14,
            padding: '13px 16px',
            marginTop: 14,
            fontSize: 12.5,
            color: 'var(--soft)',
          }}
        >
          <span style={{ color: 'var(--honey)' }}>⬡</span> Every paid plan includes a permanent referral code
          — 10% commission on each paid signup.
          <button
            className="grot"
            onClick={openPricing}
            style={{
              marginLeft: 'auto',
              flexShrink: 0,
              background: 'none',
              border: '1px solid var(--lineB)',
              color: 'var(--honey)',
              borderRadius: 99,
              padding: '6px 12px',
              fontWeight: 600,
              fontSize: 10.5,
              cursor: 'pointer',
            }}
          >
            Plans
          </button>
        </div>
      )}

      <h2 className="sectionTitle" style={{ margin: '24px 0 4px' }}>
        Travel &amp; booking accounts
      </h2>
      <AccountRows accounts={TRAVEL_ACCOUNTS} />

      <h2 className="sectionTitle" style={{ margin: '24px 0 4px' }}>
        Social accounts
      </h2>
      <AccountRows accounts={SOCIAL_ACCOUNTS} />

      <h2 className="sectionTitle" style={{ margin: '24px 0 4px' }}>
        Preferences
      </h2>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '13px 2px',
          borderBottom: '1px solid var(--line)',
          fontSize: 13.5,
        }}
      >
        Light mode
        <button
          className="press"
          onClick={toggleTheme}
          role="switch"
          aria-checked={light}
          aria-label="Light mode"
          style={{
            ...press(0.95),
            marginLeft: 'auto',
            width: 46,
            height: 27,
            borderRadius: 99,
            border: '1px solid var(--lineB)',
            background: light ? 'var(--grad)' : 'var(--bg2)',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background .25s ease',
            padding: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2.5,
              left: light ? 22 : 3,
              width: 19,
              height: 19,
              borderRadius: 99,
              background: '#fff',
              transition: 'left .25s cubic-bezier(.2,.9,.25,1.2)',
              display: 'block',
              boxShadow: '0 1px 4px rgba(0,0,0,.3)',
            }}
          />
        </button>
      </div>
      <button
        onClick={replayOnboarding}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--line)',
          color: 'var(--ink)',
          padding: '13px 2px',
          fontSize: 13.5,
          fontFamily: "'Outfit', system-ui, sans-serif",
          cursor: 'pointer',
        }}
      >
        Replay welcome tour
      </button>

      <p style={{ fontSize: 10.5, color: 'var(--soft)', textAlign: 'center', margin: '26px 0 0', lineHeight: 1.6 }}>
        Cohive 1.0 · crafted by <b style={{ color: 'var(--honey)' }}>AurevonLabs</b>
        <br />a division of Aurevon Ventures LLC
      </p>
    </div>
  );
}
