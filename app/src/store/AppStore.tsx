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
import {
  SETTLEMENT_CATEGORY,
  isValidAmount,
  potShortfalls,
  summarizeLedger,
  toCents,
  withdrawable,
} from '../engine/ledger';
import type { LedgerSummary, Transfer } from '../engine/ledger';
import * as seed from '../engine/seed';
import {
  ApiError,
  apiAcceptInvite,
  apiAddExpense,
  apiAddMember,
  apiAddSpot,
  apiCastVote,
  apiContribute,
  apiCreateInvite,
  apiDeleteAccount,
  apiDemoAuth,
  apiGetTrip,
  apiHealthy,
  apiListTrips,
  apiMagicRequest,
  apiMagicVerify,
  apiMe,
  apiScan,
  apiWithdraw,
  isInviteCode,
  getApiToken,
  setApiToken,
} from '../lib/api';
import { fireConfetti } from '../lib/confetti';
import { money } from '../lib/money';
import { sanitizeImportText } from '../lib/sanitize';
import { isBool, isSessionToken, isShortString, isStringArray, load, save } from '../lib/storage';
import type {
  ActivityItem,
  Expense,
  FundEntry,
  Listing,
  Member,
  MemberId,
  Pace,
  Payer,
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

/** Bound feed growth under spam / stress so session state cannot run away. */
const ACTIVITY_CAP = 40;
const ADDED_IDS_CAP = 200;

export interface ExpenseOpts {
  category?: string;
  paidBy?: Payer;
  splitWith?: MemberId[];
}

const sameId = (a: MemberId, b: MemberId) => String(a) === String(b);

function prependActivity(prev: ActivityItem[], item: ActivityItem): ActivityItem[] {
  return [item, ...prev].slice(0, ACTIVITY_CAP);
}

function appendAddedId(prev: string[], name: string): string[] {
  const next = prev.includes(name) ? prev : [...prev, name];
  return next.length > ADDED_IDS_CAP ? next.slice(-ADDED_IDS_CAP) : next;
}

interface AppStore {
  /* appearance */
  light: boolean;
  toggleTheme: () => void;

  /* onboarding */
  onboarded: boolean;
  finishOnboarding: (hiveName?: string) => void;
  replayOnboarding: () => void;
  /** Creates a real API session when the backend is up; no-ops offline. */
  authenticate: (
    provider: 'apple' | 'google' | 'email' | 'phone',
    opts?: { name?: string; contact?: string }
  ) => Promise<void>;
  /** Accept an OAuth redirect token from the URL (if present) and hydrate. */
  acceptAuthToken: (token: string) => Promise<void>;
  /**
   * Passwordless email. 'sent' = check your inbox; 'signed-in' = the API handed
   * back a dev link and the session is open; 'offline' = no API, use the demo path.
   */
  signInWithMagic: (email: string, name?: string) => Promise<'sent' | 'signed-in' | 'offline'>;
  /** Permanently delete the signed-in account (App Store + GDPR requirement). */
  deleteAccount: () => Promise<void>;
  /** Invite code captured from a `?invite=` link, waiting for a live session. */
  pendingInvite: string;
  joinInvite: (code: string) => Promise<void>;
  /** Fetch (and cache) the share link for a placeholder member. */
  inviteLinkFor: (memberId?: MemberId) => Promise<string | null>;
  /** True when votes/members/scan go through server-enforced ACL. */
  apiLive: boolean;

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
  /** Shared pot — every contribution and withdrawal, per member. */
  fund: FundEntry[];
  /** Pot, envelopes, IOU balances and the settle-up plan, derived from the books. */
  ledger: LedgerSummary;
  /** The member acting in this session (owner in demo mode, the signed-in user when live). */
  meId: MemberId;
  activity: ActivityItem[];
  nest: Listing[];
  table: Restaurant[];

  /* trip interactions */
  addedIds: string[];
  setTier: (id: number, tier: Tier) => void;
  addSpotFromScan: (candidate: ScanCandidate, source: string) => void;
  /** Logs a split expense; false when it was refused (bad amount, pot shortfall). */
  addExpense: (label: string, amount: number, opts?: ExpenseOpts) => boolean;
  /** Put your own money into the pot. */
  contribute: (amount: number) => boolean;
  /** Take out up to what you put in — never anyone else's money. */
  withdraw: (amount: number) => boolean;
  /** Record a suggested transfer as paid, netting both balances. */
  settle: (t: Transfer) => void;
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
  const [fund, setFund] = useState<FundEntry[]>(() => seed.fund.map((f) => ({ ...f })));
  const [meId, setMeId] = useState<MemberId>(seed.members[0].id);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  // `?invite=CODE` survives onboarding and OAuth redirects via validated storage.
  const [pendingInvite, setPendingInvite] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('invite');
    return isInviteCode(fromUrl) ? fromUrl : load('pendingInvite', '', isInviteCode);
  });
  useEffect(() => save('pendingInvite', pendingInvite), [pendingInvite]);
  const [activity, setActivity] = useState<ActivityItem[]>(() => seed.activity.slice());
  const [nest, setNest] = useState<Listing[]>(cloneNest);
  const [table] = useState<Restaurant[]>(() => seed.table.map((t) => ({ ...t })));
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [apiLive, setApiLive] = useState(false);
  const [apiTripId, setApiTripId] = useState<string | null>(null);
  const [tripMeta, setTripMeta] = useState<Trip>(() => ({ ...seed.trip }));

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
  const apiTripIdRef = useRef<string | null>(null);
  const apiLiveRef = useRef(false);

  // The build runs on a timer, so it needs the spot list as of the moment it
  // finishes rather than the one captured when the button was tapped.
  const spotsRef = useRef(spots);
  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);
  useEffect(() => {
    apiTripIdRef.current = apiTripId;
  }, [apiTripId]);
  useEffect(() => {
    apiLiveRef.current = apiLive;
  }, [apiLive]);

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

  const hydrateFromApi = useCallback(async (tripId: string) => {
    const data = await apiGetTrip(tripId);
    setApiTripId(tripId);
    setApiLive(true);
    setTripMeta({
      ...seed.trip,
      id: Number(data.trip.id) || seed.trip.id,
      name: data.trip.name,
      city: data.trip.city,
      lat: data.trip.lat,
      lng: data.trip.lng,
    });
    setSpots(data.spots.map((s) => ({ ...s })));
    // Server member ids are user ids — keep them so the ledger keys line up.
    setMembers(data.members.map((m) => ({ id: m.id, name: m.name, color: m.color })));
    setFund((data.fund || []).map((f) => ({ ...f })));
    if (data.trip.expenses) setExpenses(data.trip.expenses.map((e) => ({ ...e })));
    setInviteLinks({});
    if (data.me) {
      setMeId(data.me);
      return;
    }
    try {
      const { user } = await apiMe();
      setMeId(user.id);
    } catch {
      // Stay on the demo identity; money actions will simply be refused server-side.
    }
  }, []);

  const signInWithMagic = useCallback(
    async (email: string, name?: string): Promise<'sent' | 'signed-in' | 'offline'> => {
      if (!(await apiHealthy())) return 'offline';
      try {
        const r = await apiMagicRequest(email, name);
        if (!r.devLink) return 'sent';
        // No mail provider on this host: the API hands the link straight back.
        const token = new URL(r.devLink).searchParams.get('token') || '';
        await apiMagicVerify(token);
        const { trips } = await apiListTrips();
        if (trips[0]) await hydrateFromApi(trips[0].id);
        return 'signed-in';
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'auth_failed';
        say(code === 'mail_not_configured' ? 'Email sign-in is not set up on this server yet' : 'Sign-in failed (' + code + ')');
        return 'offline';
      }
    },
    [hydrateFromApi, say]
  );

  const joinInvite = useCallback(
    async (code: string) => {
      if (!isInviteCode(code)) return;
      try {
        const r = await apiAcceptInvite(code);
        await hydrateFromApi(r.trip.id);
        setPendingInvite('');
        say(r.joined ? 'You joined ' + r.trip.name + ' 🐝' : 'You’re already in ' + r.trip.name);
      } catch (e) {
        const code2 = e instanceof ApiError ? e.code : 'network';
        if (code2 === 'invite_expired' || code2 === 'invite_used') say('That invite link has already been used');
        else if (code2 === 'invite_not_found') say('Invite not found');
        else if (code2 === 'unauthorized') return; // keep it pending until sign-in completes
        else say('Could not join (' + code2 + ')');
        if (code2 !== 'unauthorized' && code2 !== 'network') setPendingInvite('');
      }
    },
    [hydrateFromApi, say]
  );

  // Once a real session exists, redeem the pending invite.
  useEffect(() => {
    if (apiLive && pendingInvite) void joinInvite(pendingInvite);
  }, [apiLive, pendingInvite, joinInvite]);

  const inviteLinkFor = useCallback(
    async (memberId?: MemberId) => {
      const tripId = apiTripIdRef.current;
      if (!apiLiveRef.current || !tripId) {
        say('Invite links need a signed-in hive — email sign-in opens one');
        return null;
      }
      const key = memberId === undefined ? '*' : String(memberId);
      if (inviteLinks[key]) return inviteLinks[key];
      try {
        // A hive-wide link should admit the whole crew, not just the first tap.
        const { url } = await apiCreateInvite(tripId, memberId === undefined ? { maxUses: 50 } : { memberId });
        setInviteLinks((prev) => ({ ...prev, [key]: url }));
        return url;
      } catch (e) {
        say(e instanceof ApiError && e.code === 'already_joined' ? 'They already joined' : 'Could not create invite link');
        return null;
      }
    },
    [inviteLinks, say]
  );

  const deleteAccount = useCallback(async () => {
    try {
      await apiDeleteAccount();
    } catch {
      say('Could not delete the account — try again');
      return;
    }
    // Everything about this person is gone server-side; start the app clean.
    save('pendingInvite', '');
    window.location.assign(window.location.pathname + '?start=onboarding');
  }, [say]);

  // Resume a prior session when the API is up; otherwise stay on seed fixtures.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const healthy = await apiHealthy();
      if (cancelled || !healthy) return;
      const token = getApiToken();
      if (!token) {
        setApiLive(false);
        return;
      }
      try {
        const { trips } = await apiListTrips();
        if (cancelled || !trips.length) return;
        await hydrateFromApi(trips[0].id);
      } catch {
        if (!cancelled) setApiLive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromApi]);

  const authenticate = useCallback(
    async (
      provider: 'apple' | 'google' | 'email' | 'phone',
      opts?: { name?: string; contact?: string }
    ) => {
      try {
        const healthy = await apiHealthy();
        if (!healthy) return;
        await apiDemoAuth(provider, opts);
        const { trips } = await apiListTrips();
        if (trips[0]) await hydrateFromApi(trips[0].id);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'auth_failed';
        say('Sign-in unavailable (' + code + ') — continuing offline');
      }
    },
    [hydrateFromApi, say]
  );

  const acceptAuthToken = useCallback(
    async (token: string) => {
      if (!isSessionToken(token)) return;
      setApiToken(token);
      try {
        const healthy = await apiHealthy();
        if (!healthy) return;
        const { trips } = await apiListTrips();
        if (trips[0]) await hydrateFromApi(trips[0].id);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'auth_failed';
        say('Session restore failed (' + code + ')');
      }
    },
    [hydrateFromApi, say]
  );

  const setTier = useCallback(
    (id: number, tier: Tier) => {
      const tripId = apiTripIdRef.current;
      if (apiLiveRef.current && tripId) {
        void (async () => {
          try {
            const current = spotsRef.current.find((s) => s.id === id);
            const nextTier = current?.tier === tier ? null : tier;
            const { spot } = await apiCastVote(tripId, id, nextTier);
            setSpots((prev) => prev.map((sp) => (sp.id === id ? { ...spot } : sp)));
            if (nextTier === 'must') {
              fireConfetti();
              say('Locked in as a must-do ★');
            }
          } catch (e) {
            say(e instanceof ApiError && e.code === 'forbidden' ? 'Not a hive member' : 'Vote failed');
          }
        })();
        return;
      }
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
      const tripId = apiTripIdRef.current;
      if (apiLiveRef.current && tripId) {
        void (async () => {
          try {
            const { spot } = await apiAddSpot(tripId, c, source);
            setSpots((prev) => [...prev, spot]);
            setAddedIds((prev) => appendAddedId(prev, c.name));
            setActivity((prev) =>
              prependActivity(prev, { who: 'You', what: 'imported ' + c.name, when: 'just now' })
            );
            say('Saved to ' + tripMeta.name);
          } catch {
            say('Could not save spot');
          }
        })();
        return;
      }
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
      setAddedIds((prev) => appendAddedId(prev, c.name));
      setActivity((prev) =>
        prependActivity(prev, { who: 'You', what: 'imported ' + c.name, when: 'just now' })
      );
      say('Saved to ' + tripMeta.name);
    },
    [say, tripMeta.name]
  );

  const scan = useCallback(() => {
    const cleaned = sanitizeImportText(scanText);
    if (!cleaned) {
      say('Paste a link or caption first');
      return;
    }
    setScanning(true);
    setScanResult(null);
    window.clearTimeout(scanTimer.current);

    const tripId = apiTripIdRef.current;
    if (apiLiveRef.current && tripId) {
      void (async () => {
        try {
          const result = await apiScan(tripId, cleaned);
          setScanResult({ source: result.source, candidates: result.candidates });
        } catch (e) {
          if (e instanceof ApiError && e.status === 429) {
            say('Scan limit reached — try again shortly');
          } else {
            say('Scan failed');
          }
        } finally {
          setScanning(false);
        }
      })();
      return;
    }

    scanTimer.current = window.setTimeout(() => {
      setScanResult(
        scanImport(cleaned, {
          city: tripMeta.city,
          lat: tripMeta.lat || seed.TOKYO_CENTER[0],
          lng: tripMeta.lng || seed.TOKYO_CENTER[1],
        })
      );
      setScanning(false);
    }, SCAN_MS);
  }, [scanText, say, tripMeta.city, tripMeta.lat, tripMeta.lng]);

  /* ── money: shared pot + splitting ────────────────────────── */
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const ledger = useMemo(
    () => summarizeLedger(memberIds, expenses, fund, meId),
    [memberIds, expenses, fund, meId]
  );

  const nameOf = useCallback(
    (id: MemberId) => members.find((m) => sameId(m.id, id))?.name ?? 'Someone',
    [members]
  );

  const shortfallMessage = useCallback(
    (short: Array<{ memberId: MemberId; short: number }>) => {
      const first = short[0];
      const more = short.length > 1 ? ` (+${short.length - 1} more)` : '';
      return `${nameOf(first.memberId)} is $${money(first.short)} short of their share${more} — top up the pot first`;
    },
    [nameOf]
  );

  const envelopeMessage = (limit: number) =>
    limit > 0
      ? `You can take out up to $${money(limit)} — only what you put in`
      : 'Nothing of yours is in the pot — only what you put in can come out';

  const applyBooks = useCallback((p: { fund: FundEntry[]; expenses: Expense[] }) => {
    setFund(p.fund.map((f) => ({ ...f })));
    setExpenses(p.expenses.map((e) => ({ ...e })));
  }, []);

  const moneyError = useCallback(
    (e: unknown, fallback: string) => {
      if (!(e instanceof ApiError)) return fallback;
      if (e.code === 'forbidden') return 'Not a hive member';
      if (e.code === 'exceeds_envelope') return envelopeMessage(Number(e.data.withdrawable) || 0);
      if (e.code === 'pot_shortfall' && Array.isArray(e.data.shortfalls)) {
        return shortfallMessage(e.data.shortfalls as Array<{ memberId: MemberId; short: number }>);
      }
      return fallback;
    },
    [shortfallMessage]
  );

  const addExpense = useCallback(
    (label: string, amount: number, opts: ExpenseOpts = {}) => {
      if (!isValidAmount(amount)) {
        say('Enter a valid amount');
        return false;
      }
      const paidBy: Payer = opts.paidBy ?? meId;
      const chosen = (opts.splitWith ?? memberIds).filter((id) => memberIds.some((x) => sameId(x, id)));
      const draft: Expense = {
        id: nextId.current++,
        label,
        category: opts.category ?? 'other',
        amount,
        paidBy,
        splitWith: chosen.length ? chosen : memberIds,
      };
      if (paidBy === 'pot') {
        const short = potShortfalls(draft, memberIds, expenses, fund, meId);
        if (short.length) {
          say(shortfallMessage(short));
          return false;
        }
      }
      const settled = draft.category === SETTLEMENT_CATEGORY;
      const done = () => {
        say(settled ? 'Marked as settled' : 'Expense logged');
        setActivity((prev) =>
          prependActivity(prev, {
            who: 'You',
            what: settled ? 'settled up: ' + label : `logged ${label} · $${money(amount)}`,
            when: 'just now',
          })
        );
      };
      const tripId = apiTripIdRef.current;
      if (apiLiveRef.current && tripId) {
        void (async () => {
          try {
            applyBooks(
              await apiAddExpense(tripId, {
                label,
                amount,
                category: draft.category,
                paidBy,
                splitWith: draft.splitWith,
              })
            );
            done();
          } catch (e) {
            say(moneyError(e, 'Could not log expense'));
          }
        })();
        return true;
      }
      setExpenses((prev) => [...prev, draft]);
      done();
      return true;
    },
    [applyBooks, expenses, fund, meId, memberIds, moneyError, say, shortfallMessage]
  );

  const contribute = useCallback(
    (amount: number) => {
      if (!isValidAmount(amount)) {
        say('Enter a valid amount');
        return false;
      }
      const done = () => {
        say(`Added $${money(amount)} to the pot`);
        setActivity((prev) =>
          prependActivity(prev, { who: 'You', what: `added $${money(amount)} to the pot`, when: 'just now' })
        );
      };
      const tripId = apiTripIdRef.current;
      if (apiLiveRef.current && tripId) {
        void (async () => {
          try {
            applyBooks(await apiContribute(tripId, amount));
            done();
          } catch (e) {
            say(moneyError(e, 'Could not add to the pot'));
          }
        })();
        return true;
      }
      setFund((prev) => [
        ...prev,
        { id: nextId.current++, memberId: meId, kind: 'contribution', amount, at: new Date().toISOString() },
      ]);
      done();
      return true;
    },
    [applyBooks, meId, moneyError, say]
  );

  const withdraw = useCallback(
    (amount: number) => {
      if (!isValidAmount(amount)) {
        say('Enter a valid amount');
        return false;
      }
      // Client-side guard for instant feedback; the server re-checks when live.
      const limit = withdrawable(meId, memberIds, expenses, fund, meId);
      if (toCents(amount) > toCents(limit)) {
        say(envelopeMessage(limit));
        return false;
      }
      const done = () => {
        say(`Took $${money(amount)} out of the pot`);
        setActivity((prev) =>
          prependActivity(prev, { who: 'You', what: `took $${money(amount)} out of the pot`, when: 'just now' })
        );
      };
      const tripId = apiTripIdRef.current;
      if (apiLiveRef.current && tripId) {
        void (async () => {
          try {
            applyBooks(await apiWithdraw(tripId, amount));
            done();
          } catch (e) {
            say(moneyError(e, 'Could not take money out'));
          }
        })();
        return true;
      }
      setFund((prev) => [
        ...prev,
        { id: nextId.current++, memberId: meId, kind: 'withdrawal', amount, at: new Date().toISOString() },
      ]);
      done();
      return true;
    },
    [applyBooks, expenses, fund, meId, memberIds, moneyError, say]
  );

  const settle = useCallback(
    (t: Transfer) => {
      addExpense(`${nameOf(t.from)} paid ${nameOf(t.to)}`, t.amount, {
        category: SETTLEMENT_CATEGORY,
        paidBy: t.from,
        splitWith: [t.to],
      });
    },
    [addExpense, nameOf]
  );

  const addMember = useCallback(
    (name: string) => {
      const tripId = apiTripIdRef.current;
      if (apiLiveRef.current && tripId) {
        void (async () => {
          try {
            const { member, url } = await apiAddMember(tripId, name);
            setMembers((prev) => [
              ...prev,
              {
                id: member.id, // server member id — must match the ledger keys
                name: member.name,
                color: member.color,
              },
            ]);
            if (url) setInviteLinks((prev) => ({ ...prev, [String(member.id)]: url }));
            setActivity((prev) =>
              prependActivity(prev, {
                who: 'You',
                what: 'invited ' + name + ' to the hive',
                when: 'just now',
              })
            );
            say(name + ' invited');
          } catch (e) {
            say(e instanceof ApiError && e.code === 'forbidden' ? 'Not a hive member' : 'Invite failed');
          }
        })();
        return;
      }
      setMembers((prev) => [...prev, { id: Date.now(), name, color: '#60A5FA' }]);
      setActivity((prev) =>
        prependActivity(prev, {
          who: 'You',
          what: 'invited ' + name + ' to the hive',
          when: 'just now',
        })
      );
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
      authenticate,
      acceptAuthToken,
      signInWithMagic,
      deleteAccount,
      pendingInvite,
      joinInvite,
      inviteLinkFor,
      apiLive,
      tab,
      setTab,
      tripView,
      setTripView,
      trip: tripMeta,
      spots,
      expenses,
      members,
      fund,
      ledger,
      meId,
      activity,
      nest,
      table,
      addedIds,
      setTier,
      addSpotFromScan,
      addExpense,
      contribute,
      withdraw,
      settle,
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
      light, onboarded, finishOnboarding, replayOnboarding, authenticate, acceptAuthToken, apiLive, tab, tripView,
      signInWithMagic, deleteAccount, pendingInvite, joinInvite, inviteLinkFor,
      tripMeta, spots, expenses, members, fund, ledger, meId, activity, nest, table, addedIds,
      setTier, addSpotFromScan, addExpense, contribute, withdraw, settle, addMember, toggleReaction,
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
