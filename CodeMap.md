# CodeMap — NoBS (repo `no-bs`, formerly `gym-tracker`)

<!--
  A THIN, POINTER-BASED index of this codebase. Read first, update after changes.
  Rules (from ~/.claude/CLAUDE.md §5):
    - Anchor to SYMBOL names (functions/types), never line numbers — they rot.
    - Only what's expensive to rediscover: the map + invariants + gotchas + contracts.
    - Leave OUT anything re-derivable in ~10s by opening the named file. No per-function prose.
    - STAY THIN. Per-feature narrative → docs/ResearchJournal.md; behaviour facts/numbers →
      docs/KnowledgeBase.md. If it won't fit here, it belongs in one of those.
    - The stamp below is ONE line (NOT a changelog).
-->

_Last verified: 2026-08-03 @ 9b27c9b — verify pass: fixed the Data-flow bootstrap description (dropped the removed history-seed.json/parseWorkbook import; seeds GENERIC_TEMPLATES when empty) + corrected the db.ts template symbol name. (Pass 1 @1c82fe0 slimmed the 48 KB CODE-MAP into this thin index; sagas → ResearchJournal, on-device behaviour → KnowledgeBase.)_

## What this is
**NoBS – Workout Log**: a No-BS gym app — installable PWA + native Android (Capacitor), local-first (IndexedDB via Dexie). Landing page at nobs.codecrafts.cc. Stack: Vite 8 + React 19 + TypeScript, Dexie 4, `vite-plugin-pwa`, Web Bluetooth (HR). Run `npm run dev`; typecheck `npx tsc --noEmit`.

## Research-doc triad (this file is one of three)
- **`CodeMap.md`** (this) = the MACHINE: where code lives, invariants, gotchas, contracts. THIN by mandate.
- **`docs/KnowledgeBase.md`** = the MODEL: distilled on-device/platform behaviour (HW break, screen-off JS, HR, standards) with FACT/HYP tags. Read first for "how does it actually behave".
- **`docs/ResearchJournal.md`** = the HISTORY: the version changelog + every saga (rebrand, security incident, earbud investigation, reverted experiments).
- Other docs: `DEPLOY.md`, `docs/ROADMAP.md` (commercialization), `docs/PLAY-SUBMISSION.md`, `docs/TESTING-FEEDBACK.md` (PENDING on-device verifications), `docs/exercise-model.md` (the smart-logic design), `apps-script/README.md`.

## Identity / naming (CONTRACT — `applicationId` ≠ `namespace` is intentional)
- **Public Play identity `applicationId` = `net.agentas.nobs`** (`android/app/build.gradle` + `capacitor.config.ts` appId) — **locks forever at first Play upload**. Java **namespace/package stays `no.defc0n.gymtracker`** (invisible) + homelab deploy path `/apps/gym-tracker` stays old. No Java package rename was done — manifest relative names (`.MainActivity`) resolve against the namespace; `${applicationId}` refs (FileProvider authority) use the new id.
- IndexedDB db name stays `gym-tracker` (renaming orphans all data). App launcher label `NoBS` / display name "NoBS – Workout Log" set in `capacitor.config.ts` appName, `strings.xml`, `vite.config.ts` PWA manifest, `index.html`.
- Migration/rebrand history (domains, appId) → `ResearchJournal.md`.

## Data flow
`ensureBootstrapped()` (`db.ts`, `doBootstrap`) runs once: when `templates` is empty it seeds the generic starter split (`GENERIC_TEMPLATES`), then sets the `bootstrapped` setting. Guarded by a module promise + that flag (StrictMode double-mounts effects → would double-seed). **Ships no history** — since 1.47.0 the build imports nobody's data; workout history comes only from the user's own import/restore (see the SECURITY INVARIANT below).

## Subsystems (where things live)
_Anchor to the symbol; grep the file. Behaviour numbers → KnowledgeBase; "how we found it" → ResearchJournal._

### Core data & types
- **Types** → `src/types.ts` — `Workout`, `ExercisePerf`, `SetEntry`, `Scheme`, `DayTemplate`, `StoredWorkout` (`.track`, `.custom`).
- **DB** → `src/db.ts` — Dexie `GymDB` (`workouts`, `templates`, `settings`, `customSounds` v2, `exercises` v3), `GENERIC_TEMPLATES`, `ensureBootstrapped`, `lastWorkoutForDay`, `getSetting`/`setSetting`.

