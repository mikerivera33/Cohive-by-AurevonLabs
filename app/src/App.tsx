import { useEffect, useRef } from 'react';

import { AppHeader } from './components/AppHeader';
import { DeviceFrame } from './components/DeviceFrame';
import { PricingSheet } from './components/PricingSheet';
import { TabBar } from './components/TabBar';
import { Toast } from './components/Toast';
import { HomeTab } from './screens/HomeTab';
import { NestTab } from './screens/NestTab';
import { Onboarding } from './screens/Onboarding';
import { TableTab } from './screens/TableTab';
import { TripTab } from './screens/trip/TripTab';
import { YouTab } from './screens/YouTab';
import { AppProvider, useApp } from './store/AppStore';

function Shell() {
  const { light, onboarded, tab, tripView, toast } = useApp();
  const scrollRef = useRef<HTMLElement>(null);

  // Keep the browser chrome in step with the in-app theme.
  useEffect(() => {
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', light ? '#EEF5FC' : '#060B18');
  }, [light]);

  // Switching tab or trip sub-view should start at the top, not mid-scroll.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab, tripView]);

  return (
    <DeviceFrame dark={!light}>
      <div
          className={'cv' + (light ? ' light' : '')}
          id="cv-shell"
          style={{
            position: 'relative',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg)',
            color: 'var(--ink)',
            fontFamily: "'Outfit', system-ui, sans-serif",
            overflow: 'hidden',
          }}
        >
        <div className="cv-atmosphere" aria-hidden>
          <div className="cv-atmosphere__orb" />
        </div>

        {!onboarded && <Onboarding />}

        {onboarded && (
          <>
            <AppHeader />

            <main
              ref={scrollRef}
              id="cv-scroll"
              style={{
                flex: 1,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                padding: '16px 18px 130px',
                position: 'relative',
                zIndex: 1,
              }}
            >
              <div key={tab + ':' + tripView} className="tabPane">
                {tab === 'home' && <HomeTab />}
                {tab === 'trip' && <TripTab />}
                {tab === 'nest' && <NestTab />}
                {tab === 'table' && <TableTab />}
                {tab === 'you' && <YouTab />}
              </div>
            </main>

            <TabBar />
            <PricingSheet />
            <Toast message={toast} />
          </>
        )}
      </div>
    </DeviceFrame>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
