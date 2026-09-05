/**
 * Demo seed — Tokyo trip carried over verbatim from mikerivera33/rhyme-plus
 * `lib/seed.js` (tiers mapped from the original mustDo/votes fields), plus the
 * Nest and Table demo hives added for Cohive.
 *
 * Everything here is fixture data. Swap this module for API calls when the
 * backend lands; nothing else in the app reads these constants directly.
 */
import type {
  ActivityItem,
  Category,
  Listing,
  Member,
  Restaurant,
  Spot,
  Tier,
  Trip,
} from '../types';

let nid = 100;

interface SpotOpts {
  dur: number;
  cost?: number;
  rating?: number;
  open?: number | null;
  close?: number | null;
  source?: string;
  tier?: Tier;
  votes?: number;
  note?: string;
}

const sp = (
  name: string,
  category: Category,
  lat: number,
  lng: number,
  o: SpotOpts
): Spot => ({
  id: nid++,
  name,
  category,
  lat,
  lng,
  duration: o.dur,
  cost: o.cost || 0,
  rating: o.rating || 4,
  open: o.open ?? null,
  close: o.close ?? null,
  source: o.source || 'manual',
  tier: o.tier || null,
  votes: o.votes || 0,
  note: o.note || '',
});

export const tripSpots: Spot[] = [
  sp('Senso-ji Temple', 'sight', 35.7148, 139.7967, {
    dur: 75, open: 6, close: 17, rating: 5, tier: 'must', votes: 3, source: 'tiktok',
    note: 'Go early, Nakamise street gets packed',
  }),
  sp('Shibuya Crossing', 'sight', 35.6595, 139.7005, {
    dur: 40, rating: 5, tier: 'maybe', votes: 2, source: 'instagram',
  }),
  sp('Meiji Shrine', 'nature', 35.6764, 139.6993, {
    dur: 80, open: 5, close: 18, rating: 5, votes: 1, tier: 'maybe', source: 'instagram',
  }),
  sp('teamLab Planets', 'museum', 35.6491, 139.7898, {
    dur: 120, open: 9, close: 22, cost: 27, rating: 5, tier: 'must', votes: 4, source: 'tiktok',
    note: 'Book tickets ahead',
  }),
  sp('Tsukiji Outer Market', 'food', 35.6654, 139.7707, {
    dur: 90, open: 7, close: 14, cost: 20, rating: 5, votes: 2, tier: 'must', source: 'tiktok',
    note: 'Tamagoyaki + tuna bowls',
  }),
  sp('Shinjuku Gyoen', 'nature', 35.6852, 139.71, {
    dur: 90, open: 9, close: 17.5, cost: 4, rating: 4, tier: 'iftime', source: 'maps',
  }),
  sp('Golden Gai', 'nightlife', 35.6944, 139.7046, {
    dur: 90, open: 19, close: 26, cost: 25, rating: 4, votes: 1, tier: 'maybe', source: 'instagram',
  }),
  sp('Akihabara Electric Town', 'shopping', 35.7022, 139.7745, {
    dur: 100, open: 10, close: 20, rating: 4, tier: 'iftime', source: 'maps',
  }),
  sp('Ueno Park & Museums', 'nature', 35.7156, 139.7745, {
    dur: 90, open: 5, close: 23, rating: 4, source: 'maps',
  }),
  sp('Nakameguro Canal', 'sight', 35.644, 139.6982, {
    dur: 60, rating: 4, tier: 'maybe', source: 'instagram',
  }),
  sp('Takeshita Street', 'shopping', 35.6716, 139.7031, {
    dur: 60, open: 10, close: 20, cost: 15, rating: 3, tier: 'iftime', source: 'tiktok',
  }),
  sp('Ichiran Ramen Shibuya', 'food', 35.6613, 139.7003, {
    dur: 45, open: 10, close: 22, cost: 12, rating: 4, votes: 2, tier: 'maybe', source: 'tiktok',
  }),
  sp('Shinjuku Omoide Yokocho', 'food', 35.6934, 139.6995, {
    dur: 75, open: 17, close: 24, cost: 22, rating: 4, tier: 'maybe', source: 'instagram',
    note: 'Yakitori alley',
  }),
  sp('Tokyo Skytree', 'sight', 35.7101, 139.8107, {
    dur: 90, open: 10, close: 21, cost: 21, rating: 4, tier: 'iftime', source: 'maps',
  }),
  sp('Odaiba Seaside Park', 'nature', 35.63, 139.7756, {
    dur: 70, rating: 3, source: 'maps',
  }),
];

