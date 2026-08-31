import { useState } from 'react';

import { Reveal } from '../../lib/Reveal';
import { press } from '../../lib/styles';
import { useApp } from '../../store/AppStore';

const BOOK_BUTTONS = ['Flights', 'Stays', 'Tables'];

export function BudgetView() {
  const { trip, expenses, plan, addExpense, say, openPricing, bookingUnlocked } = useApp();
  const [expLabel, setExpLabel] = useState('');
  const [expAmt, setExpAmt] = useState('');

  const planCost = plan ? plan.totalCost : 0;
  const spent = expenses.reduce((a, e) => a + e.amount, 0) + planCost;
  const budget = trip.budget;
  const pct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const over = spent > budget;

  const byCat: Record<string, number> = {};
  expenses.forEach((e) => {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  });
  if (planCost) byCat.activities = (byCat.activities || 0) + planCost;
  const maxCat = Math.max(1, ...Object.values(byCat));

  const onAdd = () => {
    const amt = Number(expAmt);
    if (!expLabel.trim() || !amt) {
      say('Add a label and amount');
      return;
    }
    addExpense(expLabel.trim(), amt);
    setExpLabel('');
    setExpAmt('');
  };

  const onBook = (what: string) => {
    if (!bookingUnlocked) {
      openPricing();
      return;
    }
    say(what + ' — opening your linked accounts');
  };

  return (
    <>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--lineB)', borderRadius: 18, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b className="grot gradText" style={{ fontSize: 24 }}>
            ${spent}
          </b>
          <span style={{ fontSize: 12, color: 'var(--soft)' }}>of ${budget} budget</span>
          <span
            className="grot"
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 700,
              color: over ? '#F87171' : 'var(--mint)',
            }}
          >
            {over ? `$${spent - budget} over` : `$${budget - spent} left`}
          </span>
        </div>
        <div
          style={{
            height: 9,
            borderRadius: 99,
            background: 'var(--bg2)',
            overflow: 'hidden',
            margin: '11px 0 4px',
          }}
        >
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
          <b style={{ width: 56, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>${amt}</b>
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
          style={{ flex: 2 }}
        />
        <input
          value={expAmt}
          onChange={(e) => setExpAmt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          type="number"
          placeholder="$"
          aria-label="Expense amount"
          style={{ flex: 1 }}
        />
      </div>
      <button
        className="press grot"
        onClick={onAdd}
        style={{
          ...press(0.98),
          width: '100%',
          marginTop: 10,
          background: 'var(--panelS)',
          border: '1px solid var(--lineB)',
          color: 'var(--honey)',
          borderRadius: 12,
          padding: 12,
          fontWeight: 700,
          fontSize: 11.5,
          letterSpacing: '.09em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Add expense
      </button>

      {expenses.map((e) => (
        <div
          key={e.id}
          style={{
            display: 'flex',
            gap: 9,
            padding: '11px 2px',
            borderBottom: '1px solid var(--line)',
            fontSize: 13,
            alignItems: 'center',
          }}
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
            }}
          >
            {e.category}
          </span>
          {e.label}
          <b style={{ marginLeft: 'auto', color: 'var(--mint)', fontVariantNumeric: 'tabular-nums' }}>${e.amount}</b>
        </div>
      ))}

      <Reveal
        style={{
          marginTop: 18,
          background: 'var(--panel)',
          border: '1px solid var(--lineB)',
          borderRadius: 16,
          padding: '15px 16px',
        }}
      >
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
