export type Category =
  | 'food'
  | 'sight'
  | 'nature'
  | 'museum'
  | 'nightlife'
  | 'shopping'
  | 'hotel';

/** Tiered voting: the engine treats `must` as a promise, `maybe` as a preference. */
export type Tier = 'must' | 'maybe' | 'iftime';

export type Pace = 'relaxed' | 'balanced' | 'packed';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Spot extends LatLng {
  id: number;
  name: string;
  category: Category;
  /** Minutes to spend there, before pace scaling. */
  duration: number;
  cost: number;
  rating: number;
  /** Opening hour as a decimal hour (17.5 = 17:30), or null when always open. */
  open: number | null;
  close: number | null;
  source: string;
  tier: Tier | null;
  votes: number;
  note: string;
  skipped?: boolean;
}

export interface Expense {
  id: number;
  label: string;
  category: string;
  amount: number;
}

export interface Trip extends LatLng {
  id: number;
  name: string;
  city: string;
  country: string;
  startDate: string;
  days: number;
  pace: Pace;
  startHour: number;
  endHour: number;
  budget: number;
  currency: string;
  expenses: Expense[];
}

export interface Member {
  id: number;
  name: string;
  color: string;
}

export interface ActivityItem {
  who: string;
  what: string;
  when: string;
}

export type ReactionEmoji = '💍' | '🪴';

export interface Listing extends LatLng {
  id: number;
  title: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  hood: string;
  source: string;
  note: string;
  reactions: Record<ReactionEmoji, string[]>;
  tagged: string | null;
}

export interface Restaurant extends LatLng {
  id: number;
  name: string;
  cuisine: string;
  mood: string;
  price: string;
  hood: string;
  hours: string;
  tried: boolean;
  tier: Tier;
}

export interface PlanVisit extends LatLng {
  type: 'visit';
  id: number;
  name: string;
  category: Category;
  /** "HH:MM" wall-clock. */
  start: string;
  end: string;
  minutes: number;
  cost: number;
  tier: Tier | null;
  votes: number;
  source: string;
}

export interface PlanTravel {
  type: 'travel';
  minutes: number;
  from: string;
  to: string;
}

export type PlanItem = PlanVisit | PlanTravel;

export interface PlanDay {
  day: number;
  items: PlanItem[];
  warnings: string[];
  cost: number;
}

export interface PlanOpts {
  days: number;
  pace: Pace;
  startHour: number;
  endHour: number;
}

export interface TripPlan {
  days: PlanDay[];
  unplaced: string[];
  totalCost: number;
  opts: PlanOpts;
  generatedAt: string;
}

export interface ScanCandidate extends LatLng {
  name: string;
  category: Category;
  duration: number;
  cost: number;
  open: number | null;
  close: number | null;
  confidence: number;
  matched: 'exact' | 'inferred' | 'assist';
  city?: string;
}

export type ScanSource =
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'listing'
  | 'dining'
  | 'web'
  | 'note';

export interface ScanResult {
  source: ScanSource;
  candidates: ScanCandidate[];
}

export interface ScanContext extends LatLng {
  city: string;
}

export type PlanTier = 'Free' | 'Cohive+' | 'Cohive+ Annual' | 'Platinum';

export type TabId = 'home' | 'trip' | 'nest' | 'table' | 'you';

export type TripView = 'map' | 'spots' | 'plan' | 'budget' | 'crew';
