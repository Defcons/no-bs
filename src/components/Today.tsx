// The main gym screen: start a day, log sets, run the workout + rest timers,
// see live HR, and finish. This is the primary "as-easy-as-possible" surface.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { distinctExerciseNames, getSetting, lastWorkoutForDay, type StoredWorkout } from "../db";
import { resolveExercise } from "../lib/exercises";
import { daysAgo, daysAgoLabel, hhmmss, mmss, niceDate } from "../lib/format";
import { cancelBreakNotification, scheduleBreakNotification, showAutoEndNotification, showReminder } from "../lib/notify";
import { startGeofence, stopGeofence } from "../lib/geofence";
import { exitPip, isInPip, onPipChange, setPipAutoEnter } from "../lib/pip";
import { onMediaButton, onVolumeKey, setMediaButtonCapture, setVolumeCapture } from "../lib/hwButtons";
import { startTracking, stopTracking } from "../lib/tracker";
import { stepForExercise } from "../lib/steps";
import { playBreakStart } from "../lib/sounds";
import { uid } from "../lib/uid";
import { Capacitor } from "@capacitor/core";
import { syncWorkout } from "../lib/sheetSync";
import { cadenceStatus, trainingDue } from "../lib/stats";
import { useActiveWorkout } from "../lib/useActiveWorkout";
import type { DayTemplate, ExercisePerf } from "../types";
import { ExerciseCard } from "./ExerciseCard";
import { MoodSlider } from "./MoodSlider";
import { PipView } from "./PipView";
import { RestTimer } from "./RestTimer";
import { TemplateEditor } from "./TemplateEditor";
import { FlameIcon } from "./icons";
import type { WeightUnit } from "../lib/units";

