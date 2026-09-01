import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { planTrip, scanImport } from '../engine/engine';
import * as seed from '../engine/seed';
import { fireConfetti } from '../lib/confetti';
import { isBool, isShortString, isStringArray, load, save } from '../lib/storage';
import type {
  ActivityItem,
  Expense,
  Listing,
  Member,
  Pace,
  PlanTier,
  ReactionEmoji,
  Category,
  Restaurant,
  ScanCandidate,
  ScanResult,
  Spot,
  TabId,
  Tier,
  Trip,
  TripPlan,
  TripView,
} from '../types';

/** Tiers that unlock account linking (chat 2: moved from Platinum to any paid tier). */
const CONNECTIONS_TIERS: PlanTier[] = ['Cohive+', 'Cohive+ Annual', 'Platinum'];
/** Tiers that unlock in-app booking — the Annual tier's headline promise. */
const BOOKING_TIERS: PlanTier[] = ['Cohive+ Annual', 'Platinum'];

const BUILD_STAGES = [
  'Reading the hive’s shortlist',
  'Clustering days by neighborhood',
  'Routing with real clock times',
  'Checking opening hours & meals',
  'Polishing the pass',
];

const STAGE_MS = 520;

/** How long the scanner spends "reading" before resolving. */
const SCAN_MS = 1100;

interface AppStore {
  /* appearance */
  light: boolean;
  toggleTheme: () => void;

  /* onboarding */
  onboarded: boolean;
  finishOnboarding: (hiveName?: string) => void;
  replayOnboarding: () => void;

  /* navigation */
  tab: TabId;
  setTab: (t: TabId) => void;
  tripView: TripView;
  setTripView: (v: TripView) => void;

  /* hive data */
  trip: Trip;
  spots: Spot[];
  expenses: Expense[];
  members: Member[];
  activity: ActivityItem[];
  nest: Listing[];
  table: Restaurant[];

  /* trip interactions */
  addedIds: string[];
  setTier: (id: number, tier: Tier) => void;
  addSpotFromScan: (candidate: ScanCandidate, source: string) => void;
  addExpense: (label: string, amount: number) => void;
  addMember: (name: string) => void;
  toggleReaction: (listingId: number, emoji: ReactionEmoji) => void;

  /* scanner — lives here so results survive switching sub-views */
  scanText: string;
  setScanText: (t: string) => void;
  scanning: boolean;
  scanResult: ScanResult | null;
  scan: () => void;

  /* list filters — persist across tab switches, as the design's single state did */
  catFilter: Category | 'all';
  setCatFilter: (c: Category | 'all') => void;
  tableFilter: string;
  setTableFilter: (f: string) => void;

  /* expense draft — survives an accidental tab flick */
  expLabel: string;
  setExpLabel: (v: string) => void;
  expAmt: string;
  setExpAmt: (v: string) => void;

  /* itinerary */
  planDays: number;
  setPlanDays: (n: number) => void;
  pace: Pace;
  setPace: (p: Pace) => void;
  plan: TripPlan | null;
  building: boolean;
  buildStage: number;
  buildStages: string[];
  generate: () => void;

  /* subscription */
  planTier: PlanTier;
  refCode: string;
  linked: string[];
  purchase: (tier: PlanTier) => void;
  toggleLink: (name: string) => void;
  connectionsUnlocked: boolean;
  bookingUnlocked: boolean;

  /* chrome */
  toast: string;
  say: (message: string) => void;
  pricingOpen: boolean;
  openPricing: () => void;
  closePricing: () => void;
  confetti: () => void;
}

const Ctx = createContext<AppStore | null>(null);

/** Deep-copies the seed so a session's edits never mutate the fixture module. */
function cloneNest(): Listing[] {
  return seed.nest.map((n) => ({
    ...n,
    reactions: { '💍': [...n.reactions['💍']], '🪴': [...n.reactions['🪴']] },
  }));
}

