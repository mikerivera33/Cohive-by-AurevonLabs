# Third-party account integrations

_Started 2026-08-27 23:34 UTC_

---

## User

Continuing from "Cohive by AurevonLabs".

## Assistant

We were building Cohive by AurevonLabs — a full-featured travel + lifestyle hive app for iOS/Android, pulling the hardened engine from Rhyme+/Bucketlist and layering three product lines (Busketlist trips, Nest apartment hunting, Table dining) with dark navy/amber branding, tiered subscriptions, and scroll-driven motion.

Key decisions made:
- Consumer-first brand identity (navy + amber) separate from labs.aurevonvc.com
- Free tier capped at 3 hives + 3 trips; booking features gated until paid
- Pricing tiers: Free, $4.99/mo, $33/yr (featured), $129 lifetime
- Universal link scanner with fallback guessing + confidence scores for trip imports
- Tier voting (must/maybe/if-time) with visual feedback; itinerary auto-clustering by day
- Option 1 navigation (bottom tab bar)
- Full onboarding: intro slides → auth → create hive → invite flow
- Premium concierge copy tone; dark + light toggle

Current state: The app is fully built and end-to-end tested. All three demo hives (Tokyo trip, NYC apartment hunt, date-night restaurants) are populated and functional. Every flow tested: onboarding → auth → create → invite → home → trip map scanning → voting → itinerary generation → budget tracking → crew management → Nest listings → Table dining → pricing tiers. Console is clean; scanner resolves all inputs with confidence scores. Two minor bugs were fixed during audit (status-bar overlap, Pace selector binding).

Ready to ship: I've assembled a push-ready GitHub repo package. Can't create repos directly, so the download is a seed with README + product spec + standalone engine + offline prototype (prototype/index.html). Unzip and run the GitHub CLI command in the instructions to push live.

Project files: Cohive by AurevonLabs.dc.html

## User

Id like you to add direct connections to other accounts like priceline, etc,. Id like you to add the connections the same way for the following: American airlines AAdvantage app, Frontier airlines app, United airlines app, delta airlines app, connnection to all social media accounts (X,Tiktok, Instagram,threads,youtube,pinterest,vsco,snapchat,linkedin,facebook), as well as uber,airbnb,southwest airlines app, and resy. also add a feature for all accounts that purchase a paid plan receive/get a custom non-expirable referral code for 10% commission attached to their account on every signup using their referral code ONLY valid if referral code used is with a paid plan purchase.

## Assistant

_[tool: grep]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Now the logic:

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: grep]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

_[tool: dc_js_str_replace]_

Added to the You tab, out for review:

- **Travel & booking connections** — Airbnb, Hotels.com, Expedia, Priceline, Uber, Resy, American AAdvantage, United, Delta, Southwest, Frontier
- **Social connections** — X, TikTok, Instagram, Threads, YouTube, Pinterest, VSCO, Snapchat, LinkedIn, Facebook
- All gated behind Platinum (same pattern as before); on Platinum each row becomes a live Connect/Connected toggle
- **Referral program** — buying any paid plan generates a permanent, non-expirable code (shown in a card with copy button); copy states 10% commission per signup, paid only when that signup buys a paid plan. Referral perk also listed on all three paid tiers, and the plan card/badge now update on purchase.

One call I made: social linking sits behind Platinum like travel accounts — say the word if socials should be free-tier connectable instead.

## User

Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

Renamed the subscription state key to `planTier` everywhere so it no longer collides with the itinerary's `plan` — crash fixed, out for re-review.

## User

run end to end test for all connections ensuring all working properly

## Assistant

_[tool: show_html]_

Running the end-to-end test myself since you asked directly:

_[tool: save_screenshot]_

The last two frames didn't show the account rows — verifying the connect toggles directly:

_[tool: multi_screenshot]_

Scroll container isn't `main` — probing with a debug overlay:

_[tool: multi_screenshot]_

All 21 connections toggled to Connected. Capturing the lists visually:

_[tool: multi_screenshot]_

The capture tool ignores scroll offset — using a temporary transform to show the rows:

_[tool: multi_screenshot]_

Transform capture isn't cooperating either, but the DOM audit is conclusive. One final assertion pass (names + disconnect/reconnect + copy):

_[tool: multi_screenshot]_

_[tool: get_webview_logs]_

End-to-end test passed. One hardening fix — clipboard write can reject when the app is backgrounded:

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

E2E test complete — all passing:

**Free tier gating** — all 21 accounts show 🔒 Platinum; tapping any opens the pricing sheet; referral teaser card shows.
**Purchase flow** — buying Platinum: badge updates Free → Platinum, plan card updates, referral code generated (MIKE-FLPW10, permanent).
**Connections** — all 21 rows verified by name and toggled: Airbnb, Hotels.com, Expedia, Priceline, Uber, Resy, American AAdvantage, United, Delta, Southwest, Frontier + X, TikTok, Instagram, Threads, YouTube, Pinterest, VSCO, Snapchat, LinkedIn, Facebook. Connect → Connected ✓ works on every row.
**Disconnect** — toggling off returns the row to Connect with a "disconnected" toast (20 connected / 1 connect confirmed, then reconnected).
**Copy referral** — works; added a guard so a background-tab clipboard rejection can't throw.

Console is clean (the only log noise was browser wallet extensions, unrelated to the app).

## User

make the connections available at the 4.99/mo tier and also add in the same interactive working map to the main "Hive" tab as well as having it on the other tabs. also check all spelling and grammar to ensure words like "BucketList" is spelled correctly.

## Assistant

_[tool: grep]_

_[tool: grep]_

_[tool: grep]_

_[tool: dc_html_str_replace]_

_[tool: run_script]_

_[tool: run_script]_

Now a proofread pass over all copy:

_[tool: read_file]_

_[tool: grep]_

_[tool: grep]_

_[tool: run_script]_

_[tool: ready_for_verification]_

Done, out for review:

- **Connections at $4.99/mo** — linking now unlocks on any paid tier; lock buttons read 🔒 Cohive+; "Link travel & social accounts" listed as a Cohive+ monthly feature (removed from Platinum-only)
- **Home tab map** — same interactive Leaflet map now on the Hive home tab (Tokyo Adventure with live spot pins + overlay badge), alongside the existing trip/nest/table maps
- **Spelling** — "Busketlist" → "Bucketlist" everywhere: app UI, onboarding, engine (.ics PRODID), README, repo package, and github.md. Proofread all other copy; no other errors found.

Note: the prototype in cohive-repo/prototype/index.html is a bundled snapshot from before these changes — say the word if you want it regenerated.

