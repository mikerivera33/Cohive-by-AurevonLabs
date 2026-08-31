# Cohive — by AurevonLabs

A social planning hub for the people you actually share life with: **trips, homes, and dinners in one shared hive**, with tiered voting, a never-fail link scanner, and AI itineraries.

Built on the hardened trip-planning core of [`mikerivera33/rhyme-plus`](https://github.com/mikerivera33/rhyme-plus) (`v2-universal-import`) — the itinerary engine (geographic day clustering, nearest-neighbour routing, real clock times, opening-hours checks, meal slotting) and Tokyo seed data are ported verbatim and extended with tier-aware scoring.

## What's here

| Path | What it is |
| --- | --- |
| `lib/cohive-engine.js` | Framework-free engine: `planTrip`, tier scoring (must/maybe/if-time), never-fail `scanImport` (exact gazetteer → proper-noun mining → URL-slug mining → concierge assist; always ≥1 candidate with confidence, never "destination not found"), `.ics` builder, Nest + Table demo data |
| `prototype/index.html` | Self-contained interactive prototype (open in any browser, works offline) — full iOS-framed app: onboarding, hive home, Bucketlist trip (map, import, tier voting, itinerary studio, budget, crew), Nest listings, Table reservations, pricing sheet, dark/light |

## Product spec (v1)

- **Three hives**: Bucketlist (trips + budgets), Nest (shared home shopping), Table (dinners, mapped)
- **Tiered voting**: must / maybe / if-time — the engine treats Must as a guarantee
- **Universal import**: any link, caption, or note resolves to a place with a confidence score; user confirms — the scanner never dead-ends
- **Pricing**: Free ($0 — 3 hives, 3 trips, everything usable, booking gated) · Cohive+ $4.99/mo · **Cohive+ Annual $33/yr** (in-app OpenTable/Resy booking + shared calendars, most popular) · Platinum $129 lifetime (adds Airbnb, Hotels.com, Expedia & Priceline account linking)
- **Mobile-first**: iOS/Android via Capacitor (see rhyme-plus `mobile/` for the config pattern); safe-area aware, 44px+ hit targets

## Shipping this repo

```
gh repo create aurevonlabs/cohive --private --source . --push
```
(or create an empty repo on github.com and `git init && git add -A && git commit -m "Cohive v1 seed" && git push`)

## Next engineering steps

1. Real backend: port rhyme-plus `server.js` (zero-dep Node API) and add hive/member auth
2. Live geocoding via Nominatim (cached + throttled, as in rhyme-plus `lib/geocode.js`)
3. OpenTable/Resy deep-link booking behind the Annual entitlement
4. Capacitor wrap for App Store / Play Store

---
© 2026 AurevonLabs · a division of Aurevon Ventures LLC. Demo data only; nothing charges anything.