### Exercise model, stats, standards
- **Exercise catalog / identity** → `lib/exercises.ts` — the smart-logic source of truth. `Exercise`, `LIBRARY` (~90, Norwegian aliases), `resolveExercise(name, exerciseId?)` (exact-normalised `norm()`, user catalog > built-ins, else regex), `MUSCLE_ORDER`, legacy fallback `canonName`/`canonKey`/`muscleGroup`/`CANON`, `standardKey`, `registerCustomExercises`, `searchExercises`. Classification is READ-TIME derived — see KnowledgeBase.
- **Stats** → `lib/stats.ts` — `liftRecords`/`progression` (identity = `resolveExercise().id`, carries `muscle`+`standardKey`), `summarize`, `cadenceStatus`/`trainingDue` (green/orange/red vs weekly goal), `epley`; `MAX_PLAUSIBLE_KG=500` typo filter.
- **Strength standards** → `lib/standards.ts` — `KEY_LIFTS`/`rateLift` keyed by `standardKey` (squat/bench/deadlift/ohp/pulldown/legpress), male only. Needs `bodyweightKg` setting. TODO P2: female standards + sex. (Numbers → KnowledgeBase.)
- **Running standards** → `lib/runStandards.ts` — `PACE_TIERS`/`paceLadder` (absolute ladder) + `paceMedals` (personal-best gold/silver/bronze); `runsFrom`/`runPBs` off `runStats.computeRun`. Records "Running" section shows only when GPS runs exist.
- **Units** → `lib/units.ts` — kg canonical, lb display-only. `toDisplayWeight`/`fromDisplayWeight`/`weightStr`/`fmtWeight`/`displayStep`; `units` setting threads App→Today/Records/History/Settings.
- **User catalog** → Dexie `exercises` v3 via `listExercises`/`upsertExercise`/`deleteExercise`/`distinctExerciseNames`; registered into the resolver by App on load.
- **Per-exercise rest** → `lib/exerciseRest.ts` — singleton `Record<exerciseId, seconds>` in settings (`exerciseRest`), keyed by RESOLVED id. `loadExerciseRest`/`restForId`/`setRestForId` (copy-rewrites the shared map → persist SEQUENTIALLY, not `Promise.all`). Edited only in `TemplateEditor` (⏱ select), NOT the live card.

### Workout session (the Today orchestrator)
- **Active-workout hook** → `lib/useActiveWorkout.ts` — persists a `Draft` to the `activeDraft` setting on every change (survives reload); `buildExercises` prefills weight from the most recent session that logged a weight + reps from scheme.
- **Today** → `components/Today.tsx` — day picker → logging → timers → finish. `finishNow(auto, reason?)` (manual=false wall-clock; watchdog=true geofence/HR-dropout, silent, exitPip); `finish()` sets `StoredWorkout.custom` for Alternative sessions; `showAutoEndNotification`. Header tool sheets (stopwatch + mood, `.hr-modal`); `MoodSlider` shared with finish-prompt + `MoodLogModal`.
- **Set logging** → `components/ExerciseCard.tsx`, `components/SetInput.tsx` — thumb weight entry; `defaultReps` cue (`.reps-over`/`.reps-under` border); swipe-right / ↺ = "Last time" panel (`fmtPrevSet`). `ExerciseNameField.tsx` = autocomplete + inline create-custom.
- **Templates** → `components/TemplateEditor.tsx` — create/edit reusable workouts → `db.templates`; per-row ±kg step (`DayTemplate.exercises[].step`) + ⏱ break select.
- **Timer** → PAUSABLE (1.48.0): `wElapsedMs = wAccumMs + (wRunning ? now-wSegStart : 0)`; `toggleWorkoutTimer` banks/resumes; `startWorkoutTimer` skips when `wAccumMs>0` (pause sticks) and when `editId` is set (History-edit never restarts the clock). Manual finish honors paused total; auto-end uses `lastActivityAt`.

### Timers / PiP / break sounds
- **PiP** → `lib/pip.ts`, `components/PipView.tsx`, `PipPlugin.java` — floating timer (native). Rendered as an OVERLAY portaled to `document.body` (not by unmounting Today) so per-card state survives; live timer + current/avg HR. `floatMode` setting ("pip"|"off"). Only PiP shows live HR — see KnowledgeBase.
- **Break sounds** → `lib/sounds.ts` — all Web Audio synth (`tone`/`strike` + a `drum()` engine for war-drum patterns); `playBreakSound(id)` / `playBuffer`+`decodeSound` (uploads) / `playBreakStart()` / `playSoundChoice`. `components/SoundField.tsx` = reusable presets+upload+preview picker. Custom sounds: Dexie `customSounds` v2 (blobs on-device); `breakSound` = built-in id or `custom:<id>`.
- **Rest timer** → `components/RestTimer.tsx` — beep+vibrate; `restForId(id) ?? restDefaultSec`. `keepScreenOn` setting → native `setKeepAwake` + web WakeLock.

