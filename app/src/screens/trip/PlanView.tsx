import { buildIcs, planAsText } from '../../engine/engine';
import { copyText } from '../../lib/clipboard';
import { catLabel, press } from '../../lib/styles';
import { useApp } from '../../store/AppStore';
import type { Pace, PlanDay, PlanVisit } from '../../types';

const isVisit = (i: PlanDay['items'][number]): i is PlanVisit => i.type === 'visit';

const dayTitle = (d: PlanDay): string => {
  const first = d.items.find(isVisit);
  return first ? first.name + ' & around' : 'Open day';
};

const mapsUrl = (d: PlanDay): string =>
  'https://www.google.com/maps/dir/' +
  d.items
    .filter(isVisit)
    .map((v) => v.lat + ',' + v.lng)
    .join('/');

export function PlanView() {
  const {
    trip,
    plan,
    building,
    buildStage,
    buildStages,
    planDays,
    setPlanDays,
    pace,
    setPace,
    generate,
    say,
  } = useApp();

  const onCopy = async () => {
    if (!plan) return;
    const ok = await copyText(planAsText(plan, trip));
    say(ok ? 'Copied to clipboard' : 'Couldn’t reach the clipboard');
  };

  const onDownloadIcs = () => {
    if (!plan) return;
    const blob = new Blob([buildIcs(plan, trip)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cohive-tokyo.ics';
    a.click();
    // Revoking immediately can cancel the download in some engines.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('Calendar file downloaded');
  };

  return (
    <>
      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--lineB)',
          borderRadius: 18,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          <label
            className="grot"
            style={{
              flex: 1,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: 'var(--soft)',
            }}
          >
            Days
            <input
              type="number"
              min={1}
              max={10}
              value={planDays}
              onChange={(e) => setPlanDays(Number(e.target.value) || 1)}
              style={{ marginTop: 5 }}
            />
          </label>
          <label
            className="grot"
            style={{
              flex: 2,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: 'var(--soft)',
            }}
          >
            Pace
            <select value={pace} onChange={(e) => setPace(e.target.value as Pace)} style={{ marginTop: 5 }}>
              <option value="relaxed">Relaxed — 4 spots/day</option>
              <option value="balanced">Balanced — 6/day</option>
              <option value="packed">Packed — 8/day</option>
            </select>
          </label>
        </div>
        <button
          className="press ctaBtn"
          onClick={generate}
          disabled={building}
          style={{
            ...press(0.98),
            width: '100%',
            marginTop: 12,
            borderRadius: 13,
            padding: 14,
            fontSize: 12.5,
            opacity: building ? 0.7 : 1,
          }}
        >
          {plan ? 'Regenerate itinerary' : 'Generate itinerary'}
        </button>
      </div>

      {building && (
        <div
          style={{
            background: 'var(--panelS)',
            border: '1px solid var(--lineB)',
            borderRadius: 16,
            padding: 18,
            marginBottom: 14,
          }}
        >
          {buildStages.map((label, i) => (
            <div
              key={label}
              className="grot"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '7px 0',
                fontSize: 12.5,
                fontWeight: 600,
                color: i < buildStage ? 'var(--mint)' : i === buildStage ? 'var(--ink)' : 'var(--soft)',
                opacity: i <= buildStage ? 1 : 0.45,
                animation: i === buildStage ? 'cvpulse 1s ease infinite' : 'none',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  flexShrink: 0,
                  background:
                    i < buildStage ? 'var(--mint)' : i === buildStage ? 'var(--honey)' : 'var(--lineB)',
                  boxShadow: i === buildStage ? '0 0 8px var(--honey)' : 'none',
                }}
              />
              {label}
            </div>
          ))}
        </div>
      )}

      {plan && !building && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button className="ghostBtn" onClick={onCopy}>
              Copy as text
            </button>
            <button className="ghostBtn" onClick={onDownloadIcs}>
              Calendar .ics
            </button>
            <span style={{ fontSize: 11, color: 'var(--soft)', alignSelf: 'center' }}>
              Total on-plan: <b style={{ color: 'var(--mint)' }}>${plan.totalCost}</b>
            </span>
          </div>

          {plan.days.map((d, di) => (
            <div
              key={d.day}
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--lineB)',
                borderRadius: 16,
                overflow: 'hidden',
                marginBottom: 12,
                boxShadow: 'var(--shadow)',
                animation: `cvrise .5s cubic-bezier(.2,.9,.25,1.1) ${di * 0.12}s both`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '13px 16px',
                  borderBottom: '1px dashed var(--lineB)',
                  background: 'var(--bg2)',
                }}
              >
                <span
                  className="grot"
                  style={{
                    fontWeight: 700,
                    fontSize: 11.5,
                    color: 'var(--honey)',
                    border: '1.5px solid var(--honey)',
                    borderRadius: 8,
                    padding: '6px 9px',
                    letterSpacing: '.08em',
                    background: 'rgba(245,165,36,.09)',
                    boxShadow: '0 0 12px rgba(245,165,36,.22)',
                  }}
                >
                  DAY {d.day}
                </span>
                <b className="grot" style={{ fontSize: 13.5 }}>
                  {dayTitle(d)}
                </b>
                <span className="grot" style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 12, color: 'var(--mint)' }}>
                  ${d.cost}
                </span>
              </div>

              <div style={{ padding: '12px 16px 14px' }}>
                {d.items.map((it, i) =>
                  it.type === 'travel' ? (
                    <div
                      key={`t${i}`}
                      style={{ display: 'flex', gap: 10, padding: '3px 0 3px 14px', alignItems: 'baseline' }}
                    >
                      <span
                        className="grot"
                        style={{ fontSize: 10.5, width: 62, flexShrink: 0, color: 'var(--soft)', fontStyle: 'italic' }}
                      >
                        {it.minutes} min
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ fontSize: 11, color: 'var(--soft)', fontStyle: 'italic' }}>
                          ↓ transit to {it.to}
                        </span>
                      </span>
                    </div>
                  ) : (
                    <div
                      key={`v${it.id}-${i}`}
                      style={{
                        display: 'flex',
                        gap: 10,
                        padding: '6px 0 6px 14px',
                        alignItems: 'baseline',
                        position: 'relative',
                        borderLeft: '2px dotted var(--lineB)',
                      }}
                    >
                      <span
                        className="grot"
                        style={{
                          fontWeight: 600,
                          fontSize: 11.5,
                          width: 62,
                          flexShrink: 0,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {it.start}–{it.end}
                      </span>
                      <span style={{ flex: 1 }}>
                        <span
                          className="grot"
                          style={{
                            fontWeight: 600,
                            fontSize: 13.5,
                            color: it.tier === 'must' ? 'var(--honey)' : 'var(--ink)',
                          }}
                        >
                          {it.name}
                          {it.tier === 'must' ? ' ★' : ''}
                        </span>
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--soft)' }}>
                          {catLabel(it.category)}
                          {it.cost ? ' · $' + it.cost : ''}
                        </span>
                      </span>
                    </div>
                  )
                )}

                {d.warnings.length > 0 && (
                  <div
                    style={{
                      marginTop: 9,
                      padding: '9px 12px',
                      background: 'rgba(251,191,36,.08)',
                      border: '1px solid rgba(251,191,36,.35)',
                      borderRadius: 10,
                      fontSize: 11,
                      color: 'var(--amber)',
                    }}
                  >
                    {d.warnings.join(' ')}
                  </div>
                )}

                <a
                  href={mapsUrl(d)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grot"
                  style={{
                    display: 'inline-block',
                    marginTop: 10,
                    fontWeight: 600,
                    fontSize: 11,
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Directions in Google Maps →
                </a>
              </div>
            </div>
          ))}

          {plan.unplaced.length > 0 && (
            <div
              style={{
                border: '1px dashed var(--lineB)',
                borderRadius: 13,
                padding: '12px 15px',
                fontSize: 12,
                color: 'var(--soft)',
              }}
            >
              Didn’t fit: <b style={{ color: 'var(--amber)' }}>{plan.unplaced.join(', ')}</b> — add a day or
              switch to a packed pace.
            </div>
          )}
        </>
      )}

      {!plan && !building && (
        <div
          className="grot"
          style={{
            border: '1px dashed var(--lineB)',
            borderRadius: 16,
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--soft)',
            fontSize: 15,
          }}
        >
          Your concierge is ready.
          <br />
          <span style={{ fontSize: 12, fontFamily: "'Outfit', system-ui, sans-serif" }}>
            Generate a plan with real clock times, travel legs and opening hours.
          </span>
        </div>
      )}
    </>
  );
}
