import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import "./App.css";
import { db, ensureBootstrapped, getSetting, listExercises, setSetting, type StoredWorkout } from "./db";
import { registerCustomExercises } from "./lib/exercises";
import { loadExerciseRest } from "./lib/exerciseRest";
import type { WeightUnit } from "./lib/units";
import { daysAgo } from "./lib/format";
import { type HrMonitor, createHrMonitor, hrAvailable } from "./lib/hr";
import { Capacitor } from "@capacitor/core";
import { notificationsAllowed, onNotificationTap, requestNotifications, scheduleTrainingReminders, showReminder } from "./lib/notify";
import { markAppReady } from "./lib/update";
import { isExtendedBuild } from "./lib/buildInfo";
import { collectSettings } from "./lib/workbook";
import { setKeepAwake } from "./lib/pip";
import { saveFile } from "./lib/download";
import { syncBodyweight, syncProfile } from "./lib/sheetSync";
import type { BwEntry, Sex } from "./lib/standards";
import { trainingDue } from "./lib/stats";
import { History } from "./components/History";
import { Records } from "./components/Records";
// Lazy so Leaflet (+CSS) stays out of the cold-start bundle — only loaded on a map view.
const RouteViewer = lazy(() => import("./components/RouteViewer").then((m) => ({ default: m.RouteViewer })));
import { Settings } from "./components/Settings";
import { Today } from "./components/Today";
import { MoodLogModal } from "./components/MoodLogModal";
import { CalendarCheckIcon, DumbbellIcon, GearIcon, TrophyIcon } from "./components/icons";

type Tab = "today" | "history" | "records" | "settings";