export function AppProvider({ children }: { children: ReactNode }) {
  /* ── appearance ───────────────────────────────────────────── */
  const [light, setLight] = useState<boolean>(() => load('light', false, isBool));
  useEffect(() => save('light', light), [light]);

  /* ── onboarding ───────────────────────────────────────────── */
  const [onboarded, setOnboarded] = useState<boolean>(() => {
    // `?start=app` / `?start=onboarding` mirrors the prototype's demo toggle.
    const start = new URLSearchParams(window.location.search).get('start');
    if (start === 'app') return true;
    if (start === 'onboarding') return false;
    return load('onboarded', false, isBool);
  });
  useEffect(() => save('onboarded', onboarded), [onboarded]);

  /* ── navigation ───────────────────────────────────────────── */
  const [tab, setTab] = useState<TabId>('home');
  const [tripView, setTripView] = useState<TripView>('map');

  /* ── hive data ────────────────────────────────────────────── */
  const [spots, setSpots] = useState<Spot[]>(() => seed.tripSpots.map((s) => ({ ...s })));
  const [expenses, setExpenses] = useState<Expense[]>(() =>
    seed.trip.expenses.map((e) => ({ ...e }))
  );
  const [members, setMembers] = useState<Member[]>(() => seed.members.map((m) => ({ ...m })));
  const [activity, setActivity] = useState<ActivityItem[]>(() => seed.activity.slice());
  const [nest, setNest] = useState<Listing[]>(cloneNest);
  const [table] = useState<Restaurant[]>(() => seed.table.map((t) => ({ ...t })));
  const [addedIds, setAddedIds] = useState<string[]>([]);

  /* ── scanner ──────────────────────────────────────────────── */
  const [scanText, setScanText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  /* ── filters + drafts ─────────────────────────────────────── */
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all');
  const [tableFilter, setTableFilter] = useState('All');
  const [expLabel, setExpLabel] = useState('');
  const [expAmt, setExpAmt] = useState('');

  /* ── itinerary ────────────────────────────────────────────── */
  const [planDays, setPlanDays] = useState(4);
  const [pace, setPace] = useState<Pace>('balanced');
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildStage, setBuildStage] = useState(-1);

  /* ── subscription ─────────────────────────────────────────── */
  const isTier = (v: unknown): v is PlanTier =>
    v === 'Free' || v === 'Cohive+' || v === 'Cohive+ Annual' || v === 'Platinum';
  const [planTier, setPlanTier] = useState<PlanTier>(() => load<PlanTier>('planTier', 'Free', isTier));
  const [refCode, setRefCode] = useState<string>(() => load('refCode', '', isShortString));
  const [linked, setLinked] = useState<string[]>(() => load<string[]>('linked', [], isStringArray));
  useEffect(() => save('planTier', planTier), [planTier]);
  useEffect(() => save('refCode', refCode), [refCode]);
  useEffect(() => save('linked', linked), [linked]);

  /* ── chrome ───────────────────────────────────────────────── */
  const [toast, setToast] = useState('');
  const [pricingOpen, setPricingOpen] = useState(false);

  const nextId = useRef(500);
  const toastTimer = useRef<number | undefined>(undefined);
  const buildTimer = useRef<number | undefined>(undefined);
  const scanTimer = useRef<number | undefined>(undefined);

  // The build runs on a timer, so it needs the spot list as of the moment it
  // finishes rather than the one captured when the button was tapped.
  const spotsRef = useRef(spots);
  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(buildTimer.current);
      window.clearTimeout(scanTimer.current);
    },
    []
  );

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2200);
  }, []);

  const setTier = useCallback(
    (id: number, tier: Tier) => {
      setSpots((prev) =>
        prev.map((sp) =>
          sp.id === id
            ? {
                ...sp,
                // Tapping the active tier clears it; the vote already cast stands.
                tier: sp.tier === tier ? null : tier,
                votes: sp.tier === tier ? sp.votes : sp.votes + 1,
              }
            : sp
        )
      );
      if (tier === 'must') {
        fireConfetti();
        say('Locked in as a must-do ★');
      }
    },
    [say]
  );

  const addSpotFromScan = useCallback(
    (c: ScanCandidate, source: string) => {
      setSpots((prev) => [
        ...prev,
        {
          id: nextId.current++,
          name: c.name,
          category: c.category,
          lat: c.lat,
          lng: c.lng,
          duration: c.duration || 60,
          cost: c.cost || 0,
          rating: 4,
          open: c.open ?? null,
          close: c.close ?? null,
          source,
          tier: null,
          votes: 0,
          note: c.matched === 'exact' ? '' : 'Confirmed from scan',
        },
      ]);
      setAddedIds((prev) => [...prev, c.name]);
      setActivity((prev) => [
        { who: 'You', what: 'imported ' + c.name, when: 'just now' },
        ...prev,
      ]);
      say('Saved to ' + seed.trip.name);
    },
    [say]
  );

  const scan = useCallback(() => {
    const txt = scanText.trim();
    if (!txt) {
      say('Paste a link or caption first');
      return;
    }
    setScanning(true);
    setScanResult(null);
    window.clearTimeout(scanTimer.current);
    scanTimer.current = window.setTimeout(() => {
      setScanResult(
        scanImport(txt, {
          city: seed.trip.city,
          lat: seed.TOKYO_CENTER[0],
          lng: seed.TOKYO_CENTER[1],
        })
      );
      setScanning(false);
    }, SCAN_MS);
  }, [scanText, say]);

  const addExpense = useCallback(
    (label: string, amount: number) => {
      setExpenses((prev) => [
        ...prev,
        { id: Date.now(), label, category: 'other', amount },
      ]);
      say('Expense logged');
    },
    [say]
  );

  const addMember = useCallback(
    (name: string) => {
      setMembers((prev) => [...prev, { id: Date.now(), name, color: '#60A5FA' }]);
      setActivity((prev) => [
        { who: 'You', what: 'invited ' + name + ' to the hive', when: 'just now' },
        ...prev,
      ]);
      say(name + ' invited');
    },
    [say]
  );

  const toggleReaction = useCallback((listingId: number, emoji: ReactionEmoji) => {
    let added = false;
    setNest((prev) =>
      prev.map((x) => {
        if (x.id !== listingId) return x;
        const mine = x.reactions[emoji].includes('You');
        added = !mine;
        return {
          ...x,
          reactions: {
            ...x.reactions,
            [emoji]: mine
              ? x.reactions[emoji].filter((p) => p !== 'You')
              : [...x.reactions[emoji], 'You'],
          },
        };
      })
    );
    if (added) fireConfetti();
  }, []);

  const generate = useCallback(() => {
    if (building) return;
    setBuilding(true);
    setBuildStage(0);
    setPlan(null);

    let i = 0;
    const tick = () => {
      i++;
      if (i < BUILD_STAGES.length) {
        setBuildStage(i);
        buildTimer.current = window.setTimeout(tick, STAGE_MS);
      } else {
        setPlan(
          planTrip(spotsRef.current, {
            days: Math.max(1, Math.min(10, planDays)),
            pace,
            startHour: seed.trip.startHour,
            endHour: seed.trip.endHour,
          })
        );
        setBuilding(false);
        say('Itinerary ready — every must-do placed');
      }
    };
    buildTimer.current = window.setTimeout(tick, STAGE_MS);
  }, [building, planDays, pace, say]);

  const purchase = useCallback(
    (tier: PlanTier) => {
      setPricingOpen(false);
      if (tier === 'Free') {
        setPlanTier('Free');
        say('You’re on Free');
        return;
      }
      setPlanTier(tier);
      // Permanent, non-expirable — generated once and never regenerated.
      setRefCode(
        (prev) => prev || 'MIKE-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '10'
      );
      say(tier + ' active — your referral code is live (demo, nothing charged)');
    },
    [say]
  );

  const toggleLink = useCallback(
    (name: string) => {
      let connected = false;
      setLinked((prev) => {
        const on = prev.includes(name);
        connected = !on;
        return on ? prev.filter((x) => x !== name) : [...prev, name];
      });
      say(connected ? name + ' connected' : name + ' disconnected');
    },
    [say]
  );

  const finishOnboarding = useCallback(
    (hiveName?: string) => {
      setOnboarded(true);
      if (hiveName !== undefined) say('Welcome to ' + (hiveName.trim() || 'your hive'));
    },
    [say]
  );

  const replayOnboarding = useCallback(() => setOnboarded(false), []);

  const value = useMemo<AppStore>(
    () => ({
      light,
      toggleTheme: () => setLight((v) => !v),
      onboarded,
      finishOnboarding,
      replayOnboarding,
      tab,
      setTab,
      tripView,
      setTripView,
      trip: seed.trip,
      spots,
      expenses,
      members,
      activity,
      nest,
      table,
      addedIds,
      setTier,
      addSpotFromScan,
      addExpense,
      addMember,
      toggleReaction,
      scanText,
      setScanText,
      scanning,
      scanResult,
      scan,
      catFilter,
      setCatFilter,
      tableFilter,
      setTableFilter,
      expLabel,
      setExpLabel,
      expAmt,
      setExpAmt,
      planDays,
      setPlanDays,
      pace,
      setPace,
      plan,
      building,
      buildStage,
      buildStages: BUILD_STAGES,
      generate,
      planTier,
      refCode,
      linked,
      purchase,
      toggleLink,
      connectionsUnlocked: CONNECTIONS_TIERS.includes(planTier),
      bookingUnlocked: BOOKING_TIERS.includes(planTier),
      toast,
      say,
      pricingOpen,
      openPricing: () => setPricingOpen(true),
      closePricing: () => setPricingOpen(false),
      confetti: fireConfetti,
    }),
    [
      light, onboarded, finishOnboarding, replayOnboarding, tab, tripView,
      spots, expenses, members, activity, nest, table, addedIds,
      setTier, addSpotFromScan, addExpense, addMember, toggleReaction,
      scanText, scanning, scanResult, scan,
      catFilter, tableFilter, expLabel, expAmt,
      planDays, pace, plan, building, buildStage, generate,
      planTier, refCode, linked, purchase, toggleLink,
      toast, say, pricingOpen,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
