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

The `ios/` and `android/` Capacitor 8 projects are committed (iOS 15+ with
UIScene adoption, Android SDK 36 / minSdk 24, AGP 8.13, Gradle 8.14.3), with app
icons and splash screens (the Cohive hexagon on navy) already generated into both
via `npx @capacitor/assets generate --ios --android` from `assets/`.

```bash
npm run sync          # rebuild web assets + copy into both native shells

# Android — needs the Android SDK (set ANDROID_HOME):
cd android && ./gradlew assembleDebug     # or open in Android Studio

# iOS — needs a Mac with Xcode + CocoaPods:
cd ios/App && pod install && open App.xcworkspace
```

`capacitor.config.ts` sets the app id (`com.aurevonlabs.cohive`), the dark navy launch
background and an overlaying status bar so the app paints edge to edge. The synced
`public/` folders inside the native shells are build outputs and stay untracked —
run `npm run sync` after cloning.

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

59 checks driving a real browser through every flow: onboarding → auth → create hive →
invite → home → trip map → scan and add → tier voting → itinerary generation → budget →
crew → Nest → Table → pricing → all 21 connections → theme toggle → persistence across a
reload → replay tour → desktop bezel — plus deep flows: scanner results and list filters
surviving navigation, un-voting a tier, regenerating with a different day count, a real
`.ics` download, clipboard copy verified by reading the clipboard back, expense
validation, Platinum, downgrade re-locking, and referral-code permanence across
downgrade/re-purchase. Fails on any console error.

Playwright is not a project dependency, so point at an install:

```bash
npm run build
npx vite preview --port 4173 &
PLAYWRIGHT=$(npm root -g)/playwright npm run smoke -- http://127.0.0.1:4173
```

`CHROMIUM=/path/to/chrome` overrides the browser binary. Map tiles come from a CDN — where
that is unreachable the tile images don't paint, so the map assertions check Leaflet
initialisation and the locally-rendered marker pins rather than loaded tiles.

### Stress + fuzz — `npm run stress:engine` and `npm run stress`

`stress:engine` fuzzes the engine with a seeded RNG: 300 randomized trips
(0–120 spots, world-spanning coords, inverted/zero windows, weird hours) and
2,000 adversarial scanner inputs (empty, whitespace, URLs, 10KB emoji floods),
asserting the invariants that must hold for any input, plus determinism and a
wall-clock budget (a 300-spot / 10-day packed plan schedules in ~16ms).

### Accessibility — `npm run a11y`

Runs axe-core over every screen and the pricing sheet, in dark and light mode,
failing on any serious/critical violation. Currently clean. The light-mode
`--soft`/`--honey` text colors were darkened slightly from the prototype to
clear WCAG AA contrast (4.5:1); the amber gradient CTAs are unchanged. The
pricing sheet traps focus while open, restores it on close, and closes on
Escape.

`stress` (same env vars as `smoke`) is the browser endurance run: 50 full tab
cycles with live map create/destroy while watching JS heap, DOM node and event
listener counts over CDP; an 8-scan import flood to 32 spots; vote/theme/sheet
spam; double-tap Generate; Days=999 clamping; oversized inputs and layout
overflow checks. Heap stayed 3.6→4.3MB across the full run with flat node and
listener counts, and exactly one live Leaflet map after churn.

## Product rules

- **Free tier**: 3 hives, 3 trips; everything usable, booking and account linking gated
- **Cohive+ $4.99/mo**: unlimited hives and trips, travel + social account linking
- **Cohive+ Annual $33/yr** (featured): adds in-app booking — OpenTable & Resy
- **Platinum $129 once**: everything in Annual, for life
- Any paid plan generates a permanent, non-expirable referral code — 10% commission per
  signup, paid only when that signup buys a paid plan

## Hardening

- **Crash safety**: a top-level error boundary (styled with raw values so it
  renders even if theming breaks) catches any render error — reload, never a
  white screen.
- **CSP**: `index.html` ships a Content-Security-Policy locked to self and
  Carto tiles (fonts are self-hosted under `/fonts`); `object-src 'none'`,
  no-referrer, external links all `rel="noreferrer"`. Applies inside the
  Capacitor webviews too.
- **API**: `server.mjs` (and the Netlify `/api/*` function) enforce auth +
  membership ACL for trips, votes and members; import scanning is sanitized
  on ingest and rate-limited per account/IP. Offline/demo still works against
  seed fixtures when the API is unreachable. Node hosts persist to
  `data/cohive-store.json` (override with `COHIVE_DATA_FILE`); Netlify
  Functions stay memory-only unless a durable backend is wired.
- **Storage**: everything read back from localStorage is validated (type,
  whitelist, length caps) before use — corrupted or hand-edited values fall
  back to defaults instead of propagating.
- **Performance**: Leaflet is code-split and lazy-loaded (main bundle
  225KB / 70KB gzip; the 150KB map chunk loads when the first map renders,
  with a height-matched placeholder to avoid layout shift).
- **Native**: `android:allowBackup="false"`; iOS ATS fully on (no exceptions);
  app id and manifests validated.
- **CI**: `.github/workflows/ci.yml` runs audit (fails on any vulnerability),
  typecheck+build, both engine suites, the 59-check walkthrough, the browser
  stress run, the axe audit, and a `cap sync` sanity check on every push/PR.

## What's persisted

Theme, onboarding completion, plan tier, referral code, linked accounts, and the
API session token survive a reload via `localStorage` (validated reads). Hive
content for the demo stays in-memory on the client; when `/api` is live, trips /
votes / members are server-authoritative and file-backed on Node hosts.

## Next engineering steps

1. Durable multi-instance DB (Postgres / Netlify DB) + real OAuth for Apple/Google
2. Live geocoding via Nominatim (cached and throttled, as in rhyme-plus `lib/geocode.js`)
3. Real OAuth for the 21 account connections; the UI is wired, the handshake is not
4. OpenTable/Resy deep-link booking behind the Annual entitlement
5. Payments — the pricing sheet currently just sets local state; nothing charges anything

---
© 2026 AurevonLabs · a division of Aurevon Ventures LLC. Demo data only.