// A "#route=<encoded polyline>" link (from a sheet Route cell) opens the map viewer.
// decodeURIComponent throws on truncated %-escapes (links mangled in copy/paste) —
// this runs in a useState initializer, so an uncaught throw white-screens the app.
function readRouteHash(): string | null {
  const m = /[#&]route=([^&]+)/.exec(location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// An OTA update reloads the app into the new bundle (update.ts stamps this before
// the reload). Pure read here (safe under StrictMode double-invoke); we clear it in
// an effect so the confirmation only shows once, right after the update reload.
function readJustUpdated(): string | null {
  try {
    return localStorage.getItem("nobs.justUpdated");
  } catch {
    return null;
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [updatedVersion] = useState<string | null>(readJustUpdated);
  const [showUpdated, setShowUpdated] = useState<boolean>(!!updatedVersion);
  const [tab, setTab] = useState<Tab>(updatedVersion ? "settings" : "today");
  const [routeHash, setRouteHash] = useState<string | null>(() => readRouteHash());
  const [pendingEdit, setPendingEdit] = useState<StoredWorkout | null>(null); // History → edit in Today
  const [moodLogId, setMoodLogId] = useState<number | null>(null); // auto-end notification tap → log mood
  const [extended, setExtended] = useState(false); // native Extended build → header badge

  // Feed the user's custom exercise catalog into the resolver (muscle/standard
  // lookups). Empty until the create-exercise UI (P1) writes entries.
  const customExercises = useLiveQuery(() => listExercises(), []);
  useEffect(() => {
    if (customExercises) registerCustomExercises(customExercises);
  }, [customExercises]);

  // Show the "Extended" badge only on the native Extended build.
  useEffect(() => {
    isExtendedBuild().then(setExtended);
  }, []);

  // All four tab panels stay mounted (Today MUST, so its workout/PiP/HR logic keeps
  // running when you're on another tab); we just toggle visibility. That also lets
  // us remember each panel's scroll position across tab + app switches.
  const panelRefs = useRef<Record<Tab, HTMLDivElement | null>>({ today: null, history: null, records: null, settings: null });
  const scrollPos = useRef<Record<Tab, number>>({ today: 0, history: 0, records: 0, settings: 0 });
  const go = (next: Tab) => {
    const cur = panelRefs.current[tab];
    if (cur) scrollPos.current[tab] = cur.scrollTop; // save while still visible
    setTab(next);
  };
  useLayoutEffect(() => {
    const el = panelRefs.current[tab];
    if (el) el.scrollTop = scrollPos.current[tab] ?? 0; // restore on show
  }, [tab]);

  // Settings (loaded from IndexedDB, persisted on change).
  const [restDefaultSec, setRest] = useState(90);
  const [weightStep, setStep] = useState(2.5);
  const [daysPerWeek, setDpw] = useState(4);
  const [bodyweightKg, setBw] = useState(0); // 0 = not set
  const [age, setAge] = useState(0); // 0 = not set
  const [sex, setSex] = useState<Sex>("male"); // strength-standard tables
  const [units, setUnits] = useState<WeightUnit>("kg"); // weight display/entry unit
  const [bwHistory, setBwH] = useState<BwEntry[]>([]);
  const [hrLowThreshold, setHrLow] = useState(80);
  const [floatMode, setFloatMode] = useState<"pip" | "off">("pip");
  const [keepScreenOn, setKeepScreenOn] = useState(false);

  // Heart rate.
  const [bpm, setBpm] = useState<number | null>(null);
  const [hrAvg, setHrAvg] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  // Running HR aggregate (O(1) per sample — avoids an unbounded array + O(n) reduce
  // and Math.max(...spread) on every packet during long sessions).
  const hrAgg = useRef({ sum: 0, count: 0, max: 0 });
  const monitor = useRef<HrMonitor | null>(null);
  if (!monitor.current) monitor.current = createHrMonitor((c) => setConnected(c));

  const templates = useLiveQuery(() => db.templates.orderBy("order").toArray(), []);

  useEffect(() => {
    const onHash = () => setRouteHash(readRouteHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Fire a local reminder if reminders are on and we're behind the weekly goal
  // (and haven't trained today or already nudged today).
  const maybeRemind = async (dpw: number) => {
    const enabled = await getSetting("remindersEnabled", false);
    if (!enabled || !(await notificationsAllowed())) return;
    const last = await db.workouts.orderBy("date").reverse().first();
    // Pre-schedule closed-app reminders from the latest workout (native no-ops on web).
    await scheduleTrainingReminders(dpw, last?.date ?? null);
    const today = new Date().toISOString().slice(0, 10);
    if ((await getSetting("lastReminder", "")) === today) return;
    const days = last ? daysAgo(last.date) : 999;
    const trainedToday = last ? last.date.slice(0, 10) === today : false;
    if (!trainedToday && trainingDue(days, dpw)) {
      await showReminder(
        "Time to train 💪",
        `It's been ${days} day${days === 1 ? "" : "s"} — train today to stay on your ${dpw}×/week goal.`,
      );
      await setSetting("lastReminder", today);
    }
  };

  // Clear the just-updated stamp once consumed so the banner shows only this once.
  useEffect(() => {
    if (updatedVersion) {
      try {
        localStorage.removeItem("nobs.justUpdated");
      } catch {
        /* ignore */
      }
    }
  }, [updatedVersion]);

  // Tapping the "workout auto-saved" notification opens the mood-logging modal for
  // that saved session (native; best-effort on a cold start).
  useEffect(() => onNotificationTap(setMoodLogId), []);

  useEffect(() => {
    (async () => {
      markAppReady(); // commit the running OTA bundle (native only)
      // Apply the stored theme ASAP (Settings toggles it live; dark = default).
      const theme = await getSetting<string>("theme", "dark");
      if (theme === "light") document.documentElement.dataset.theme = "light";
      await ensureBootstrapped();
      await loadExerciseRest(); // per-exercise rest overrides (global, by exercise id)
      setRest(await getSetting("restDefaultSec", 90));
      setStep(await getSetting("weightStep", 2.5));
      const dpw = await getSetting("daysPerWeek", 4);
      setDpw(dpw);
      setBw(await getSetting("bodyweightKg", 0));
      setAge(await getSetting("age", 0));
      setSex(await getSetting<Sex>("sex", "male"));
      setUnits(await getSetting<WeightUnit>("units", "kg"));
      setBwH(await getSetting<BwEntry[]>("bwHistory", []));
      setHrLow(await getSetting("hrLowThreshold", 80));
      // Coerce the removed "overlay" mode back to PiP for anyone who tried it.
      setFloatMode((await getSetting<string>("floatMode", "pip")) === "off" ? "off" : "pip");
      setKeepScreenOn(await getSetting("keepScreenOn", false));
      setReady(true);
      if (Capacitor.isNativePlatform()) requestNotifications(); // ask once so break alarms work
      await maybeRemind(dpw);
    })().catch((e) => {
      // A boot failure (IndexedDB quota/private mode, seed import) must show a
      // message + retry — not an eternal "Loading…" spinner.
      setBootError((e as Error).message || "Something went wrong while starting.");
    });
    const onVis = () => {
      if (document.visibilityState === "visible") getSetting("daysPerWeek", 4).then(maybeRemind);
    };
    document.addEventListener("visibilitychange", onVis);
    const off = monitor.current!.onData((v) => {
      setBpm(v);
      const a = hrAgg.current;
      a.sum += v;
      a.count += 1;
      if (v > a.max) a.max = v;
      setHrAvg(Math.round(a.sum / a.count));
    });
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Keep the screen awake — opt-in (default off). Native window flag holds while the
  // app is foreground OR in PiP; web Wake Lock is a foreground-only fallback.
  useEffect(() => {
    if (!keepScreenOn) {
      setKeepAwake(false);
      return;
    }
    setKeepAwake(true);
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    const request = async () => {
      try {
        if (nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch {
        /* denied or unsupported */
      }
    };
    const onVis = () => document.visibilityState === "visible" && request();
    request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
      setKeepAwake(false);
    };
  }, [keepScreenOn]);

  const connect = async () => {
    try {
      await monitor.current!.connect();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const disconnect = () => {
    monitor.current!.disconnect();
    setBpm(null);
  };
  const hr = { bpm, avg: hrAvg, connected, connect, disconnect, supported: hrAvailable() };

  const getHrStats = () => {
    const a = hrAgg.current;
    if (a.count === 0) return {};
    return { avg: Math.round(a.sum / a.count), max: a.max };
  };

  const persistRest = (v: number) => {
    setRest(v);
    setSetting("restDefaultSec", v);
  };
  const persistStep = (v: number) => {
    setStep(v);
    setSetting("weightStep", v);
  };
  const persistDpw = (v: number) => {
    setDpw(v);
    setSetting("daysPerWeek", v);
  };
  const persistBw = (v: number) => {
    setBw(v);
    setSetting("bodyweightKg", v).then(() => syncBodyweight());
  };
  const persistAge = (v: number) => {
    setAge(v);
    setSetting("age", v).then(() => syncProfile());
  };
  const persistSex = (v: Sex) => {
    setSex(v);
    setSetting("sex", v).then(() => syncProfile());
  };
  const persistUnits = (v: WeightUnit) => {
    setUnits(v);
    setSetting("units", v);
  };
  const persistHrLow = (v: number) => {
    setHrLow(v);
    setSetting("hrLowThreshold", v);
  };
  const persistFloatMode = (v: "pip" | "off") => {
    setFloatMode(v);
    setSetting("floatMode", v);
  };
  const persistKeepScreenOn = (v: boolean) => {
    setKeepScreenOn(v);
    setSetting("keepScreenOn", v);
  };
  const persistBwHistory = (v: BwEntry[]) => {
    setBwH(v);
    setSetting("bwHistory", v).then(() => syncBodyweight());
  };
  // Refresh bodyweight state from settings after an import wrote to them
  // (no re-sync — importFromSheet already reconciled with the sheet).
  const reloadBodyweight = async () => {
    setBw(await getSetting("bodyweightKg", 0));
    setBwH(await getSetting<BwEntry[]>("bwHistory", []));
  };

  const onExport = async () => {
    const data = {
      v: 3,
      workouts: await db.workouts.toArray(),
      templates: await db.templates.toArray(),
      bwHistory: await getSetting<BwEntry[]>("bwHistory", []),
      // Allowlisted preferences only (collectSettings excludes sync credentials +
      // transient state), as an object that restore reads back through applyBackup.
      settings: await collectSettings(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    await saveFile(`gym-backup-${new Date().toISOString().slice(0, 10)}.json`, blob);
  };

  const onReset = async () => {
    if (!confirm("Erase all local data and re-import your sheet history?")) return;
    await db.delete();
    location.reload();
  };

  // A route link is self-contained — show the viewer without waiting for bootstrap.
  if (routeHash)
    return (
      <Suspense fallback={<div className="boot">Loading map…</div>}>
        <RouteViewer
          encoded={routeHash}
          onClose={() => {
            history.replaceState(null, "", location.pathname + location.search);
            setRouteHash(null);
          }}
        />
      </Suspense>
    );

  if (bootError)
    return (
      <div className="boot">
        <p>Couldn't start: {bootError}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </div>
    );
  if (!ready || !templates) return <div className="boot">Loading…</div>;

  return (
    <div className="app">
      {extended && <span className="ext-badge">Extended</span>}
      {showUpdated && (
        <div className="update-banner" role="status">
          <span>✓ Updated to v{updatedVersion?.split("+")[0]} — you're on the latest.</span>
          <button className="update-banner-x" onClick={() => setShowUpdated(false)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="tabpanel" hidden={tab !== "today"} ref={(el) => { panelRefs.current.today = el; }}>
        <Today
          templates={templates}
          restDefaultSec={restDefaultSec}
          weightStep={weightStep}
          units={units}
          daysPerWeek={daysPerWeek}
          hrLowThreshold={hrLowThreshold}
          hr={hr}
          onWorkoutStart={() => {
            hrAgg.current = { sum: 0, count: 0, max: 0 };
            setHrAvg(null);
          }}
          getHrStats={getHrStats}
          onFinished={() => {
            go("history");
            // Finishing a workout moves the next "due" date — reschedule.
            maybeRemind(daysPerWeek);
          }}
          editWorkout={pendingEdit}
          onEditConsumed={() => setPendingEdit(null)}
          floatMode={floatMode}
          activeTab={tab}
          goToday={() => go("today")}
        />
      </div>

      <div className="tabpanel" hidden={tab !== "history"} ref={(el) => { panelRefs.current.history = el; }}>
        <History
          onEdit={async (w) => {
            // Only one session lives in the editor at a time. Don't let editing a
            // past workout clobber a live in-progress one.
            const active = await getSetting<{ editId?: number } | null>("activeDraft", null);
            if (active && active.editId == null) {
              alert("Finish or reset your current workout first, then edit a past one.");
              return;
            }
            setPendingEdit(w);
            go("today");
          }}
          units={units}
        />
      </div>

      <div className="tabpanel" hidden={tab !== "records"} ref={(el) => { panelRefs.current.records = el; }}>
        <Records bodyweightKg={bodyweightKg} age={age} sex={sex} units={units} bwHistory={bwHistory} />
      </div>

      <div className="tabpanel" hidden={tab !== "settings"} ref={(el) => { panelRefs.current.settings = el; }}>
        <Settings
          restDefaultSec={restDefaultSec}
          setRestDefaultSec={persistRest}
          weightStep={weightStep}
          setWeightStep={persistStep}
          daysPerWeek={daysPerWeek}
          setDaysPerWeek={persistDpw}
          bodyweightKg={bodyweightKg}
          setBodyweightKg={persistBw}
          age={age}
          setAge={persistAge}
          sex={sex}
          setSex={persistSex}
          units={units}
          setUnits={persistUnits}
          bwHistory={bwHistory}
          setBwHistory={persistBwHistory}
          hrLowThreshold={hrLowThreshold}
          setHrLowThreshold={persistHrLow}
          hr={hr}
          onImported={reloadBodyweight}
          onExport={onExport}
          onReset={onReset}
          floatMode={floatMode}
          setFloatMode={persistFloatMode}
          keepScreenOn={keepScreenOn}
          setKeepScreenOn={persistKeepScreenOn}
        />
      </div>

      <nav className="tabbar">
        <button className={tab === "today" ? "active" : ""} onClick={() => go("today")}>
          <span className="ico"><DumbbellIcon /></span>Workout
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => go("history")}>
          <span className="ico"><CalendarCheckIcon /></span>History
        </button>
        <button className={tab === "records" ? "active" : ""} onClick={() => go("records")}>
          <span className="ico"><TrophyIcon /></span>Records
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => go("settings")}>
          <span className="ico"><GearIcon /></span>Settings
        </button>
      </nav>

      {moodLogId != null && <MoodLogModal workoutId={moodLogId} onClose={() => setMoodLogId(null)} />}
    </div>
  );
}