### Hardware buttons & audio (native)
- **Volume→break** → `lib/hwButtons.ts` + `HwButtonsPlugin.java` — two INDEPENDENT opt-in toggles, armed only during a workout, both firing `volumeKey`→`hwBreakRef`: **(1) `volumeUpBreak`** = BT earbud rocker via a `ContentObserver` on `Settings.System` volume (phone keys then SUPPRESSED via `suppressVolumeChange`); **(2) `phoneVolumeBreak`** = phone's own keys CONSUMED → `firePhoneKeyBreak()` (300ms-debounced). Both-on = no HW volume control. Also hosts `duck()` (audio ducking). Old APKs: JS no-ops. Full signal-path behaviour + on-device findings → KnowledgeBase / ResearchJournal.
- **Reactive toggles** (1.53.0): `autoBreakOnDone`/`volumeUpBreak`/`phoneVolumeBreak`/`mediaBtnBreak` read via `useLiveQuery(getSetting…)` so flipping a Settings toggle arms/disarms MID-workout (was mount-only).

### GPS / geofence / running
- **GPS track** → `lib/tracker.ts` + `lib/runStats.ts` + `components/RunMap.tsx` — `startTracking(getBpm)`/`stopTracking` record `TrackPoint[]`; DRAINS a native fix buffer (`getBufferedLocations`, **patch-package** in `patches/`, reapplied by `postinstall`) on a 4 s timer, falling back to the JS callback on un-patched APKs (screen-off JS suspension → KnowledgeBase). `computeRun`/`fmtPace`/`fmtDist`; `RunMap` draws the route with **Leaflet** over OSM tiles (`TILE_URL` swappable). Shown in `History` `RunDetail`.
- **Shareable routes** → `lib/polyline.ts` + `components/RouteViewer.tsx` — `sheetSync` writes a `Route` cell `${APP_PUBLIC_URL}/#route=<polyline>` (thinned to 250 pts); `App.readRouteHash` (before the bootstrap gate) → full-screen `RouteViewer`. `SKIP_LABELS` in `sheet.ts` keeps Route/Distance/Pace/Speed from importing as fake exercises.
- **Geofence** → `lib/geofence.ts` — leave-area auto-end (native). `startGeofence(onLeave)` anchors to the first fix, fires after >100 m for 5 min; `autoEndOnLeave` setting. ARMED only near the end (`geoArmed` latches at ≥60% sets done OR 12 min idle) to cut the persistent FGS notification. Mutually exclusive with the tracker.

### Sheets sync & backup
- **Sheets sync** → `lib/sheetSync.ts` — Google Sheets (native `CapacitorHttp`, web text/plain to skip preflight). `syncWorkout` (POST finished session, `mood`="before→after", `allowCreate`), `cellFor`, `testSync`, `syncPending`/`pendingCount`, `importFromSheet` (`action:pull`, dedup `dayName@@date`), `syncBodyweight`, `syncProfile`/`mergeProfile` (age+sex `Profile` tab — needs a `Code.gs` redeploy). Config in settings `sheetSyncUrl`/`sheetSyncSecret`.
- **Apps Script** → `apps-script/Code.gs` (bound Web App) — `doPost` (year tab→day-block→next empty column, scheme-stripped name match, Note+Mood+Time-of-day meta rows), `createBlock` (Alternative sessions), `writeBodyweight`/`writeProfile`, `action:pull`, read-only `action:"summary"`/`"liftSummary"` (HA voice assistant — `scanRecentTabs`/`topSetKg`/`KEY_LIFTS` mirror `lib/exercises.ts`). ⚠ After ANY redeploy verify `debug:true` `fns` fingerprints, NOT the `v` marker (mid-file drift saga → ResearchJournal 2026-07-24). `normName` = zero-width/NBSP/× tolerance.
- **Backup / restore** → `lib/workbook.ts` + `lib/download.ts` — `.xlsx`/JSON (SheetJS, lazy). `exportXlsx`/`workbookTabs` build transposed year tabs + Bodyweight tab + a hidden `_data` JSON (lossless, incl. GPS tracks) + (v3, 1.51.5) an allowlisted `Settings` tab (`BACKUP_SETTINGS`). `importXlsx` prefers `_data`; `applyBackup` adds missing workouts + merges bodyweight/settings. `saveFile` = web download / native share-sheet. ⚠ `BACKUP_SETTINGS` EXCLUDES sync credentials + transient state — never add `sheetSync*`/`syncEnabled`/`activeDraft` (a shared backup must not leak the secret).

