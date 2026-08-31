# Cohive by AurevonLabs

Trips (Bucketlist), homes (Nest) and dinners (Table) in one shared hive.
A React 18 + TypeScript + Vite mobile app, Capacitor-ready for iOS/Android.

## Layout

| Path | What it is |
| --- | --- |
| `app/` | The real application. See `app/README.md` for everything. |
| `project/` | The original Claude Design prototype bundle — the design source of truth. `project/HANDOFF.md` explains it; `chats/` holds the design-session transcripts where product decisions were made. |
| `branding/` | AurevonLabs brand assets. `branding/aurevonlabs-logo.jpg` is the official parent-company logo (blue-gradient angular A monogram, `AUREVON` in white caps over `LABS` in gray, on near-black navy) — see `branding/README.md` before using it anywhere. |

## Commands (run in `app/`)

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # tsc --noEmit + vite build
npm run verify:engine  # 36 engine property checks
npm run smoke          # 59-check browser walkthrough (needs Playwright — see app/README.md)
```

## Things future sessions should know

- **Brand**: Cohive is deliberately its own consumer identity — navy `#0A0F1C` +
  honey amber `#F5A524`, hexagon mark, Space Grotesk/Outfit — with only a small
  "by AurevonLabs" credit. The blue AurevonLabs logo in `branding/` is the parent
  company's mark; don't restyle the app toward it.
- **Design fidelity**: `project/Cohive by AurevonLabs.dc.html` is the pixel
  reference. Token values in `app/src/styles/globals.css` are copied from it
  verbatim — change them only if the design changes.
- **Engine**: `app/src/engine/engine.ts` is ported from rhyme-plus
  (`mikerivera33/rhyme-plus`, branch `v2-universal-import`); keep its scheduling
  maths in sync with any upstream fixes. Seed/fixture data lives only in
  `app/src/engine/seed.ts` — swap that module when a backend lands.
- **Product rules**: Free = 3 hives / 3 trips, booking + account linking gated;
  Cohive+ $4.99/mo unlocks the 21 account connections; Annual $33/yr (featured)
  adds in-app booking; Platinum $129 lifetime. Any paid plan generates a
  permanent, non-expirable referral code (10% commission, paid only when the
  referred signup buys a paid plan).
- **Tests**: keep `npm run verify:engine` and the smoke suite green; the smoke
  suite fails on any browser console error. Map tile CDNs may be unreachable in
  sandboxes — the map checks assert Leaflet init + marker pins, not painted tiles.
