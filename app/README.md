# Cohive — by AurevonLabs

Trips, homes and dinners in one shared hive. Three product lines under one roof:

- **Bucketlist** — trips: map, universal link import, tiered voting, itinerary studio, budget, crew
- **Nest** — shared home hunting: mapped listings with 💍/🪴 reactions
- **Table** — the dinner list that survives the group chat

Built from the Claude Design handoff in `../project/`, on the hardened trip-planning core of
[`mikerivera33/rhyme-plus`](https://github.com/mikerivera33/rhyme-plus) (`v2-universal-import`).

## Stack

React 18 + TypeScript + Vite, Leaflet for maps, Capacitor for the iOS/Android wrap.
No component framework — the design is expressed in CSS custom properties and the small
set of composites in `src/styles/globals.css`.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run typecheck
```

On a phone-sized viewport the app fills the screen and honours the real safe-area insets.
At ≥900px wide it renders inside an iOS bezel, which is how the design was presented.

Two query params help when demoing:

| Param | Effect |
| --- | --- |
| `?start=app` | Skip onboarding |
| `?start=onboarding` | Force onboarding, ignoring saved state |

## Native builds

```bash
npx cap add ios       # or: android
npm run ios           # build + sync + open Xcode
npm run android
```

`capacitor.config.ts` sets the app id (`com.aurevonlabs.cohive`), the dark navy launch
background and an overlaying status bar so the app paints edge to edge.

## Layout

| Path | What it is |
| --- | --- |
| `src/engine/engine.ts` | The itinerary engine — day clustering, nearest-neighbour routing, real clock times, opening-hours and meal slotting, tier-aware scoring, the never-fail import scanner, `.ics` and text exports. Framework-free and dependency-free. |
| `src/engine/seed.ts` | Demo fixtures — Tokyo trip + gazetteer, NYC listings, NYC restaurants. Swap this module for API calls; nothing else reads the constants directly. |
| `src/store/AppStore.tsx` | All app state and the actions that mutate it, behind `useApp()`. |
| `src/screens/` | One file per tab; the Trip tab's five sub-views live in `screens/trip/`. |
| `src/components/` | Shared chrome — device frame, map, header, tab bar, pricing sheet, toast. |
| `src/lib/` | Reveal-on-scroll, confetti, safe clipboard, safe localStorage, style helpers. |
| `scripts/verify-engine.ts` | Engine property checks (see below). |
| `scripts/smoke.mjs` | End-to-end browser walkthrough (see below). |

## Tests

### Engine — `npm run verify:engine`

36 property checks: every must-do gets placed at all three paces, no spot is scheduled
twice, visits stay inside the trip's daily window, nothing is scheduled before it opens,
times run strictly forward, day costs sum correctly, the scanner always resolves at least
one candidate (including emoji-only and empty-ish input), and the `.ics`/text exports
match the plan.

### End to end — `npm run smoke`

46 checks driving a real browser through every flow: onboarding → auth → create hive →
invite → home → trip map → scan and add → tier voting → itinerary generation → budget →
crew → Nest → Table → pricing → all 21 connections → theme toggle → persistence across a
reload → replay tour → desktop bezel. Fails on any console error.

Playwright is not a project dependency, so point at an install:

```bash
npm run build
npx vite preview --port 4173 &
PLAYWRIGHT=$(npm root -g)/playwright npm run smoke -- http://127.0.0.1:4173
```

`CHROMIUM=/path/to/chrome` overrides the browser binary. Map tiles come from a CDN — where
that is unreachable the tile images don't paint, so the map assertions check Leaflet
initialisation and the locally-rendered marker pins rather than loaded tiles.

## Product rules

- **Free tier**: 3 hives, 3 trips; everything usable, booking and account linking gated
- **Cohive+ $4.99/mo**: unlimited hives and trips, travel + social account linking
- **Cohive+ Annual $33/yr** (featured): adds in-app booking — OpenTable & Resy
- **Platinum $129 once**: everything in Annual, for life
- Any paid plan generates a permanent, non-expirable referral code — 10% commission per
  signup, paid only when that signup buys a paid plan

## What's persisted

Theme, onboarding completion, plan tier, referral code and linked accounts survive a
reload via `localStorage` (all reads and writes are guarded — losing storage never breaks
the app). Hive content is in-memory fixture data until a backend lands.

## Next engineering steps

1. Real backend — port rhyme-plus `server.js` and add hive/member auth
2. Live geocoding via Nominatim (cached and throttled, as in rhyme-plus `lib/geocode.js`)
3. Real OAuth for the 21 account connections; the UI is wired, the handshake is not
4. OpenTable/Resy deep-link booking behind the Annual entitlement
5. Payments — the pricing sheet currently just sets local state; nothing charges anything

---
© 2026 AurevonLabs · a division of Aurevon Ventures LLC. Demo data only.