### HR / notifications
- **HR** → `lib/hr.ts` — `HeartRateMonitor` (Web Bluetooth HRS `0x180D`); needs HTTPS + user gesture. Low-HR warning (`lowHrWarn`/`lowHrWarnBpm`/`lowHrSound`) is POLLED (3 s) not reactive — see KnowledgeBase. Separate from the `hrLowThreshold` 10-min auto-end.
- **Notifications** → `lib/notify.ts` — `requestNotifications`/`showReminder`/`scheduleTrainingReminders`/`cancelTrainingReminders`; on-open nudge + native pre-scheduled LocalNotifications for the next due day (fire with app CLOSED). `onNotificationTap` (pure-JS listener, OTA-safe) → `moodLogId` → `MoodLogModal`. Reminders use a dedicated HIGH channel.

### UI / design system ("Molten", 2026-07-14)
- **Tokens** → `src/index.css` — CSS vars on `:root` (dark default) + `:root[data-theme="light"]`. Identity: `--accent` molten orange `#ff5a2c` (do NOT reuse blue), `--accent-2` success green (semantic), `--volt` gold (celebratory PR/GO only), `--danger`/`--warn`; spacing `--s1..--s6`, `--radius`, `--ctl-h` 44px.
- **Type** → `--display` = Archivo Variable (self-hosted via `@fontsource-variable/archivo`, imported in `main.tsx`; needs `src/fontsource.d.ts`). **USER PREFERENCE: display font on NUMBERS ONLY** (`.wb-timer`/`.stat-value`/weight+reps inputs/`.num`, `tabular-nums`) — do NOT re-apply to text.
- **Buttons** → **USER PREFERENCE: keep the existing palette** (`.primary` = green `--accent-2`, `.ghost` transparent, `.mini`/`.seg`). Do NOT recolour (a molten-accent unify was reverted — see ResearchJournal).
- **Primitives / structure** → `components/Switch.tsx` (real `role="switch"`, controlled), `components/icons.tsx` (inline SVG, `currentColor` — tab bar tints via `.tabbar button.active`; muscle PNGs tinted via CSS `mask-image`). Settings = 7 accordion groups (`<details>`), user prefers FEWER combined categories.
- **Other UI** → `components/`: `History` (+ `RunDetail`), `Settings`, `Records.tsx` (`ActivityHeatmap`, running section), `ProgressChart` (dep-free SVG est-1RM line), `SheetsGuide.tsx` (bundles `Code.gs` via `?raw`).
- **App shell** → `src/App.tsx` — bootstrap, tab nav (all four `.tabpanel` divs stay MOUNTED — Today must, for its effects; per-tab scroll memory via `go(tab)`), owns HR monitor + settings, export/reset. Tab label "Today"→"Workout" (1.53.0) but the tab **id stays `"today"`**. Android hardware back: ONE `@capacitor/app` `backButton` listener in Today (live tab/draft via ref) — never register a second (all fire).

