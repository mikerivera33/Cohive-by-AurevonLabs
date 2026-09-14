# Cohive — by AurevonLabs

Trips, homes and dinners in one shared hive. Three product lines under one roof:

- **Bucketlist** — trips: map, universal link import, tiered voting, itinerary studio, budget with a shared pot + cost splitting, crew
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
| `src/engine/ledger.ts` | Trip money — the shared pot with per-member envelopes, cent-exact equal splits, Splitwise-style balances and greedy settle-up. Bundled into the API server so the same rules run on both sides. |
| `src/engine/seed.ts` | Demo fixtures — Tokyo trip + gazetteer, NYC listings, NYC restaurants. Swap this module for API calls; nothing else reads the constants directly. |
| `src/store/AppStore.tsx` | All app state and the actions that mutate it, behind `useApp()`. |
| `src/screens/` | One file per tab; the Trip tab's five sub-views live in `screens/trip/`. |
| `src/components/` | Shared chrome — device frame, map, header, tab bar, pricing sheet, toast. |
| `src/lib/` | Reveal-on-scroll, confetti, safe clipboard, safe localStorage, style helpers. |
| `scripts/verify-engine.ts` | Engine property checks (see below). |
| `scripts/smoke.mjs` | End-to-end browser walkthrough (see below). |

## Tests

### Engine — `npm run verify:engine`

46 property checks: every must-do gets placed at all three paces, no spot is scheduled
twice, visits stay inside the trip's daily window, nothing is scheduled before it opens,
times run strictly forward, day costs sum correctly, the scanner always resolves at least
one candidate (including emoji-only and empty-ish input), and the `.ics`/text exports
match the plan. The ledger checks cover cent-exact splits, envelopes summing to the pot,
withdrawals capped at what you put in, pot bills refused on any shortfall, and settle-up
clearing every balance in ≤ n−1 transfers.

### End to end — `npm run smoke`

77 checks driving a real browser through every flow: onboarding → auth → create hive →
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

### Payments — `npm run e2e:payments`

21 checks on an iPhone-sized touch viewport covering every money surface: the group pot
(contribute, refused overdraw, own-money withdrawal, refused short pot bill, covered pot
bill, settle-up), subscription tiers and the referral code, the booking gate, and the
persistence policy. Each screen is also held to iOS rules — `viewport-fit=cover`, no
horizontal scroll, ≥44pt tap targets on every control, ≥16px inputs so Safari never zooms.

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

## Backend

The API (`server/`) runs on one of two stores behind the same interface:

| Store | When | Notes |
| --- | --- | --- |
| Memory + JSON file | default in dev (`COHIVE_DATA_FILE`) | single node; used by `verify:api` |
| **Postgres** | `DATABASE_URL` is set | migrations in `server/migrations/`, applied on boot; money ops lock the trip row inside one transaction; used by `verify:pg` |

```bash
# local Postgres for the store checks
DATABASE_URL=postgres://cohive:cohive@127.0.0.1:5432/cohive_test npm run verify:pg   # 14 checks
DATABASE_URL=... npm start                                                             # API + static app on :8080
```

Environment (see `.env.example`): `DATABASE_URL`, `COHIVE_PUBLIC_URL` (where email and invite links
point), `RESEND_API_KEY` + `COHIVE_MAIL_FROM` (magic-link mail; without them the API returns a
`devLink` outside production), `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`, `COHIVE_CORS_ORIGIN`.

### Identity

- **Magic links** — `POST /api/auth/magic {email}` mails a one-tap link; `GET /api/auth/magic/verify`
  redirects into the app with a session. Links are hashed at rest, single-use, 15-minute expiry.
  A new account starts with its own trip, never the shared demo trip.
- **Sessions** — Bearer token for native, plus an `HttpOnly; SameSite=Lax` cookie for the web app.
- **Account deletion** — `DELETE /api/auth/me` revokes sessions and anonymises the profile; trip
  ledgers keep a "Deleted member" placeholder so balances still add up.
