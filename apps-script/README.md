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

## Updating the script later
If you edit `Code.gs`, **Deploy → Manage deployments → (edit) → New version** so the `/exec` URL keeps working.

## Notes / limits
- The **year tab and day-block must already exist** in the sheet (matches your current structure). A brand-new year tab you'd add yourself first.
- Exercise names must match your sheet rows (the app's day templates were seeded from the 2026 tab, so they do). Renaming an exercise in one place needs the other updated.
- The secret only deters casual writes; treat the `/exec` URL as semi-private.
