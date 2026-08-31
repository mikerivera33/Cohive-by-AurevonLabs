import { chipStyle, press } from '../../lib/styles';
import { useApp } from '../../store/AppStore';
import type { TripView } from '../../types';

import { BudgetView } from './BudgetView';
import { CrewView } from './CrewView';
import { PlanView } from './PlanView';
import { SpotsView } from './SpotsView';
import { TripMapView } from './TripMapView';

const VIEWS: TripView[] = ['map', 'spots', 'plan', 'budget', 'crew'];

export function TripTab() {
  const { spots, tripView, setTripView } = useApp();

  return (
    <div style={{ animation: 'cvrise .4s cubic-bezier(.2,.9,.25,1.1) both' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: '4px 0 3px' }}>
        <h1 className="grot" style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-.03em', margin: 0 }}>
          Tokyo Adventure
        </h1>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--honey)',
          }}
        >
          Bucketlist
        </span>
      </div>
      <p style={{ color: 'var(--soft)', fontSize: 12.5, margin: '0 0 14px' }}>
        Sep 1–4 · 3 in the hive · {spots.length} spots saved
      </p>

      <div
        style={{
          display: 'flex',
          gap: 6,
          background: 'var(--panelS)',
          border: '1px solid var(--line)',
          borderRadius: 99,
          padding: 4,
          marginBottom: 16,
          overflowX: 'auto',
        }}
      >
        {VIEWS.map((id) => (
          <button
            key={id}
            className="press"
            onClick={() => setTripView(id)}
            aria-pressed={tripView === id}
            style={{
              ...chipStyle(tripView === id),
              ...press(0.95),
              flexShrink: 0,
              padding: '8px 14px',
            }}
          >
            {id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>

      {tripView === 'map' && <TripMapView />}
      {tripView === 'spots' && <SpotsView />}
      {tripView === 'plan' && <PlanView />}
      {tripView === 'budget' && <BudgetView />}
      {tripView === 'crew' && <CrewView />}
    </div>
  );
}