- Google/Apple OAuth activates when the client IDs are configured (`server/oauth.mjs`).

### Entitlements (payments groundwork)

The server is the authority on what a user has paid for. `GET /api/auth/me` returns
`{ user, entitlement: { tier, expiresAt, source }, features: { connections, booking },
caps: { hives, tripsPerHive }, referralCode }`. Caps are enforced by the API: Free = 3 hives /
3 trips per hive, any paid tier = 20 / 20. Billing providers feed
`POST /api/billing/webhook` with a normalised event `{ userId, tier, expiresAt?, source,
eventId }` signed with HMAC-SHA256 of the raw body (`X-Cohive-Signature`,
`COHIVE_BILLING_SECRET`); events are idempotent by `eventId` and an expired entitlement reads
as Free. The first paid event issues the user's permanent referral code (`MIKE-K7Q210`);
sign-ups carry `ref` for attribution. Outside production, `POST /api/billing/demo-purchase`
mirrors the demo pricing sheet server-side so the client's plan comes from the API when live.

### Hives

The hive is the membership unit. `GET /api/hives` lists yours with their trips; `POST /api/hives`
creates one (Free: 3 owned); `GET /api/hives/:id` bundles members, trips, Nest listings and
Table entries; `POST /api/hives/:id/trips` adds a trip (Free: 3 per hive). Nest: `POST
/api/hives/:id/nest`, `POST /api/hives/:id/nest/:id/react {emoji}` (keyed by member id). Table:
`POST /api/hives/:id/table`, `POST /api/hives/:id/table/:id {tried, tier}`. The app shows the
hive's trips on Home with create-and-switch; offline, trips are kept in memory per session.

### Invites

Adding a member creates a placeholder plus a single-use invite (`POST /api/trips/:id/members` →
`{ member, invite, url }`); `POST /api/trips/:id/invites` mints open links with `maxUses`.
`GET /api/invites/:code` previews without sign-in; `POST /api/invites/:code/accept` binds the
signed-in user to the placeholder — the placeholder's id stays the ledger key, so any pot
contributions logged against "Maya" before she joined are still hers. The app captures
`?invite=CODE` from a link, keeps it through onboarding, and redeems it once a session exists.

## Product rules

- **Money — pot + envelopes.** Each member's contribution sits in their own envelope; a
  member can only take out what they put in, never anyone else's money. The pot pays a bill
  only when every participant's envelope covers their share (otherwise it names who is short).
  Person-paid expenses split equally (cents distributed largest-remainder) into per-member
  balances, and "Settle up" suggests the minimal transfers; marking one paid records a
  settlement that nets both sides. When the API is live these rules are enforced server-side
  (`/api/trips/:id/fund`, `/fund/contributions`, `/fund/withdrawals`, `/expenses`) and the
  acting member is always the session user.

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
  typecheck+build, both engine suites, the 77-check walkthrough, the browser
  stress run, the axe audit, and a `cap sync` sanity check on every push/PR.

## What's persisted

Theme, onboarding completion, plan tier, referral code, linked accounts, a pending invite
code, and the API session token survive a reload via `localStorage` (validated reads). Hive
content for the demo stays in-memory on the client; when `/api` is live, trips / votes /
members / money are server-authoritative — Postgres with `DATABASE_URL`, else a JSON file.

## Next engineering steps

1. Apple/Google OAuth keys on the hosts, native PKCE flows, push notifications
2. Live geocoding via Nominatim (cached and throttled, as in rhyme-plus `lib/geocode.js`)
3. Real OAuth for the 21 account connections; the UI is wired, the handshake is not
4. OpenTable/Resy deep-link booking behind the Annual entitlement
5. Payments — the pricing sheet currently just sets local state; nothing charges anything

---
© 2026 AurevonLabs · a division of Aurevon Ventures LLC. Demo data only.
