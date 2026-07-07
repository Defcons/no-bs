// The main gym screen: start a day, log sets, run the workout + rest timers,
// see live HR, and finish. This is the primary "as-easy-as-possible" surface.
import { useEffect, useRef, useState } from "react";
import { lastWorkoutForDay, type StoredWorkout } from "../db";
import { daysAgo, daysAgoLabel, hhmmss, mmss, niceDate } from "../lib/format";
import { cancelBreakNotification, scheduleBreakNotification, showReminder } from "../lib/notify";
import { startGeofence, stopGeofence } from "../lib/geofence";
import { isInPip, onPipChange, setPipAutoEnter } from "../lib/pip";
import { startTracking, stopTracking } from "../lib/tracker";
import { stepForExercise } from "../lib/steps";
import { uid } from "../lib/uid";
import { Capacitor } from "@capacitor/core";
import { syncWorkout } from "../lib/sheetSync";
import { cadenceStatus, trainingDue } from "../lib/stats";
import { useActiveWorkout } from "../lib/useActiveWorkout";
import type { DayTemplate, ExercisePerf } from "../types";
import { ExerciseCard } from "./ExerciseCard";
import { PipView } from "./PipView";
import { RestTimer } from "./RestTimer";

type Props = {
  templates: DayTemplate[];
  restDefaultSec: number;
  weightStep: number;
  daysPerWeek: number;
  hrLowThreshold: number;
  hr: { bpm: number | null; avg: number | null; connected: boolean; connect: () => void; supported: boolean };
  onWorkoutStart: () => void;
  getHrStats: () => { avg?: number; max?: number };
  onFinished: () => void;
  editWorkout?: StoredWorkout | null; // a past workout to load into the editor
  onEditConsumed?: () => void;
  floatMode: "pip" | "off"; // floating timer (PiP) on/off
};

