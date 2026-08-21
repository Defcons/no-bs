# NoBS — Workout Log

A no-BS gym app: sets, reps, rest timer, heart rate. Nothing you don't need — no account, no feed, no subscription, no telemetry.

**[nobs.agentas.net](https://nobs.agentas.net)** · installable PWA + native Android (Play release in review; sideload APK on the site)

## What it does

- **Log fast, thumb-first** — day templates prefill last week's weights; tick a set done, the rest timer starts itself. Only what you tick is recorded.
- **Timers that survive reality** — pausable workout clock, per-exercise rest presets, break sounds that duck your music, a floating PiP timer when you leave the app, optional earbud-button break control.
- **Heart rate** — Web Bluetooth straps, live BPM + session average, calorie estimate (Keytel), smart low-HR warnings, auto-end when the strap goes quiet.
- **Running & cardio** — GPS route recording (screen-off safe), pace/distance stats, personal pace medals, shareable route links.
- **Records & progress** — PR detection with a live badge, strength standards (men's and women's tables), est-1RM progression charts, weekly consistency, "current form" vs your all-time peak.
- **Your data stays yours** — everything lives on-device (IndexedDB). Optional backup to `.xlsx`/JSON (lossless, GPS tracks included) or sync to your own Google Sheet via a bound Apps Script — your sheet, your script, your secret. The app phones home to exactly nobody.

## Stack

Vite + React + TypeScript · Dexie (IndexedDB) · Capacitor (Android) · self-hosted OTA updates (Capgo, manual trigger, origin-pinned) · Leaflet for run maps.

## Development

```bash
npm install
npm run dev        # web dev server
npx tsc --noEmit   # typecheck
npm run build      # production build (PWA)
```

Android builds (both flavours), deployment, and the OTA pipeline are documented in [DEPLOY.md](DEPLOY.md). Repo orientation lives in [OrientationMap.md](OrientationMap.md) / [NavigationMap.md](NavigationMap.md); behaviour facts in [docs/KnowledgeBase.md](docs/KnowledgeBase.md).

## License

[AGPL-3.0](LICENSE). Use it, study it, change it, share it — but if you distribute it or run a modified version as a network service, you release your source under the same terms. That's deliberate: a workout log built on "no account, no subscription, your data is a file you own" shouldn't be able to become someone else's closed, subscription-walled service.

Copyright © 2026 Agentas AS.

## Contact

apps@agentas.net
