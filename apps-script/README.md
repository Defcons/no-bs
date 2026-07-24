# Google Sheets write-back — setup (once)

The app writes finished workouts back into the **Trening** sheet via a bound Apps Script Web App. No Google Cloud / OAuth needed — the script runs as you.

## 1. Create the script
1. Open the sheet → **Extensions → Apps Script**.
2. Delete the default `Code.gs` contents and paste the contents of [`Code.gs`](./Code.gs).
3. At the top, change `var SECRET = "CHANGE_ME";` to a long random string (e.g. from a password manager). Remember it.
4. Save (💾).

## 2. Deploy as a Web App
1. **Deploy → New deployment**.
2. Gear icon → type **Web app**.
3. **Execute as:** `Me` (so it can write your private sheet).
4. **Who has access:** `Anyone`. (Access is still gated by your secret; the URL is unguessable. Required so the browser can call it.)
5. **Deploy** → authorize when prompted → copy the **Web app URL** (ends in `/exec`).

## 3. Configure the app
In the app: **Settings → Google Sheets sync** →
- paste the **Web app URL**,
- paste the **same secret**,
- tap **Test connection** (should say ✓).

From then on, tapping **Finish workout** writes a new dated column into the correct year tab + day-block. Anything logged while offline/unconfigured queues up — hit **Sync now** in Settings to push it.

## How it writes
For the workout's year tab (e.g. `2026`), it finds the day-block whose header cell equals the day name (e.g. `Chest & Arms`), writes the date (`dd.mm.yy`) in the first empty column of that header row, and fills each exercise row (matched by name, ignoring the `3x8` prefix) with the sets string (e.g. `72,5-70-70`, reps annotated as `(6)` only when they differ from the scheme). The day note goes in the block's `Note` row.

## Read-only summary API (Home Assistant voice)

Two read actions let external consumers (the HA voice assistant) query the sheet. Same POST body + secret as the sync actions; they never write, and they scan only the **current + previous year tabs** (one displayValues read each).

`{ "secret": "...", "action": "summary" }` →

```json
{
  "ok": true,
  "lastWorkout": { "date": "2026-07-23", "dayName": "Running", "daysAgo": 1 },
  "weekWorkouts": 3,
  "nextSplit": { "dayName": "Legs", "lastDate": "2026-07-16", "daysAgo": 8 },
  "days": [ { "dayName": "Pull", "lastDate": "2026-07-22", "daysAgo": 2, "sessions": 12, "split": true } ],
  "lifts": { "deadlift": { "lastKg": 140, "lastDate": "2026-07-14", "bestKg": 150 } }
}
```

- `lastWorkout.dayName` answers "what workout/split did I do" — it's the sheet block name, so one-off blocks (Running, Innebandy…) show up too.
- `weekWorkouts` = sessions in the current ISO week (Mon–Sun).
- `nextSplit` = the least-recently-done strength split in the current year tab (the app's "reddest" day-picker entry) — answers "what split is next/today". Falls back to the previous year's splits while a fresh year tab is still empty.
- `days` = every day-block, splits **and** cardio blocks alike, most recent first (capped at 20) — answers "when did I last swim". `split` = the block has scheme-prefixed rows (`3x5 …`), which template splits always have and app-created cardio blocks never do. `sessions` counts dated columns in the scanned two years.
- `lifts` has all four of `deadlift` / `squat` / `bench` / `ohp`; values are the **top set per session** (heaviest token in cells like `72,5-70-70`), `bestKg` the best across the scanned two years. A lift with no data → `null`.

`{ "secret": "...", "action": "liftSummary", "exercise": "bench" }` →

```json
{ "ok": true, "exercise": "bench", "found": true, "lastKg": 75, "lastDate": "2026-07-20", "bestKg": 80,
  "sessions": [ { "date": "2026-07-20", "topKg": 75 } ] }
```

`sessions` = the 3 most recent. Matching is the same as write-back — exact scheme-stripped row-label match — and the four headline lifts accept their app aliases (`bench` → "Bench Press", `markløft` → "Deadlift"). Rep-only exercises (pull-ups logged as `(10)-(9)`) carry no weight and report `found: false`; an unknown name does too.

The summary response carries `v` (script version marker — compare it after a redeploy to confirm the new code is live) and, with `"debug": true` in the request, a `debug` block (session/occurrence counts + the distinct row names the scanner saw) for troubleshooting mismatches.

## Updating the script later
If you edit `Code.gs`, **Deploy → Manage deployments → (edit) → New version** so the `/exec` URL keeps working.

## Notes / limits
- The **year tab and day-block must already exist** in the sheet (matches your current structure). A brand-new year tab you'd add yourself first.
- Exercise names must match your sheet rows (the app's day templates were seeded from the 2026 tab, so they do). Renaming an exercise in one place needs the other updated.
- The secret only deters casual writes; treat the `/exec` URL as semi-private.