export function Today({
  templates,
  restDefaultSec,
  weightStep,
  daysPerWeek,
  hrLowThreshold,
  hr,
  onWorkoutStart,
  getHrStats,
  onFinished,
  editWorkout,
  onEditConsumed,
  floatMode,
}: Props) {
  const {
    draft,
    loaded,
    elapsed,
    swElapsed,
    start,
    startCustom,
    beginEdit,
    cancel,
    finish,
    update,
    toggleWorkoutTimer,
    resetWorkoutTimer,
    startWorkoutTimer,
    toggleStopwatch,
    resetStopwatch,
    moveExercise,
  } = useActiveWorkout();
  const [hrPrompt, setHrPrompt] = useState(false);
  const [hrPromptLeft, setHrPromptLeft] = useState(0);
  const [showTools, setShowTools] = useState(false);
  const [finishAsk, setFinishAsk] = useState(false);
  const [pipMode, setPipMode] = useState(false);
  const native = Capacitor.isNativePlatform();
  const bpmRef = useRef<number | null>(null);
  bpmRef.current = hr.bpm; // always-fresh HR for the GPS track stamps
  const finishingRef = useRef(false); // in-flight guard so we never double-save
  const lowSince = useRef<number | null>(null);
  const promptDeadline = useRef<number>(0);
  const hrEver = useRef(false); // did HR ever connect this session?
  const lastHrAt = useRef(0); // last time an HR reading arrived
  const [prev, setPrev] = useState<StoredWorkout | undefined>();
  const [lastByDay, setLastByDay] = useState<Record<string, StoredWorkout | undefined>>({});

  // Load last session of this day for per-set ghost hints.
  useEffect(() => {
    if (draft) lastWorkoutForDay(draft.dayName).then(setPrev);
    else setPrev(undefined);
  }, [draft?.dayName]);

  // On the picker, load the last session of each day type (for "days ago").
  useEffect(() => {
    if (draft) return;
    let cancelled = false;
    Promise.all(templates.map((t) => lastWorkoutForDay(t.name).then((w) => [t.name, w] as const))).then((entries) => {
      if (!cancelled) setLastByDay(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [draft, templates]);

  // Load a past workout into the editor when asked (from History → Edit).
  useEffect(() => {
    if (!editWorkout) return;
    if (draft && draft.editId !== editWorkout.id) {
      if (!confirm("Discard the workout in progress and edit this one instead?")) {
        onEditConsumed?.();
        return;
      }
    }
    beginEdit(editWorkout);
    onEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editWorkout]);

  // Actually save + sync + return to history. Guarded so a watchdog (HR/geofence)
  // and a manual tap can't both save the same session.
  const finishNow = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const track = draft?.trackGps ? await stopTracking() : undefined;
    const row = await finish(getHrStats(), track && track.length >= 2 ? { track } : undefined);
    if (row && !row.edited) {
      // Edits update the local record only — re-syncing would append a new column.
      const res = await syncWorkout(row);
      if (res && !res.ok) {
        alert(`Saved locally, but Google Sheet sync failed:\n${res.error}\n\nRetry from Settings → Sync now.`);
      }
    }
    setHrPrompt(false);
    setFinishAsk(false);
    onFinished();
  };
  // The Finish button: nudge to rate mood first if it wasn't set.
  const finishWorkout = () => {
    if (draft && (draft.moodBefore == null || draft.moodAfter == null)) setFinishAsk(true);
    else finishNow();
  };
  const finishRef = useRef(finishNow);
  finishRef.current = finishNow;

  // Track HR availability for the drop-out auto-finish.
  useEffect(() => {
    if (hr.bpm != null) {
      lastHrAt.current = Date.now();
      hrEver.current = true;
    }
  }, [hr.bpm]);
  // Reset HR tracking when a new session starts.
  useEffect(() => {
    hrEver.current = false;
    lastHrAt.current = Date.now();
  }, [draft?.startedAt]);
  // If HR was in use but has been unavailable for 10 min, auto-finish (skip for
  // Alternative sessions).
  useEffect(() => {
    if (!draft || draft.custom || hrLowThreshold <= 0) return;
    const id = window.setInterval(() => {
      if (hrEver.current && !hr.connected && Date.now() - lastHrAt.current >= 10 * 60 * 1000) {
        finishRef.current();
      }
    }, 20000);
    return () => window.clearInterval(id);
  }, [draft, draft?.custom, hr.connected, hrLowThreshold]);

  // Float as Picture-in-Picture whenever you leave the app during an active
  // workout; the minimal PiP view shows the break countdown (if resting) or the
  // running workout time + HR.
  useEffect(() => onPipChange(setPipMode), []);
  // If the app is foregrounded and NOT actually in PiP, clear any stale PiP overlay
  // (e.g. the OS closed PiP on screen-lock without firing the mode callback).
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === "visible" && !(await isInPip())) setPipMode(false);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const workoutActive = !!draft;
  // PiP floating timer (thin 7:3 bar — smallest footprint Android's aspect-ratio API
  // allows). Only when the user picked "pip" mode.
  useEffect(() => {
    setPipAutoEnter(workoutActive && floatMode === "pip", 3, 2);
    return () => {
      setPipAutoEnter(false);
    };
  }, [workoutActive, floatMode]);

  // GPS route recording: while an Alternative session has "Track GPS route" on,
  // record the path (stamped with live HR). The track is attached on finish.
  const trackGps = !!draft?.trackGps;
  useEffect(() => {
    if (!trackGps) return;
    startTracking(() => bpmRef.current);
    return () => {
      stopTracking();
    };
  }, [trackGps]);

  // Leave-gym auto-end: while a (non-Alternative) workout runs, watch location in
  // the background; when you've clearly left the gym, save + finish the session.
  useEffect(() => {
    if (!draft || draft.custom) return;
    let active = true;
    startGeofence(() => {
      if (!active) return;
      showReminder("Workout saved 💾", "You left the workout area, so I finished and saved your session.");
      finishRef.current();
    });
    return () => {
      active = false;
      stopGeofence();
    };
  }, [draft?.startedAt, draft?.custom]);

  // Low-HR watchdog: after HR sits below the threshold for 10 min, ask if you're
  // still working out; if unanswered for 5 more min, auto-end. Driven by HR updates.
  useEffect(() => {
    if (!draft || !hr.connected || hrLowThreshold <= 0 || hr.bpm == null) {
      if (!draft) lowSince.current = null;
      return;
    }
    if (hr.bpm < hrLowThreshold) {
      if (lowSince.current == null) lowSince.current = Date.now();
      if (!hrPrompt && Date.now() - lowSince.current >= 10 * 60 * 1000) {
        promptDeadline.current = Date.now() + 5 * 60 * 1000;
        setHrPrompt(true);
        showReminder("Still working out?", "Your heart rate's been low for 10 min — tap to keep going, or it auto-ends in 5 min.");
      }
    } else {
      lowSince.current = null;
      if (hrPrompt) setHrPrompt(false);
    }
  }, [hr.bpm, hr.connected, hrLowThreshold, draft, hrPrompt]);

  // Prompt countdown → auto-end when it hits zero.
  useEffect(() => {
    if (!hrPrompt) return;
    const tick = () => {
      const left = Math.ceil((promptDeadline.current - Date.now()) / 1000);
      setHrPromptLeft(Math.max(0, left));
      if (left <= 0) finishRef.current();
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [hrPrompt]);

  if (!loaded) return <div className="pad">Loading…</div>;

  // ---- No active workout: choose a day -----------------------------------
  if (!draft) {
    const lasts = Object.values(lastByDay).filter(Boolean) as StoredWorkout[];
    const overall = lasts.sort((a, b) => b.date.localeCompare(a.date))[0];
    const overallDays = overall ? daysAgo(overall.date) : Infinity;
    const overallCad = overall ? cadenceStatus(overallDays, daysPerWeek) : "red";
    const due = overall ? trainingDue(overallDays, daysPerWeek) && overallDays > 0 : true;
    return (
      <div className="pad day-picker">
        <h2>Start a workout</h2>
        {overall && (
          <div className="last-banner">
            Last workout: <b>{overall.dayName}</b> · {niceDate(overall.date)}{" "}
            <span className={`cad cad-${overallCad}`}>({daysAgoLabel(overall.date)})</span>
          </div>
        )}
        {due && (
          <div className={`due-prompt cad-bg-${overallCad}`}>
            {overallCad === "red" ? "You're behind — train today! 💪" : "Time to train today to hit your goal 💪"}
          </div>
        )}
        <p className="muted">Pick today's day:</p>
        <div className="day-buttons">
          {templates.map((t) => {
            const last = lastByDay[t.name];
            const cad = last ? cadenceStatus(daysAgo(last.date), daysPerWeek, templates.length) : "red";
            return (
              <button
                key={t.id ?? t.name}
                className="day-btn"
                onClick={() => {
                  start(t);
                  onWorkoutStart();
                }}
              >
                <span className="day-name">{t.name}</span>
                <span className="day-sub">{t.exercises.length} exercises</span>
                <span className={`day-last cad-${cad}`}>
                  {last ? `Last: ${niceDate(last.date)} (${daysAgoLabel(last.date)})` : "Never done"}
                </span>
              </button>
            );
          })}
          <button
            className="day-btn alt-btn"
            onClick={() => {
              startCustom();
              onWorkoutStart();
            }}
          >
            <span className="day-name">＋ Alternative</span>
            <span className="day-sub">Running, crossfit, or your own exercises</span>
          </button>
        </div>
      </div>
    );
  }

  // ---- Active workout ------------------------------------------------------
  const setExercise = (i: number, ex: ExercisePerf) => {
    startWorkoutTimer(); // first edit starts the workout timer
    update((d) => ({ ...d, exercises: d.exercises.map((e, idx) => (idx === i ? ex : e)) }));
  };

  const startRest = () => {
    const at = Date.now() + restDefaultSec * 1000;
    scheduleBreakNotification(at); // native: fires even if app is backgrounded
    update((d) => ({ ...d, restEndsAt: at }));
  };
  const setRest = (endsAt: number | null) => {
    if (endsAt == null) cancelBreakNotification();
    else scheduleBreakNotification(endsAt);
    update((d) => ({ ...d, restEndsAt: endsAt ?? undefined }));
  };
  const addExercise = () =>
    update((d) => ({
      ...d,
      exercises: [
        ...d.exercises,
        { id: uid(), name: "", scheme: { sets: null, reps: null }, sets: [{ id: uid(), weight: null, reps: null }] },
      ],
    }));
  const removeExercise = (i: number) => update((d) => ({ ...d, exercises: d.exercises.filter((_, idx) => idx !== i) }));

  return (
    <div className="today">
      <header className="workout-bar">
        <div className="wb-left">
          {draft.custom ? (
            <input
              className="wb-day-input"
              type="text"
              value={draft.dayName}
              placeholder="Session name"
              onChange={(e) => update((d) => ({ ...d, dayName: e.target.value }))}
            />
          ) : (
            <div className="wb-day">{draft.dayName}</div>
          )}
          <div className="wb-time-row">
            <span className="wb-timer" title="Total workout time">
              {hhmmss(elapsed)}
            </span>
            <button className="sw-btn" aria-label={draft.wRunning ? "pause workout timer" : "start workout timer"} onClick={toggleWorkoutTimer}>
              {draft.wRunning ? "⏸" : "▶"}
            </button>
            <button className="sw-btn" aria-label="reset workout timer" onClick={resetWorkoutTimer}>
              ↺
            </button>
          </div>
        </div>
        <div className="wb-right">
          <button
            className={`hr-badge ${hr.connected ? "on" : ""}`}
            onClick={hr.connect}
            title={hr.supported ? "Connect heart rate" : "Web Bluetooth not supported here"}
          >
            <span className="hr-heart">♥</span>
            <span className="hr-col">
              <span className="hr-val">{hr.bpm ?? (hr.connected ? "…" : "HR")}</span>
              {hr.avg != null && <span className="hr-avg">avg {hr.avg}</span>}
            </span>
          </button>
          <button className="break-btn" onClick={startRest} aria-label="Start rest timer" title="Rest timer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3.4h12M6 20.6h12" />
              <path d="M7.6 4c0 4.7 4.4 6 4.4 8s-4.4 3.3-4.4 8" />
              <path d="M16.4 4c0 4.7-4.4 6-4.4 8s4.4 3.3 4.4 8" />
              <path d="M9.7 6.6h4.6" opacity="0.5" />
            </svg>
          </button>
        </div>
      </header>

      <RestTimer endsAt={draft.restEndsAt ?? null} onChange={setRest} />

      <button className="tools-toggle" onClick={() => setShowTools((v) => !v)}>
        {showTools ? "▴ Hide stopwatch & sliders" : "▾ Stopwatch & Sliders"}
      </button>

      {showTools && (
        <>
          <div className="sw-bar">
            <span className="sw-label">⏱ Stopwatch</span>
            <span className="sw-time">{mmss(swElapsed)}</span>
            <button className="mini" onClick={toggleStopwatch}>
              {draft.swRunning ? "⏸ Pause" : "▶ Start"}
            </button>
            <button className="mini" onClick={resetStopwatch}>
              ↺ Reset
            </button>
          </div>
          <div className="pad">
            <MoodSlider
              label="Feeling before"
              value={draft.moodBefore}
              onChange={(v) => update((d) => ({ ...d, moodBefore: v }))}
            />
          </div>
        </>
      )}

      {draft.custom && native && (
        <div className="pad gps-toggle-row">
          <button
            className={`mini ${draft.trackGps ? "active" : ""}`}
            onClick={() => update((d) => ({ ...d, trackGps: !d.trackGps }))}
          >
            {draft.trackGps ? "◉ Tracking GPS route" : "○ Track GPS route"}
          </button>
          {draft.trackGps && <span className="muted tiny">Recording your route — map shows in History.</span>}
        </div>
      )}

      <div className="exercise-list">
        {draft.exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.id ?? i}
            exercise={ex}
            step={stepForExercise(ex.name, weightStep)}
            prev={prev?.exercises.find((p) => p.name === ex.name)}
            onChange={(e) => setExercise(i, e)}
            editableName={draft.custom}
            onRemove={draft.custom ? () => removeExercise(i) : undefined}
            onMoveUp={i > 0 ? () => moveExercise(i, -1) : undefined}
            onMoveDown={i < draft.exercises.length - 1 ? () => moveExercise(i, 1) : undefined}
          />
        ))}
        {draft.custom && (
          <button className="add-exercise" onClick={addExercise}>
            ＋ Add exercise
          </button>
        )}
        {draft.custom && draft.exercises.length === 0 && (
          <p className="muted tiny pad">
            Add your own exercises, or just use the timer + heart rate and jot it in the note below (e.g. “5 km run”).
          </p>
        )}
      </div>

      <div className="pad">
        <MoodSlider
          label="Feeling after"
          value={draft.moodAfter}
          onChange={(v) => update((d) => ({ ...d, moodAfter: v }))}
        />
        <label className="field-label" style={{ marginTop: 12 }}>
          Day note
        </label>
        <textarea
          className="day-note"
          value={draft.note ?? ""}
          placeholder="how did the session feel?"
          onChange={(e) => update((d) => ({ ...d, note: e.target.value || undefined }))}
        />
      </div>

      <div className="finish-bar">
        <button
          className="ghost"
          onClick={() => {
            if (confirm("Reset this workout? Nothing will be saved and you'll go back to day selection.")) cancel();
          }}
        >
          Reset
        </button>
        <button className="primary" onClick={finishWorkout}>
          Finish workout
        </button>
      </div>

      {hrPrompt && (
        <div className="hr-modal-backdrop">
          <div className="hr-modal">
            <h3>Still working out?</h3>
            <p className="muted">
              Your heart rate's been low. Auto-ending in <b>{mmss(hrPromptLeft)}</b>.
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  lowSince.current = null;
                  setHrPrompt(false);
                }}
              >
                Yes, keep going
              </button>
              <button className="ghost" onClick={finishNow}>
                End now
              </button>
            </div>
          </div>
        </div>
      )}

      {finishAsk && (
        <div className="hr-modal-backdrop">
          <div className="hr-modal">
            <h3>Rate your session</h3>
            <p className="muted tiny">You didn't set your feeling — quick before you finish?</p>
            <MoodSlider
              label="Feeling before"
              value={draft.moodBefore}
              onChange={(v) => update((d) => ({ ...d, moodBefore: v }))}
            />
            <MoodSlider
              label="Feeling after"
              value={draft.moodAfter}
              onChange={(v) => update((d) => ({ ...d, moodAfter: v }))}
            />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="primary" onClick={finishNow}>
                Finish workout
              </button>
              <button className="ghost" onClick={finishNow}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PiP: overlay the minimal timer view on top (keeps the workout UI mounted
          underneath, so note toggles etc. survive returning from the background). */}
      {pipMode && (
        <PipView restEndsAt={draft.restEndsAt ?? null} startEpoch={draft.startedAt} bpm={hr.bpm} avg={hr.avg} />
      )}
    </div>
  );
}

function MoodSlider({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div className="mood">
      <div className="mood-head">
        <span className="field-label">{label}</span>
        <span className="mood-val">{value ? `${value}/10` : "—"}</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value ?? 5}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
    </div>
  );
}