export const trip: Trip = {
  id: 1,
  name: 'Tokyo Adventure',
  city: 'Tokyo',
  country: 'Japan',
  lat: 35.6762,
  lng: 139.6503,
  startDate: '2026-09-01',
  days: 4,
  pace: 'balanced',
  startHour: 9,
  endHour: 21,
  budget: 2200,
  currency: 'USD',
  expenses: [
    { id: 1, label: 'Shibuya hotel (4 nights)', category: 'lodging', amount: 640 },
    { id: 2, label: 'Round-trip flights', category: 'transport', amount: 890 },
    { id: 3, label: '72h metro passes ×3', category: 'transport', amount: 45 },
  ],
};

/** Where the Tokyo maps centre — deliberately the city centroid, not the trip's own point. */
export const TOKYO_CENTER: [number, number] = [35.6762, 139.7503];
export const NYC_NEST_CENTER: [number, number] = [40.71, -73.96];
export const NYC_TABLE_CENTER: [number, number] = [40.725, -73.985];

export const members: Member[] = [
  { id: 1, name: 'You', color: '#4EB4FF' },
  { id: 2, name: 'Maya', color: '#A78BFA' },
  { id: 3, name: 'Ben', color: '#34D399' },
];

export const activity: ActivityItem[] = [
  { who: 'Maya', what: 'moved teamLab Planets to Must-do', when: 'yesterday' },
  { who: 'Ben', what: 'imported 3 spots from a TikTok reel', when: 'yesterday' },
  { who: 'Maya', what: 'reacted 💍 to the Park Slope 2BR', when: '2 days ago' },
  { who: 'Ben', what: 'added Bonnie’s to Date Night', when: '3 days ago' },
];

export interface GazetteerEntry {
  name: string;
  category: Category;
  lat: number;
  lng: number;
  duration: number;
  cost: number;
  open: number | null;
  close: number | null;
  city: string;
}

/** What the scanner matches against for an exact (97%) hit. */
export const gazetteer: GazetteerEntry[] = [
  ...tripSpots.map((s) => ({
    name: s.name,
    category: s.category,
    lat: s.lat,
    lng: s.lng,
    duration: s.duration,
    cost: s.cost,
    open: s.open,
    close: s.close,
    city: 'Tokyo',
  })),
  { name: 'Ghibli Museum', category: 'museum', lat: 35.6962, lng: 139.5704, duration: 120, cost: 10, open: 10, close: 18, city: 'Tokyo' },
  { name: 'Roppongi Hills', category: 'shopping', lat: 35.6605, lng: 139.7292, duration: 90, cost: 0, open: 11, close: 21, city: 'Tokyo' },
  { name: 'Sushi Dai', category: 'food', lat: 35.6459, lng: 139.7854, duration: 60, cost: 40, open: 6, close: 14, city: 'Tokyo' },
  { name: 'Yoyogi Park', category: 'nature', lat: 35.6712, lng: 139.6949, duration: 70, cost: 0, open: null, close: null, city: 'Tokyo' },
  { name: 'Kappabashi Street', category: 'shopping', lat: 35.7136, lng: 139.7885, duration: 60, cost: 0, open: 10, close: 17, city: 'Tokyo' },
  { name: 'Shimokitazawa', category: 'shopping', lat: 35.6613, lng: 139.6681, duration: 100, cost: 0, open: null, close: null, city: 'Tokyo' },
  { name: 'Tokyo Tower', category: 'sight', lat: 35.6586, lng: 139.7454, duration: 75, cost: 12, open: 9, close: 22.5, city: 'Tokyo' },
  { name: 'Daikanyama T-Site', category: 'shopping', lat: 35.6486, lng: 139.703, duration: 60, cost: 0, open: 9, close: 22, city: 'Tokyo' },
  { name: 'Afuri Ramen Ebisu', category: 'food', lat: 35.6467, lng: 139.7101, duration: 45, cost: 11, open: 11, close: 23, city: 'Tokyo' },
  { name: 'Nezu Museum', category: 'museum', lat: 35.6622, lng: 139.7175, duration: 80, cost: 9, open: 10, close: 17, city: 'Tokyo' },
];

