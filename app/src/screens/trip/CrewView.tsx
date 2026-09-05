import { useState } from 'react';

import { memberDot } from '../../lib/styles';
import { useApp } from '../../store/AppStore';

export function CrewView() {
  const { members, activity, addMember } = useApp();
  const [newMember, setNewMember] = useState('');

  const onAdd = () => {
    const n = newMember.trim();
    if (!n) return;
    addMember(n);
    setNewMember('');
  };

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--soft)', margin: '0 0 14px', lineHeight: 1.55 }}>
        Everyone saves; everyone votes in tiers. The concierge treats{' '}
        <b style={{ color: 'var(--honey)' }}>Must</b> as a promise,{' '}
        <b style={{ color: 'var(--ink)' }}>Maybe</b> as a preference, and <b>If time</b> as a bonus.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {members.map((m) => (
          <span key={m.id} className="memberPill">
            <span style={memberDot(m.color)} />
            {m.name}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 9, marginBottom: 20 }}>
        <input
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          placeholder="Invite — e.g. Alex"
          aria-label="Invite a member"
          style={{ flex: 1 }}
        />
        <button
          className="grot"
          onClick={onAdd}
          aria-label="Add member"
          style={{
            background: 'var(--panelS)',
            border: '1px solid var(--lineB)',
            color: 'var(--honey)',
            borderRadius: 999,
            padding: '0 18px',
            fontWeight: 700,
            fontSize: 18,
            cursor: 'pointer',
          }}
        >
          +
        </button>
      </div>

      <h2 className="sectionTitle" style={{ margin: '0 0 4px' }}>
        Trip activity
      </h2>
      {activity.map((a, i) => (
        <div
          key={a.who + a.what + i}
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 0',
            borderBottom: '1px solid var(--line)',
            fontSize: 13.5,
          }}
        >
          <span style={memberDot(members.find((m) => m.name === a.who)?.color || '#4EB4FF')} />
          <span style={{ color: 'var(--soft)' }}>
            <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{a.who}</b> {a.what}
            <span style={{ display: 'block', fontSize: 11, marginTop: 2 }}>{a.when}</span>
          </span>
        </div>
      ))}
    </>
  );
}
