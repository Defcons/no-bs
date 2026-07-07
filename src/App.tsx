import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import "./App.css";
import { db, ensureBootstrapped, getSetting, setSetting, type StoredWorkout } from "./db";
import { daysAgo } from "./lib/format";
import { type HrMonitor, createHrMonitor, hrAvailable } from "./lib/hr";
import { Capacitor } from "@capacitor/core";
import { notificationsAllowed, requestNotifications, showReminder } from "./lib/notify";
import { markAppReady } from "./lib/update";
import { saveFile } from "./lib/download";
import { syncBodyweight } from "./lib/sheetSync";
import type { BwEntry } from "./lib/standards";
import { trainingDue } from "./lib/stats";
import { History } from "./components/History";
import { Records } from "./components/Records";
// Lazy so Leaflet (+CSS) stays out of the cold-start bundle — only loaded on a map view.
const RouteViewer = lazy(() => import("./components/RouteViewer").then((m) => ({ default: m.RouteViewer })));
import { Settings } from "./components/Settings";
import { Today } from "./components/Today";

type Tab = "today" | "history" | "records" | "settings";

// A "#route=<encoded polyline>" link (from a sheet Route cell) opens the map viewer.
function readRouteHash(): string | null {
  const m = /[#&]route=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [routeHash, setRouteHash] = useState<string | null>(() => readRouteHash());
  const [pendingEdit, setPendingEdit] = useState<StoredWorkout | null>(null); // History → edit in Today

  // Settings (loaded from IndexedDB, persisted on change).
  const [restDefaultSec, setRest] = useState(120);
  const [weightStep, setStep] = useState(2.5);
  const [daysPerWeek, setDpw] = useState(4);
  const [bodyweightKg, setBw] = useState(0); // 0 = not set
  const [age, setAge] = useState(0); // 0 = not set
  const [bwHistory, setBwH] = useState<BwEntry[]>([]);
  const [hrLowThreshold, setHrLow] = useState(90);
  const [floatMode, setFloatMode] = useState<"pip" | "overlay" | "off">("pip");
  const [floatSizeSp, setFloatSizeSp] = useState(22);

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
    const today = new Date().toISOString().slice(0, 10);
    if ((await getSetting("lastReminder", "")) === today) return;
    const last = await db.workouts.orderBy("date").reverse().first();
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

  useEffect(() => {
    (async () => {
      markAppReady(); // commit the running OTA bundle (native only)
      await ensureBootstrapped();
      setRest(await getSetting("restDefaultSec", 120));
      setStep(await getSetting("weightStep", 2.5));
      const dpw = await getSetting("daysPerWeek", 4);
      setDpw(dpw);
      setBw(await getSetting("bodyweightKg", 0));
      setAge(await getSetting("age", 0));
      setBwH(await getSetting<BwEntry[]>("bwHistory", []));
      setHrLow(await getSetting("hrLowThreshold", 90));
      setFloatMode(await getSetting<"pip" | "overlay" | "off">("floatMode", "pip"));
      setFloatSizeSp(await getSetting("floatSizeSp", 22));
      setReady(true);
      if (Capacitor.isNativePlatform()) requestNotifications(); // ask once so break alarms work
      await maybeRemind(dpw);
    })();
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

  // Keep the screen awake while the app is open (re-acquire when tab returns).
  useEffect(() => {
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
    };
  }, []);

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
    setSetting("age", v);
  };
  const persistHrLow = (v: number) => {
    setHrLow(v);
    setSetting("hrLowThreshold", v);
  };
  const persistFloatMode = (v: "pip" | "overlay" | "off") => {
    setFloatMode(v);
    setSetting("floatMode", v);
  };
  const persistFloatSize = (v: number) => {
    setFloatSizeSp(v);
    setSetting("floatSizeSp", v);
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
      workouts: await db.workouts.toArray(),
      templates: await db.templates.toArray(),
      settings: await db.settings.toArray(),
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

  if (!ready || !templates) return <div className="boot">Loading…</div>;

  return (
    <div className="app">
      <main className="content">
        {tab === "today" && (
          <Today
            templates={templates}
            restDefaultSec={restDefaultSec}
            weightStep={weightStep}
            daysPerWeek={daysPerWeek}
            hrLowThreshold={hrLowThreshold}
            hr={hr}
            onWorkoutStart={() => {
              hrAgg.current = { sum: 0, count: 0, max: 0 };
              setHrAvg(null);
            }}
            getHrStats={getHrStats}
            onFinished={() => setTab("history")}
            editWorkout={pendingEdit}
            onEditConsumed={() => setPendingEdit(null)}
            floatMode={floatMode}
            floatSizeSp={floatSizeSp}
          />
        )}
        {tab === "history" && (
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
              setTab("today");
            }}
          />
        )}
        {tab === "records" && <Records bodyweightKg={bodyweightKg} age={age} bwHistory={bwHistory} />}
        {tab === "settings" && (
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
            floatSizeSp={floatSizeSp}
            setFloatSizeSp={persistFloatSize}
          />
        )}
      </main>

      <nav className="tabbar">
        <button className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>
          <span className="ico">🏋️</span>Today
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          <span className="ico">📅</span>History
        </button>
        <button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}>
          <span className="ico">🏆</span>Records
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          <span className="ico">⚙️</span>Settings
        </button>
      </nav>
    </div>
  );
}