/* ---- Nest: NYC apartment hunt ---- */
export const nest: Listing[] = [
  { id: 1, title: 'Sunny 2BR in Park Slope', price: 3850, beds: 2, baths: 1, sqft: 850, hood: 'Park Slope', lat: 40.671, lng: -73.9814, source: 'zillow', note: 'Top floor, W/D in unit, pets ok', reactions: { '💍': ['You', 'Maya'], '🪴': [] }, tagged: null },
  { id: 2, title: 'Greenpoint loft, skyline view', price: 4200, beds: 1, baths: 1, sqft: 780, hood: 'Greenpoint', lat: 40.7304, lng: -73.9515, source: 'streeteasy', note: '14ft ceilings, roof deck', reactions: { '💍': [], '🪴': ['Maya'] }, tagged: null },
  { id: 3, title: 'Astoria 2BR near the park', price: 2975, beds: 2, baths: 1, sqft: 900, hood: 'Astoria', lat: 40.7644, lng: -73.9235, source: 'zillow', note: 'Renovated kitchen, 2 blocks to N/W', reactions: { '💍': ['Maya'], '🪴': ['You'] }, tagged: null },
  { id: 4, title: 'Fort Greene brownstone floor-through', price: 4650, beds: 2, baths: 1.5, sqft: 1050, hood: 'Fort Greene', lat: 40.6892, lng: -73.9742, source: 'instagram', note: 'Original details, garden access', reactions: { '💍': [], '🪴': [] }, tagged: 'Maya tagged you — “the one with the mantel 👀”' },
  { id: 5, title: 'LIC high-rise 1BR + den', price: 3600, beds: 1, baths: 1, sqft: 720, hood: 'Long Island City', lat: 40.7447, lng: -73.9485, source: 'zillow', note: 'Gym + doorman, den fits a desk', reactions: { '💍': [], '🪴': ['You'] }, tagged: null },
];

/* ---- Table: date-night list, NYC ---- */
export const table: Restaurant[] = [
  { id: 1, name: 'Via Carota', cuisine: 'Italian', mood: 'Cozy', price: '$$$', hood: 'West Village', lat: 40.7331, lng: -74.0036, hours: '5–11 pm', tried: true, tier: 'must' },
  { id: 2, name: 'Lilia', cuisine: 'Italian', mood: 'Buzzy', price: '$$$', hood: 'Williamsburg', lat: 40.7178, lng: -73.9527, hours: '5:30–11 pm', tried: false, tier: 'must' },
  { id: 3, name: 'Atomix', cuisine: 'Korean tasting', mood: 'Occasion', price: '$$$$', hood: 'NoMad', lat: 40.7443, lng: -73.9843, hours: 'Seatings 5 & 8:30', tried: false, tier: 'maybe' },
  { id: 4, name: 'Dhamaka', cuisine: 'Indian', mood: 'Bold', price: '$$', hood: 'Lower East Side', lat: 40.7183, lng: -73.9878, hours: '5:30 pm–12 am', tried: true, tier: 'maybe' },
  { id: 5, name: 'Frenchette', cuisine: 'French', mood: 'Lively', price: '$$$', hood: 'Tribeca', lat: 40.7195, lng: -74.0089, hours: '5–10:30 pm', tried: false, tier: 'iftime' },
  { id: 6, name: 'Bonnie’s', cuisine: 'Cantonese-American', mood: 'Fun', price: '$$', hood: 'Williamsburg', lat: 40.7145, lng: -73.9425, hours: '5:30–11 pm', tried: false, tier: 'maybe' },
  { id: 7, name: 'Rezdôra', cuisine: 'Italian', mood: 'Cozy', price: '$$$', hood: 'Flatiron', lat: 40.7398, lng: -73.9891, hours: '5–10 pm', tried: true, tier: 'iftime' },
  { id: 8, name: 'Double Chicken Please', cuisine: 'Cocktail bar', mood: 'Fun', price: '$$', hood: 'Lower East Side', lat: 40.7157, lng: -73.986, hours: '5 pm–2 am', tried: false, tier: 'maybe' },
];