### Native (Capacitor / Android) & build flavours
- **Wrapper** → `android/`, Capacitor 8. Plugins: bluetooth-le (HR), local-notifications, capgo updater (OTA JS-only), background-geolocation (patch-packaged), app (build-flavour id for the Extended badge), share, filesystem, + custom **Pip**/**HwButtons** plugins (`android/app/src/main/java/no/defc0n/gymtracker/`). Native changes (new plugin/manifest/Java) need a fresh APK — OTA won't deliver them.
- **Build flavours** (`android/app/build.gradle`, `flavorDimensions "distribution"`) — `standard` = Play/public build; `extended` = sideload-only, additionally compiles `android/app/src/extended/` → **`VolumeKeyAccessibilityService`** (global `onKeyEvent`, calls `suppressVolumeChange()` so a locked phone-key stays volume). **Play rejects non-accessibility uses — that service is the entire reason there are two flavours; it must NEVER be in `standard`.** Since 1.51.3 `extended` is its OWN app (`applicationIdSuffix ".extended"` → `net.agentas.nobs.extended`, label "NoBS Extended" in `src/extended/res/values/strings.xml`), release-signed → installs SIDE-BY-SIDE. Runtime "Extended" badge gated on package id by `lib/buildInfo.ts`.
- **Ship:** `npm run build && npx cap sync android` then `gradlew.bat bundleStandardRelease` (Play AAB) / `assembleExtendedRelease` (sideload APK → `nobs.agentas.net/dl/nobs.apk`, out-of-git `/apps/nobs-dl` on CT 107 — replace via `scp`+`pct push`). Both need `JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`. Debug: `gradlew.bat assembleDebug`. JS-only ships via OTA (Capgo). Verify a flavour: `unzip -l <apk> | grep -ci volume_key_service` (extended 1 / standard 0) or `aapt2 dump badging <apk>`.

## Invariants & gotchas
_Rule only; the discovery saga is in ResearchJournal, the behaviour model in KnowledgeBase._
- ⚠ **SECURITY INVARIANT**: app.agentas.net + its OTA bundles are PUBLIC. Since **1.47.0 no build bakes in personal config** — `VITE_SYNC_*`/`VITE_SEED` + `src/data/history-seed.json` DELETED from source; sync is per-device in Settings. Do NOT reintroduce a baked-default seam (that leaked the sync secret + personal history until 2026-07-12 — incident + filter-repo rewrite in ResearchJournal). Standing: `capacitor.config` CapacitorUpdater MUST keep `statsUrl`/`updateUrl`/`channelUrl = ""` (Capgo posts telemetry by default — privacy-policy violation); manifest keeps `allowBackup=false` + `BackgroundGeolocationService exported=false`; `ACCESS_BACKGROUND_LOCATION` removed (never re-add). ⚠ `history-seed.json` still in GIT HISTORY in 1 commit — purge before any public showcase.
- **Service worker is web-only.** `main.tsx` registers the vite-plugin-pwa SW only in the browser; native UNREGISTERS + clears caches (a precaching SW serves a stale bundle after a Capgo OTA — the Capgo-vs-SW trap). `vite.config.ts` `injectRegister: null`. Never re-enable auto-registration.
- **`Code.gs` `metaKind` must match the label sets in `sheet.ts`** (NOTE/MOOD/TIME/HR/SKIP) — a label the parser treats as meta but the script doesn't → a duplicate meta row. New meta rows need editing both sides AND a `Code.gs` redeploy.
- **Geofence and GPS tracker watchers are mutually exclusive** — geofence only for non-custom sessions, tracker only for `custom + trackGps`. Both are FGS geolocation watchers; two at once double-drain battery. Each `start*` guards a stop-before-`addWatcher`-resolves race (a `starting` flag).
- **Exercises/sets carry a `uid()` `id`** used as the React key — never key those lists by array index (local `showNote` state bleeds across a reorder/remove).
- **`exerciseId` threads identity** through `buildExercises`/`liftRecords`/`progression`/ghost-hint via `resolveExercise(name, exerciseId)` so identity survives renames.
- **Mid-session alternative exercise**: `addExercise` flags `added` on `ExercisePerf` when `!draft.custom` (template rows stay fixed, added ones named/removable). Added exercises save locally but do NOT sync — `Code.gs doPost` only writes EXISTING block rows; only fully-custom Alternative sessions get an auto-created block.
- **History "Edit" loads the workout into the Today editor** (`beginEdit` sets `draft.editId`); finishing UPDATES that row (no re-sync — would append a sheet column).
- **Only mark a workout `synced` when the sheet took the exercises** (`syncWorkout` checks `result.written`) — a name mismatch (`ok:true, written:[]`) must not claim success.
- **Per-exercise step** `stepForExercise(name, fallback, override)` resolves override → name-heuristic (single-arm/incline → 2 kg) → Settings default; override carried in the `_data` backup, not the visible sheet.
- **`finish()`** saves exercises with any set weight OR a note; prefilled untouched weights DO save (prefill = intended lifts).
- **Sheet is transposed** (dates across columns, exercises as rows under a per-block header) — two historical layouts; the parser detects the date row. See KnowledgeBase.

## Known landmines / deferred
- **`src/data/history-seed.json` in git history** — real user data; purge before any public/AGPL showcase (see `feedback_private_to_public_migration_audit` + ResearchJournal 2026-07-12).
- **PENDING on-device verification** (`docs/TESTING-FEEDBACK.md`): GPS screen-off fix (bug #2), cardio sheet-sync `metaRow` (bug #1), the 1.52.0/1.53.0 OTA batches.
- **Residual earbud-break MISSES** — low priority, behaviour acceptable (KnowledgeBase, open issue).
- **Not built yet:** P4 copy polish + PR/GO `--volt` moments. (Google Sheets read+write-back, in-app template/exercise editing, and per-lift charts ARE built.)
