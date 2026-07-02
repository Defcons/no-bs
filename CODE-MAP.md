# CODE-MAP — gym-tracker

Installable PWA for fast in-gym set logging. Local-first (IndexedDB via Dexie), imports the owner's Google Sheet history for records. See `project_gym_tracker` / `reference_gym_sheet` in memory.

_Last verified: 2026-07-02_

## Stack
Vite 8 + React 19 + TypeScript, Dexie 4 (IndexedDB), `vite-plugin-pwa`, Web Bluetooth for HR. Run `npm run dev`; typecheck `npx tsc --noEmit`.

## Data flow
`ensureBootstrapped()` (in `db.ts`) runs once: seeds the 3-day split into `templates` and imports the bundled sheet snapshot (`src/data/history-seed.json`) via `parseWorkbook`. Guarded by a module-level promise + a `bootstrapped` setting (React StrictMode double-mounts effects → would double-seed otherwise). Future-dated sessions (sheet year typos) are dropped on import.

## Key files (anchor to symbols, not lines)
- `src/types.ts` — `Workout`, `ExercisePerf`, `SetEntry`, `Scheme`, `DayTemplate`.
- `src/db.ts` — Dexie `GymDB` (tables `workouts`, `templates`, `settings`), `DEFAULT_TEMPLATES` (the split, from the 2026 sheet tab), `ensureBootstrapped`, `lastWorkoutForDay`, `getSetting`/`setSetting`.
- `src/lib/sheet.ts` — sheet parser. `parseCSV`, `parseDate`, `parseScheme` (splits `"3x8 Bench"`), `parseCell` (dash-separated sets; handles Norwegian decimal comma, `xN`/`(N)`/`(N+M)`/`(3x8)` rep notations, `x`=skipped, free text), `parseSheet` (transposed layout → workouts), `parseWorkbook`.
- `src/lib/stats.ts` — `liftRecords` (per-lift max weight + best e1RM), `summarize` (streak/longest-break/busiest-month/heaviest), `canonName` (merges NO/EN variants), `epley`. `MAX_PLAUSIBLE_KG=500` filters sheet typos like `4040`.
- `src/lib/useActiveWorkout.ts` — the in-progress session hook. Persists a `Draft` to the `activeDraft` setting on every change (survives reload). `buildExercises` pre-fills weight from last session + reps from scheme.
- `src/lib/hr.ts` — `HeartRateMonitor` (Web Bluetooth standard HRS `0x180D`). Needs HTTPS + user gesture.
- `src/components/` — `Today` (orchestrator: day picker → logging → timers → finish), `ExerciseCard`, `SetInput` (thumb weight entry), `RestTimer` (beep+vibrate), `History`, `Settings`.
- `src/App.tsx` — shell: bootstrap, tab nav, owns HR monitor + settings state, export/reset.

## Invariants / gotchas
- The sheet is transposed: dates across columns, exercises as rows under a day-block header; each block has its OWN date columns. Two historical layouts (2018-19 two-col label vs 2021+ combined). Parser detects the date row and reads exercise values at those column indices.
- `finish()` saves exercises with any set weight OR a note; prefilled (untouched) weights DO get saved by design (prefill = intended lifts).
- HR only works over HTTPS (or localhost). For real phone use, deploy behind HTTPS (homelab NPM + Tailscale). Pair straps THROUGH the app, not OS Bluetooth.

## Not built yet
Google Sheets write-back / live re-sync (history is a bundled snapshot in `src/data/history-seed.json`); in-app template/exercise editing; per-lift progress charts; HTTPS homelab deploy.