type Props = {
  templates: DayTemplate[];
  restDefaultSec: number;
  weightStep: number;
  units: WeightUnit;
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
  units,
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
    startWorkoutTimer,
    toggleStopwatch,
    resetStopwatch,
    moveExercise,
  } = useActiveWorkout();
  const [hrPrompt, setHrPrompt] = useState(false);
  const [hrPromptLeft, setHrPromptLeft] = useState(0);
  const [sheet, setSheet] = useState<null | "stopwatch" | "mood">(null); // header tool sheets
  const [finishAsk, setFinishAsk] = useState(false);
  const [pipMode, setPipMode] = useState(false);
  const [editTpl, setEditTpl] = useState<DayTemplate | null>(null); // workout being created/edited
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
  const [nameHistory, setNameHistory] = useState<string[]>([]);

  // Distinct past exercise names for the custom-session name autocomplete.
  useEffect(() => {
    if (draft?.custom) distinctExerciseNames().then(setNameHistory);
  }, [draft?.custom]);

  // Load last session of this day for per-set ghost hints.
  useEffect(() => {
    if (draft) lastWorkoutForDay(draft.dayName).then(setPrev);
    else setPrev(undefined);
  }, [draft?.dayName]);

  // Optional: tapping a set's ✓ badge auto-starts the break timer (default off).
  const [autoBreakOnDone, setAutoBreakOnDone] = useState(false);
  useEffect(() => {
    getSetting("autoBreakOnDone", false).then(setAutoBreakOnDone);
  }, [draft == null]);

  // Optional hands-free break starts (both default off, armed ONLY while a
  // workout is active). Native only; older APKs without the plugin silently no-op.
  // - volumeUpBreak: volume-up key (phone or headphone volume buttons)
  // - mediaBtnBreak: headphone play/pause button (takes it over from music!)
  const [volUpBreak, setVolUpBreak] = useState(false);
  const [mediaBtnBreak, setMediaBtnBreak] = useState(false);
  // The button action: start a break, or skip/dismiss the one that's running.
  // Reassigned every render (below) so it sees the live draft.
  const hwBreakRef = useRef<() => void>(() => {});
  useEffect(() => {
    getSetting("volumeUpBreak", false).then(setVolUpBreak);
    getSetting("mediaBtnBreak", false).then(setMediaBtnBreak);
  }, [draft == null]);
  useEffect(() => {
    const armed = !!draft && volUpBreak;
    setVolumeCapture(armed);
    if (!armed) return;
    const off = onVolumeKey(() => hwBreakRef.current());
    return () => {
      off();
      setVolumeCapture(false);
    };
  }, [draft == null, volUpBreak]);
  useEffect(() => {
    const armed = !!draft && mediaBtnBreak;
    setMediaButtonCapture(armed);
    if (!armed) return;
    const off = onMediaButton(() => hwBreakRef.current());
    return () => {
      off();
      setMediaButtonCapture(false);
    };
  }, [draft == null, mediaBtnBreak]);

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
  // `auto` = ended by a watchdog (left the gym / HR strap off), not a manual tap.
  // An auto-end logs duration up to the last logged set (draft.lastActivityAt),
  // not "now", and closes any lingering PiP window.
  const finishNow = async (auto = false, reason: "left" | "hr" = "hr") => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      cancelBreakNotification(); // no "Rest over!" minutes after the workout ended
      const track = draft?.trackGps ? await stopTracking() : undefined;
      const endedAt = auto ? draft?.lastActivityAt : undefined;
      // Capture whether mood still needs logging BEFORE finish() clears the draft.
      const moodIncomplete = draft ? draft.moodBefore == null || draft.moodAfter == null : false;
      const row = await finish(getHrStats(), track && track.length >= 2 ? { track } : undefined, { endedAt });
      if (row && !row.edited) {
        // Edits update the local record only — re-syncing would append a new column.
        const res = await syncWorkout(row);
        if (res && !res.ok && !auto) {
          alert(`Saved locally, but Google Sheet sync failed:\n${res.error}\n\nRetry from Settings → Sync now.`);
        }
        // Auto-ended in the background → tell the user + offer to log the mood they
        // couldn't rate (tapping the notification opens MoodLogModal for this row).
        if (auto) showAutoEndNotification(reason, row.id, moodIncomplete);
      }
      setHrPrompt(false);
      setFinishAsk(false);
      if (auto) exitPip(); // a stale PiP window would otherwise linger on the picker
      onFinished();
    } catch (e) {
      // Surface it — a silent failure here read as "the button does nothing".
      if (!auto) alert(`Couldn't save the workout: ${(e as Error).message}\n\nYour session is still active — try again.`);
    } finally {
      // Always release the guard: an error above otherwise dead-ends every
      // future Finish tap until the tab remounts.
      finishingRef.current = false;
    }
  };
  // The Finish button: nudge to rate mood first if it wasn't set.
  const finishWorkout = () => {
    if (draft && (draft.moodBefore == null || draft.moodAfter == null)) setFinishAsk(true);
    else finishNow(false);
  };
  // Watchdogs call this (auto-end); manual paths call finishNow(false) directly.
  const finishRef = useRef<(reason?: "left" | "hr") => void>(() => {});
  finishRef.current = (reason = "hr") => finishNow(true, reason);

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
  // If HR was in use but has been unavailable for 10 min, ASK (same prompt flow as
  // low-HR) rather than force-saving — a dead strap battery mid-set must not end
  // the session with no warning. Unanswered for 5 min → auto-end.
  useEffect(() => {
    if (!draft || draft.custom || hrLowThreshold <= 0) return;
    const id = window.setInterval(() => {
      if (!hrPrompt && hrEver.current && !hr.connected && Date.now() - lastHrAt.current >= 10 * 60 * 1000) {
        promptDeadline.current = Date.now() + 5 * 60 * 1000;
        setHrPrompt(true);
        showReminder(
          "Still working out?",
          "Lost your heart-rate signal 10 min ago — tap to keep going, or the session auto-ends in 5 min.",
        );
      }
    }, 20000);
    return () => window.clearInterval(id);
  }, [draft, draft?.custom, hr.connected, hrLowThreshold, hrPrompt]);

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
      // The auto-save notification (fired from finishNow) explains the reason and
      // offers mood logging — no separate "saved" reminder needed here.
      finishRef.current("left");
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
            <span>{overallCad === "red" ? "You're behind — train today!" : "Time to train today to hit your goal"}</span>
            <FlameIcon />
          </div>
        )}
        <p className="muted">Pick today's day:</p>
        <div className="day-buttons">
          {templates.map((t) => {
            const last = lastByDay[t.name];
            const cad = last ? cadenceStatus(daysAgo(last.date), daysPerWeek, templates.length) : "red";
            return (
              <div key={t.id ?? t.name} className="day-cell">
                <button
                  className="day-btn"
                  onClick={() => {
                    start(t);
                    onWorkoutStart();
                  }}
                >
                  <div className="day-body">
                    <span className="day-name">{t.name}</span>
                    <span className="day-meta">
                      <span>{t.exercises.length} exercises</span>
                      <span className={`day-cad cad-${cad}`}>{last ? daysAgoLabel(last.date) : "Never done"}</span>
                    </span>
                  </div>
                </button>
                <button className="day-edit" aria-label={`edit ${t.name}`} onClick={() => setEditTpl(t)}>
                  ✎
                </button>
              </div>
            );
          })}
          <button
            className="day-btn alt-btn"
            onClick={() => {
              startCustom();
              onWorkoutStart();
            }}
          >
            <div className="day-body">
              <span className="day-name">＋ Alternative</span>
              <span className="day-sub">Running, crossfit, or your own exercises</span>
            </div>
          </button>
          <button
            className="day-btn new-btn"
            onClick={() => setEditTpl({ name: "", order: 0, exercises: [] })}
          >
            <div className="day-body">
              <span className="day-name">＋ New workout</span>
              <span className="day-sub">Build your own reusable day</span>
            </div>
          </button>
        </div>
        {editTpl && <TemplateEditor template={editTpl} units={units} onClose={() => setEditTpl(null)} />}
      </div>
    );
  }

  // ---- Active workout ------------------------------------------------------
  const setExercise = (i: number, ex: ExercisePerf) => {
    startWorkoutTimer(); // first edit starts the workout timer
    // Editing a set is "activity" — stamp it so an auto-end logs up to here.
    update((d) => ({ ...d, lastActivityAt: Date.now(), exercises: d.exercises.map((e, idx) => (idx === i ? ex : e)) }));
  };

  const startRest = () => {
    const at = Date.now() + restDefaultSec * 1000;
    scheduleBreakNotification(at); // native: fires even if app is backgrounded
    playBreakStart(); // audible confirmation (matters for volume/headset-button starts)
    update((d) => ({ ...d, restEndsAt: at, lastActivityAt: Date.now() }));
  };
  const setRest = (endsAt: number | null) => {
    if (endsAt == null) cancelBreakNotification();
    else scheduleBreakNotification(endsAt);
    update((d) => ({ ...d, restEndsAt: endsAt ?? undefined }));
  };
  // Hardware button (volume / headset): if a break is set, skip/dismiss it;
  // otherwise start one. Reassigned each render so it sees the current draft.
  hwBreakRef.current = () => {
    if (draft?.restEndsAt != null) setRest(null);
    else startRest();
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
            {/* Wall-clock since the workout started — deliberately not pausable. */}
            <span className="wb-timer" title="Total workout time">
              {hhmmss(elapsed)}
            </span>
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
          <button className="tool-btn" onClick={() => setSheet("stopwatch")} aria-label="Stopwatch" title="Stopwatch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2.5h5" />
              <path d="M12 2.5V5" />
              <circle cx="12" cy="13.5" r="7.5" />
              <path d="M12 13.5V9.5" />
            </svg>
          </button>
          <button
            className={`tool-btn ${draft.moodBefore != null && draft.moodAfter != null ? "set" : ""}`}
            onClick={() => setSheet("mood")}
            aria-label="Rate how you feel"
            title="How you feel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 14.5s1.3 1.7 3.5 1.7 3.5-1.7 3.5-1.7" />
              <path d="M9 9.5h.01M15 9.5h.01" />
            </svg>
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
            step={stepForExercise(ex.name, weightStep, ex.step)}
            prev={prev?.exercises.find(
              (p) => resolveExercise(p.name, p.exerciseId).id === resolveExercise(ex.name, ex.exerciseId).id,
            )}
            onChange={(e) => setExercise(i, e)}
            onSetDone={autoBreakOnDone ? startRest : undefined}
            editableName={draft.custom}
            units={units}
            nameHistory={nameHistory}
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
        <label className="field-label">Day note</label>
        <textarea
          className="day-note"
          value={draft.note ?? ""}
          placeholder="How did the session feel?"
          onChange={(e) => update((d) => ({ ...d, note: e.target.value || undefined }))}
        />
      </div>

      <div className="finish-bar">
        <button
          className="ghost"
          onClick={() => {
            if (confirm("Delete this workout? Nothing will be saved and you'll go back to day selection.")) cancel();
          }}
        >
          Delete
        </button>
        <button className="primary" onClick={finishWorkout}>
          Finish workout
        </button>
      </div>

      {sheet === "stopwatch" && (
        <div className="hr-modal-backdrop" onClick={() => setSheet(null)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Stopwatch</h3>
            <p className="muted tiny">Keeps running in the background — for timed holds, planks, or cardio.</p>
            <div className="sw-modal-time num">{mmss(swElapsed)}</div>
            <div className="row">
              <button className="primary" onClick={toggleStopwatch}>
                {draft.swRunning ? "⏸ Pause" : "▶ Start"}
              </button>
              <button className="ghost" onClick={resetStopwatch}>
                ↺ Reset
              </button>
            </div>
            <button className="sheet-done" onClick={() => setSheet(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {sheet === "mood" && (
        <div className="hr-modal-backdrop" onClick={() => setSheet(null)}>
          <div className="hr-modal" onClick={(e) => e.stopPropagation()}>
            <h3>How's the session?</h3>
            <p className="muted tiny">Rate how you feel before you start and after you finish.</p>
            <MoodSlider label="Feeling before" value={draft.moodBefore} onChange={(v) => update((d) => ({ ...d, moodBefore: v }))} />
            <MoodSlider label="Feeling after" value={draft.moodAfter} onChange={(v) => update((d) => ({ ...d, moodAfter: v }))} />
            <button className="sheet-done" onClick={() => setSheet(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {hrPrompt && (
        <div className="hr-modal-backdrop">
          <div className="hr-modal">
            <h3>Still working out?</h3>
            <p className="muted">
              {hr.connected ? "Your heart rate's been low." : "Lost your heart-rate signal."} Auto-ending in{" "}
              <b>{mmss(hrPromptLeft)}</b>.
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  lowSince.current = null;
                  lastHrAt.current = Date.now(); // restart the dropout window too
                  setHrPrompt(false);
                }}
              >
                Yes, keep going
              </button>
              <button className="ghost" onClick={() => finishNow(false)}>
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
              <button className="primary" onClick={() => finishNow(false)}>
                Finish workout
              </button>
              <button className="ghost" onClick={() => finishNow(false)}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PiP: portal the minimal timer view to <body> so it covers whatever tab is
          showing (Today stays mounted but hidden when you're on another tab — the
          portal escapes that so PiP works from any tab). */}
      {pipMode &&
        createPortal(
          <PipView
            restEndsAt={draft.restEndsAt ?? null}
            timer={{ wAccumMs: draft.wAccumMs, wRunning: draft.wRunning, wSegStart: draft.wSegStart }}
            bpm={hr.bpm}
            avg={hr.avg}
          />,
          document.body,
        )}
    </div>
  );
}
