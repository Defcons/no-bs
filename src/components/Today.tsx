// The main gym screen: start a day, log sets, run the workout + rest timers,
// see live HR, and finish. This is the primary "as-easy-as-possible" surface.
import { useEffect, useState } from "react";
import { lastWorkoutForDay, type StoredWorkout } from "../db";
import { daysAgoLabel, hhmmss, niceDate } from "../lib/format";
import { useActiveWorkout } from "../lib/useActiveWorkout";
import type { DayTemplate, ExercisePerf } from "../types";
import { ExerciseCard } from "./ExerciseCard";
import { RestTimer } from "./RestTimer";

type Props = {
  templates: DayTemplate[];
  restDefaultSec: number;
  weightStep: number;
  hr: { bpm: number | null; connected: boolean; connect: () => void; supported: boolean };
  onWorkoutStart: () => void;
  getHrStats: () => { avg?: number; max?: number };
  onFinished: () => void;
};

export function Today({ templates, restDefaultSec, weightStep, hr, onWorkoutStart, getHrStats, onFinished }: Props) {
  const { draft, loaded, elapsed, start, cancel, finish, update } = useActiveWorkout();
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

  if (!loaded) return <div className="pad">Loading…</div>;

  // ---- No active workout: choose a day -----------------------------------
  if (!draft) {
    const lasts = Object.values(lastByDay).filter(Boolean) as StoredWorkout[];
    const overall = lasts.sort((a, b) => b.date.localeCompare(a.date))[0];
    return (
      <div className="pad day-picker">
        <h2>Start a workout</h2>
        {overall && (
          <div className="last-banner">
            Last workout: <b>{overall.dayName}</b> · {niceDate(overall.date)}{" "}
            <span className="muted">({daysAgoLabel(overall.date)})</span>
          </div>
        )}
        <p className="muted">Pick today's day:</p>
        <div className="day-buttons">
          {templates.map((t) => {
            const last = lastByDay[t.name];
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
                <span className="day-last">
                  {last ? `Last: ${niceDate(last.date)} (${daysAgoLabel(last.date)})` : "Never done"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- Active workout ------------------------------------------------------
  const setExercise = (i: number, ex: ExercisePerf) =>
    update((d) => ({ ...d, exercises: d.exercises.map((e, idx) => (idx === i ? ex : e)) }));

  const startRest = () => update((d) => ({ ...d, restEndsAt: Date.now() + restDefaultSec * 1000 }));
  const setRest = (endsAt: number | null) => update((d) => ({ ...d, restEndsAt: endsAt ?? undefined }));

  const doFinish = async () => {
    await finish(getHrStats());
    onFinished();
  };

  return (
    <div className="today">
      <header className="workout-bar">
        <div className="wb-left">
          <div className="wb-day">{draft.dayName}</div>
          <div className="wb-timer">{hhmmss(elapsed)}</div>
        </div>
        <div className="wb-right">
          <button
            className={`hr-badge ${hr.connected ? "on" : ""}`}
            onClick={hr.connect}
            title={hr.supported ? "Connect heart rate" : "Web Bluetooth not supported here"}
          >
            <span className="hr-heart">♥</span>
            <span className="hr-val">{hr.bpm ?? (hr.connected ? "…" : "HR")}</span>
          </button>
          <button className="break-btn" onClick={startRest}>
            Break
          </button>
        </div>
      </header>

      <RestTimer endsAt={draft.restEndsAt ?? null} onChange={setRest} />

      <div className="exercise-list">
        {draft.exercises.map((ex, i) => (
          <ExerciseCard
            key={ex.name + i}
            exercise={ex}
            step={weightStep}
            prev={prev?.exercises.find((p) => p.name === ex.name)}
            onChange={(e) => setExercise(i, e)}
          />
        ))}
      </div>

      <div className="pad">
        <label className="field-label">Day note</label>
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
        <button className="primary" onClick={doFinish}>
          Finish workout
        </button>
      </div>
    </div>
  );
}
