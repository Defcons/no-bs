import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import "./App.css";
import { db, ensureBootstrapped, getSetting, setSetting } from "./db";
import { daysAgo } from "./lib/format";
import { HeartRateMonitor } from "./lib/hr";
import { notificationsSupported, showReminder } from "./lib/notify";
import { trainingDue } from "./lib/stats";
import { History } from "./components/History";
import { Records } from "./components/Records";
import { Settings } from "./components/Settings";
import { Today } from "./components/Today";

type Tab = "today" | "history" | "records" | "settings";

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("today");

  // Settings (loaded from IndexedDB, persisted on change).
  const [restDefaultSec, setRest] = useState(120);
  const [weightStep, setStep] = useState(2.5);
  const [daysPerWeek, setDpw] = useState(4);
  const [bodyweightKg, setBw] = useState(0); // 0 = not set

  // Heart rate.
  const [bpm, setBpm] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const samples = useRef<number[]>([]);
  const monitor = useRef<HeartRateMonitor | null>(null);
  if (!monitor.current) monitor.current = new HeartRateMonitor((c) => setConnected(c));

  const templates = useLiveQuery(() => db.templates.orderBy("order").toArray(), []);

  // Fire a local reminder if reminders are on and we're behind the weekly goal
  // (and haven't trained today or already nudged today).
  const maybeRemind = async (dpw: number) => {
    const enabled = await getSetting("remindersEnabled", false);
    if (!enabled || !notificationsSupported() || Notification.permission !== "granted") return;
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
      await ensureBootstrapped();
      setRest(await getSetting("restDefaultSec", 120));
      setStep(await getSetting("weightStep", 2.5));
      const dpw = await getSetting("daysPerWeek", 4);
      setDpw(dpw);
      setBw(await getSetting("bodyweightKg", 0));
      setReady(true);
      await maybeRemind(dpw);
    })();
    const onVis = () => {
      if (document.visibilityState === "visible") getSetting("daysPerWeek", 4).then(maybeRemind);
    };
    document.addEventListener("visibilitychange", onVis);
    const off = monitor.current!.onData((v) => {
      setBpm(v);
      samples.current.push(v);
    });
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVis);
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
  const hr = { bpm, connected, connect, disconnect, supported: "bluetooth" in navigator };

  const getHrStats = () => {
    const s = samples.current;
    if (s.length === 0) return {};
    return { avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length), max: Math.max(...s) };
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
    setSetting("bodyweightKg", v);
  };

  const onExport = async () => {
    const data = {
      workouts: await db.workouts.toArray(),
      templates: await db.templates.toArray(),
      settings: await db.settings.toArray(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gym-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onReset = async () => {
    if (!confirm("Erase all local data and re-import your sheet history?")) return;
    await db.delete();
    location.reload();
  };

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
            hr={hr}
            onWorkoutStart={() => (samples.current = [])}
            getHrStats={getHrStats}
            onFinished={() => setTab("history")}
          />
        )}
        {tab === "history" && <History />}
        {tab === "records" && <Records bodyweightKg={bodyweightKg} />}
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
            hr={hr}
            onExport={onExport}
            onReset={onReset}
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
