# Cohive — by AurevonLabs

**Trips, homes and dinners in one shared hive.** Three product lines under one roof:

- 🐝 **Bucketlist** — trips: live map, universal link scanner, tiered voting
  (must / maybe / if-time), AI itinerary studio with real clock times, budget
  tracker, crew
- 🏠 **Nest** — shared home hunting: mapped listings with 💍/🪴 reactions
- 🍝 **Table** — the dinner list that survives the group chat

Dark navy + honey amber, dark/light modes, spring motion, scroll-driven reveals.
iOS-framed on desktop, full-bleed with safe-area insets on a phone,
Capacitor-ready for the App Store / Play Store.

## Live

- **Web app**: https://mikerivera33.github.io/cohive-by-aurevonlabs/ — the full app,
  auto-published from the `gh-pages` branch (single self-contained bundle,
  hash-locked CSP). If it ever 404s, enable Pages once: repo Settings → Pages →
  deploy from branch → `gh-pages`.
- Rebuild + republish: `cd app && npx vite build --config vite.single.config.ts
  && node scripts/inline-single.mjs`, then copy `app/deploy/cohive.html` over
  `index.html`/`404.html` on the `gh-pages` branch.
- `app/netlify.toml` is ready for a zero-config Netlify import from this repo
  (app.netlify.com → Import from Git) if a netlify.app domain is preferred.

## Run it

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

Full docs — native builds, tests (36 engine checks + a 59-check browser
walkthrough), architecture, product rules — live in [`app/README.md`](app/README.md).

## Repository layout

| Path | What it is |
| --- | --- |
| [`app/`](app/) | The application — React 18 + TypeScript + Vite + Leaflet, Capacitor config included |
| [`project/`](project/) | The Claude Design prototype bundle this app was built from (design source of truth; see [`project/HANDOFF.md`](project/HANDOFF.md)) |
| [`chats/`](chats/) | Design-session transcripts — where the product decisions live |
| [`branding/`](branding/) | AurevonLabs brand assets, including the official logo |
| `Cohive by AurevonLabs.zip` | Original design-bundle export (superseded by `project/`) |

## Heritage

Built on the hardened trip-planning core of
[`mikerivera33/rhyme-plus`](https://github.com/mikerivera33/rhyme-plus)
(`v2-universal-import`): geographic day clustering, nearest-neighbour routing,
opening-hours and meal-slotting logic, extended with tier-aware scoring and the
never-fail import scanner.

---
© 2026 AurevonLabs · a division of Aurevon Ventures LLC. Demo data only; nothing charges anything.
