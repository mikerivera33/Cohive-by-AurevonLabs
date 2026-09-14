import { useState } from 'react';
import type { CSSProperties } from 'react';

import { SETTLEMENT_CATEGORY } from '../../engine/ledger';
import { Reveal } from '../../lib/Reveal';
import { money } from '../../lib/money';
import { payLinkFor } from '../../lib/payLinks';
import { memberDot, press } from '../../lib/styles';
import { useApp } from '../../store/AppStore';
import type { Expense, MemberId, Payer } from '../../types';

const BOOK_BUTTONS = ['Flights', 'Stays', 'Tables'];

const card: CSSProperties = {
  border: '1px solid var(--lineB)',
  borderRadius: 24,
  padding: '16px 18px',
  boxShadow: 'var(--shadow)',
};

const pillButton = (on: boolean): CSSProperties => ({
  ...press(0.95),
  background: on ? 'var(--panelS)' : 'var(--bg2)',
  border: on ? '1px solid var(--honey)' : '1px solid var(--lineB)',
  color: on ? 'var(--honey)' : 'var(--soft)',
  borderRadius: 999,
  minHeight: 44, // iOS HIG tap target
  padding: '7px 14px',
  fontWeight: 600,
  fontSize: 11,
  cursor: 'pointer',
});

const wideButton: CSSProperties = {
  ...press(0.98),
  background: 'var(--panelS)',
  border: '1px solid var(--lineB)',
  color: 'var(--honey)',
  borderRadius: 999,
  minHeight: 44,
  padding: 12,
  fontWeight: 700,
  fontSize: 11.5,
  letterSpacing: '.09em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 };

const key = (id: MemberId) => String(id);

export function BudgetView() {
  const {
    trip, expenses, fund, ledger, members, meId, plan, say, openPricing, bookingUnlocked,
    addExpense, contribute, withdraw, settle, voidExpense,
    expLabel, setExpLabel, expAmt, setExpAmt,
  } = useApp();
  const [potAmt, setPotAmt] = useState('');
  const [payer, setPayer] = useState<'me' | 'pot' | string>('me');
  /** null = everyone (the default); otherwise the member keys sharing the cost. */
  const [split, setSplit] = useState<string[] | null>(null);

  const nameOf = (id: MemberId) => members.find((m) => key(m.id) === key(id))?.name ?? 'Someone';
  const isMe = (id: MemberId) => key(id) === key(meId);

  const real = expenses.filter((e) => e.category !== SETTLEMENT_CATEGORY && !e.voidedAt);
  const planCost = plan ? plan.totalCost : 0;
  const spent = real.reduce((a, e) => a + e.amount, 0) + planCost;
  const budget = trip.budget;
  const pct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const over = spent > budget;
  const myEnvelope = ledger.envelopes[key(meId)] ?? 0;
  const contributors = fund.filter((f) => f.kind === 'contribution').length;

  const byCat: Record<string, number> = {};
  real.forEach((e) => {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  });
  if (planCost) byCat.activities = (byCat.activities || 0) + planCost;
  const maxCat = Math.max(1, ...Object.values(byCat));

  const onPot = (fn: (amount: number) => boolean) => {
    const amt = Number(potAmt);
    if (!amt) {
      say('Enter an amount');
      return;
    }
    if (fn(amt)) setPotAmt('');
  };

  const toggleSplit = (id: MemberId) => {
    const all = members.map((m) => key(m.id));
    setSplit((prev) => {
      const cur = prev ?? all;
      const next = cur.includes(key(id)) ? cur.filter((x) => x !== key(id)) : [...cur, key(id)];
      return next.length === all.length ? null : next;
    });
  };

  const onAdd = () => {
    const amt = Number(expAmt);
    if (!expLabel.trim() || !amt) {
      say('Add a label and amount');
      return;
    }
    const paidBy: Payer =
      payer === 'pot' ? 'pot' : payer === 'me' ? meId : members.find((m) => key(m.id) === payer)?.id ?? meId;
    const splitWith = split ? members.filter((m) => split.includes(key(m.id))).map((m) => m.id) : undefined;
    if (splitWith && !splitWith.length) {
      say('Pick at least one person to split with');
      return;
    }
    if (addExpense(expLabel.trim(), amt, { paidBy, splitWith })) {
      setExpLabel('');
      setExpAmt('');
    }
  };

  const onBook = (what: string) => {
    if (!bookingUnlocked) {
      openPricing();
      return;
    }
    say(what + ' — opening your linked accounts');
  };

  const payerLabel = (e: Expense) => {
    const p = e.paidBy ?? meId;
    const who = p === 'pot' ? 'Pot' : isMe(p) ? 'You' : nameOf(p);
    const ways = e.splitWith?.length || members.length;
    const base = e.category === SETTLEMENT_CATEGORY ? 'settled' : `${who} paid · ${ways} way${ways === 1 ? '' : 's'}`;
    return e.voidedAt ? base + ' · voided' : base;
  };

  return (
    <>
      <div className="panelCard" style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b className="grot gradText" style={{ fontSize: 24 }}>
            ${money(spent)}
          </b>
          <span style={{ fontSize: 12, color: 'var(--soft)' }}>of ${money(budget)} budget</span>
          <span
            className="grot"
            style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: over ? '#F87171' : 'var(--mint)' }}
          >
            {over ? `$${money(spent - budget)} over` : `$${money(budget - spent)} left`}
          </span>
        </div>
        <div style={{ height: 9, borderRadius: 99, background: 'var(--bg2)', overflow: 'hidden', margin: '11px 0 4px' }}>
          <div
            style={{
              width: pct + '%',
              height: '100%',
              background: over ? 'linear-gradient(120deg,#F472B6,#F87171)' : 'var(--grad)',
              borderRadius: 99,
              transition: 'width .7s cubic-bezier(.2,.7,.3,1)',
            }}
          />
        </div>
      </div>

      <h2 className="sectionTitle" style={{ margin: '20px 0 6px' }}>
        Group pot
      </h2>
      <div className="panelCard" style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b className="grot gradText" style={{ fontSize: 24 }}>
            ${money(ledger.pot)}
          </b>
          <span style={{ fontSize: 12, color: 'var(--soft)' }}>in the pot</span>
          <span className="grot" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--mint)' }}>
            yours: ${money(myEnvelope)}
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--soft)', margin: '6px 0 10px', lineHeight: 1.5 }}>
          Everyone’s money stays in their own envelope — you can only take out what you put in, and the
          pot only pays a bill when every share is covered.
        </p>
        {members.map((m) => (
          <div key={m.id} style={{ ...row, margin: '6px 0' }}>
            <span style={memberDot(m.color)} />
            <span>{isMe(m.id) ? 'You' : m.name}</span>
            <b style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
              ${money(ledger.envelopes[key(m.id)] ?? 0)}
            </b>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            value={potAmt}
            onChange={(e) => setPotAmt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onPot(contribute)}
            type="number"
            inputMode="decimal"
            enterKeyHint="done"
            min={0}
            placeholder="$"
            aria-label="Pot amount"
            style={{ flex: '1 1 80px', minWidth: 0 }}
          />
          <button className="press grot" onClick={() => onPot(contribute)} style={pillButton(true)}>
            Add to pot
          </button>
          <button className="press grot" onClick={() => onPot(withdraw)} style={pillButton(false)}>
            Take out
          </button>
        </div>
        {contributors === 0 && (
          <p style={{ fontSize: 10.5, color: 'var(--soft)', margin: '10px 0 0' }}>
            Nobody has chipped in yet — start the pot and the crew can match you.
          </p>
        )}
      </div>

      <h2 className="sectionTitle" style={{ margin: '20px 0 6px' }}>
        Breakdown
      </h2>
      {Object.entries(byCat).map(([label, amt]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
          <span style={{ width: 82, fontSize: 12, color: 'var(--soft)', textTransform: 'capitalize' }}>{label}</span>
          <div style={{ flex: 1, height: 7, borderRadius: 99, background: 'var(--bg2)', overflow: 'hidden' }}>
            <div
              style={{
                width: Math.round((amt / maxCat) * 100) + '%',
                height: '100%',
                background: 'var(--grad)',
                borderRadius: 99,
                transition: 'width .6s ease',
              }}
            />
          </div>
          <b style={{ width: 56, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
            ${money(amt)}
          </b>
        </div>
      ))}

      <h2 className="sectionTitle" style={{ margin: '20px 0 4px' }}>
        Log an expense
      </h2>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          value={expLabel}
          onChange={(e) => setExpLabel(e.target.value)}
          placeholder="What — e.g. izakaya night"
          aria-label="Expense label"
          style={{ flex: 2, minWidth: 0 }}
        />
        <input
          value={expAmt}
          onChange={(e) => setExpAmt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          type="number"
          inputMode="decimal"
          enterKeyHint="done"
          min={0}
          placeholder="$"
          aria-label="Expense amount"
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
          aria-label="Paid by"
          style={{ flex: '1 1 140px', minWidth: 0 }}
        >
          <option value="me">You paid</option>
          {members
            .filter((m) => !isMe(m.id))
            .map((m) => (
              <option key={m.id} value={key(m.id)}>
                {m.name} paid
              </option>
            ))}
          <option value="pot">Paid from the pot</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--soft)', marginRight: 2 }}>Split with</span>
        {members.map((m) => {
          const on = !split || split.includes(key(m.id));
          return (
            <button
              key={m.id}
              className="press grot"
              aria-pressed={on}
              onClick={() => toggleSplit(m.id)}
              style={pillButton(on)}
            >
              {isMe(m.id) ? 'You' : m.name}
            </button>
          );
        })}
      </div>
      <button className="press grot" onClick={onAdd} style={{ ...wideButton, width: '100%', marginTop: 10 }}>
        Add expense
      </button>

      {expenses.map((e) => (
        <div
          key={e.id}
          style={{ display: 'flex', gap: 9, padding: '11px 2px', borderBottom: '1px solid var(--line)', fontSize: 13, alignItems: 'center' }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--soft)',
              border: '1px solid var(--line)',
              borderRadius: 99,
              padding: '3px 8px',
              flexShrink: 0,
            }}
          >
            {e.category}
          </span>
          <span style={{ minWidth: 0, textDecoration: e.voidedAt ? 'line-through' : 'none', opacity: e.voidedAt ? 0.6 : 1 }}>
            {e.label}
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--soft)', marginTop: 2, textDecoration: 'none' }}>{payerLabel(e)}</span>
          </span>
          <b style={{ marginLeft: 'auto', color: e.voidedAt ? 'var(--soft)' : 'var(--mint)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, textDecoration: e.voidedAt ? 'line-through' : 'none' }}>
            ${money(e.amount)}
          </b>
          {!e.voidedAt && (
            <button
              type="button"
              className="press grot"
              onClick={() => voidExpense(e.id)}
              aria-label={`Void ${e.label}`}
              style={{ ...pillButton(false), padding: '7px 10px', flexShrink: 0 }}
            >
              Void
            </button>
          )}
        </div>
      ))}

      <h2 className="sectionTitle" style={{ margin: '20px 0 6px' }}>
        Settle up
      </h2>
      <div className="panelCard" style={card}>
        {members.map((m) => {
          const b = ledger.balances[key(m.id)] ?? 0;
          return (
            <div key={m.id} style={{ ...row, margin: '6px 0' }}>
              <span style={memberDot(m.color)} />
              <span>{isMe(m.id) ? 'You' : m.name}</span>
              <b
                style={{
                  marginLeft: 'auto',
                  fontVariantNumeric: 'tabular-nums',
                  color: b > 0 ? 'var(--mint)' : b < 0 ? 'var(--ink)' : 'var(--soft)',
                }}
              >
                {b > 0 ? `gets back $${money(b)}` : b < 0 ? `owes $${money(-b)}` : 'all square'}
              </b>
            </div>
          );
        })}
        {ledger.transfers.length ? (
          ledger.transfers.map((t) => (
            <div
              key={key(t.from) + '>' + key(t.to)}
              style={{ ...row, borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}
            >
              <span>
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{isMe(t.from) ? 'You' : nameOf(t.from)}</b>
                <span style={{ color: 'var(--soft)' }}> pays </span>
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{isMe(t.to) ? 'You' : nameOf(t.to)}</b>
              </span>
              <b style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>${money(t.amount)}</b>
              {(() => {
                const payee = members.find((m) => key(m.id) === key(t.to));
                const link = payLinkFor(payee?.payHandle, t.amount, `Cohive · ${trip.name}`);
                return link ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Pay ${nameOf(t.to)} $${money(t.amount)} via ${link.app}`}
                    style={{ ...pillButton(true), display: 'inline-flex', alignItems: 'center', textDecoration: 'none', padding: '7px 10px', flexShrink: 0 }}
                  >
                    {link.app}
                  </a>
                ) : null;
              })()}
              <button
                className="press grot"
                onClick={() => settle(t)}
                aria-label={`Mark ${nameOf(t.from)} paid ${nameOf(t.to)} $${money(t.amount)}`}
                style={pillButton(false)}
              >
                Mark paid
              </button>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 12, color: 'var(--soft)', margin: '8px 0 0' }}>Everyone is square 🎉</p>
        )}
      </div>

      <Reveal style={{ marginTop: 18, background: 'var(--panel)', border: '1px solid var(--lineB)', borderRadius: 24, padding: '15px 16px' }}>
        <b className="grot" style={{ fontSize: 14 }}>
          Book this trip
        </b>
        <p style={{ fontSize: 12, color: 'var(--soft)', margin: '5px 0 11px' }}>
          Flights, stays and tables — booked without leaving the hive.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {BOOK_BUTTONS.map((label) => (
            <button
              key={label}
              className="press grot"
              onClick={() => onBook(label)}
              style={{
                ...press(0.95),
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: bookingUnlocked ? 'var(--panelS)' : 'var(--bg2)',
                border: bookingUnlocked ? '1px solid var(--honey)' : '1px solid var(--lineB)',
                color: bookingUnlocked ? 'var(--honey)' : 'var(--soft)',
                borderRadius: 11,
                minHeight: 44,
                padding: '9px 13px',
                fontWeight: 600,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {bookingUnlocked ? '' : '🔒 '}
              {label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--soft)', margin: '10px 0 0' }}>
          {bookingUnlocked ? (
            <>
              In-app booking is active on <b style={{ color: 'var(--honey)' }}>your plan</b>.
            </>
          ) : (
            <>
              In-app booking unlocks with <b style={{ color: 'var(--honey)' }}>Cohive+ Annual</b>.
            </>
          )}
        </p>
      </Reveal>
    </>
  );
}
