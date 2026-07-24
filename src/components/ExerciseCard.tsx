// A single exercise within the active workout: header (name + scheme), its set
// rows, add/remove set, and an optional per-exercise note.
import { type TouchEvent, useEffect, useRef, useState } from "react";
import type { ExercisePerf, SetEntry } from "../types";
import { uid } from "../lib/uid";
import { SetInput } from "./SetInput";
import { ExerciseNameField } from "./ExerciseNameField";
import { resolveExercise } from "../lib/exercises";
import { restForId, setRestForId } from "../lib/exerciseRest";
import { type WeightUnit, weightStr } from "../lib/units";
import { daysAgoLabel, niceDate } from "../lib/format";

const REST_PRESETS = [30, 60, 90, 120, 150, 180];
const fmtRest = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`);

type Props = {
  exercise: ExercisePerf;
  step: number;
  prev?: ExercisePerf; // last session's performance of this exercise (for hints)
  prevDate?: string; // ISO date of that last session (for the swipe-in "last time" panel)
  onChange: (ex: ExercisePerf) => void;
  onSetDone?: () => void; // set explicitly marked done via its badge (not weight edits)
  defaultRest?: number; // Settings global rest default (shown when this exercise has no own value)
  editableName?: boolean; // custom sessions: let the user name the exercise
  units?: WeightUnit; // weight display/entry unit
  nameHistory?: string[]; // distinct past exercise names (autocomplete)
  onRemove?: () => void; // custom sessions: remove this exercise
  onMoveUp?: () => void; // reorder within this session only
  onMoveDown?: () => void;
};

export function ExerciseCard({ exercise, step, prev, prevDate, onChange, onSetDone, defaultRest = 90, editableName, units, nameHistory, onRemove, onMoveUp, onMoveDown }: Props) {
  const [showNote, setShowNote] = useState(!!exercise.note);
  const resolved = resolveExercise(exercise.name, exercise.exerciseId);
  const unit = resolved.unit;

  // Swipe RIGHT (or the ↺ header button) reveals last time's numbers, read-only.
  const [showPrev, setShowPrev] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Only a clearly-horizontal swipe (so vertical scrolling is unaffected).
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    setShowPrev(dx > 0);
  };
  // Read-only label for one previous set, matching the exercise's unit.
  const fmtPrevSet = (s: SetEntry): string => {
    if (unit === "time") return s.seconds != null ? `${s.seconds}s` : "—";
    if (unit === "distance") return s.distanceM != null ? `${Number((s.distanceM / 1000).toFixed(2))} km` : "—";
    const u = units ?? "kg";
    const reps = s.reps != null ? `${s.reps}` : "—";
    if (unit === "bodyweight") return s.weight ? `+${weightStr(s.weight, u)}${u} × ${reps}` : `BW × ${reps}`;
    return s.weight != null ? `${weightStr(s.weight, u)}${u} × ${reps}` : `× ${reps}`;
  };
  // Per-exercise rest override (global, by resolved id). Local mirror so the chip
  // updates on pick; re-reads when the resolved exercise changes (name edits).
  const [showRest, setShowRest] = useState(false);
  const [rest, setRest] = useState<number | undefined>(restForId(resolved.id));
  useEffect(() => setRest(restForId(resolved.id)), [resolved.id]);
  const pickRest = (sec: number | null) => {
    void setRestForId(resolved.id, sec);
    setRest(sec == null ? undefined : sec);
    setShowRest(false);
  };

  const patchSet = (i: number, patch: Partial<SetEntry>) => {
    const sets = exercise.sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...exercise, sets });
    // A bare {done:true} patch = the set badge was tapped (weight/rep edits also
    // set done, but always alongside their value) — that's the "set finished" signal.
    if (patch.done === true && Object.keys(patch).length === 1) onSetDone?.();
  };
  // Scheme's target reps (null for "Max"): the rep-vs-target border cue + new-set default.
  const defReps = typeof exercise.scheme.reps === "number" ? exercise.scheme.reps : null;
  const addSet = () => {
    const last = exercise.sets.at(-1);
    // Carry the previous set's weight, but reset reps to the exercise's scheme default.
    onChange({ ...exercise, sets: [...exercise.sets, { id: uid(), weight: last?.weight ?? null, reps: defReps, done: false }] });
  };
  const removeSet = () => {
    if (exercise.sets.length > 1) onChange({ ...exercise, sets: exercise.sets.slice(0, -1) });
  };

  return (
    <section className="exercise-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="exercise-head">
        {editableName ? (
          <ExerciseNameField
            className="exercise-name-input"
            value={exercise.name}
            placeholder="exercise name…"
            history={nameHistory}
            onChange={(name, ex) => onChange({ ...exercise, name, exerciseId: ex?.id })}
          />
        ) : (
          <h3>{exercise.name}</h3>
        )}
        <div className="ex-controls">
          <span className="setsl">Sets:</span>
          <button className="hbtn" aria-label="remove set" onClick={removeSet}>
            −
          </button>
          <span className="set-count" title="sets">
            {exercise.sets.length}
          </span>
          <button className="hbtn" aria-label="add set" onClick={addSet}>
            +
          </button>
          <span className="hdiv" />
          <button
            className={`hbtn ${showPrev ? "has-note" : ""}`}
            aria-label="last time's numbers"
            title="Last time (or swipe right)"
            onClick={() => setShowPrev((v) => !v)}
          >
            ↺
          </button>
          <button
            className={`rest-chip ${rest != null ? "set" : ""} ${showRest ? "open" : ""}`}
            title="Default rest for this exercise (applies everywhere it's used)"
            aria-label="set default rest for this exercise"
            onClick={() => setShowRest((v) => !v)}
          >
            ⏱ {fmtRest(rest ?? defaultRest)}
          </button>
          <button
            className={`hbtn ${exercise.note ? "has-note" : ""}`}
            aria-label="exercise note"
            onClick={() => setShowNote((v) => !v)}
          >
            ✎
          </button>
          {onMoveUp && (
            <button className="hbtn" aria-label="move up" onClick={onMoveUp}>
              ↑
            </button>
          )}
          {onMoveDown && (
            <button className="hbtn" aria-label="move down" onClick={onMoveDown}>
              ↓
            </button>
          )}
          {onRemove && (
            <button className="hbtn" aria-label="remove exercise" onClick={onRemove}>
              🗑
            </button>
          )}
        </div>
      </header>

      {showRest && (
        <div className="rest-picker">
          <span className="rest-picker-lbl">Rest for this exercise</span>
          <div className="rest-picker-opts">
            {REST_PRESETS.map((s) => (
              <button key={s} className={rest === s ? "active" : ""} onClick={() => pickRest(s)}>
                {fmtRest(s)}
              </button>
            ))}
            <button className={rest == null ? "active" : ""} onClick={() => pickRest(null)}>
              Default ({fmtRest(defaultRest)})
            </button>
          </div>
        </div>
      )}

      {showNote && (
        <input
          className="exercise-note"
          type="text"
          value={exercise.note ?? ""}
          placeholder="Note for this exercise…"
          onChange={(e) => onChange({ ...exercise, note: e.target.value || undefined })}
        />
      )}

      {showPrev ? (
        <div className="prev-panel">
          <div className="prev-panel-head">
            <span className="prev-panel-title">
              Last time
              {prevDate ? <span className="prev-panel-date"> · {niceDate(prevDate)} ({daysAgoLabel(prevDate)})</span> : ""}
            </span>
            <button className="mini" onClick={() => setShowPrev(false)}>
              Back to editing
            </button>
          </div>
          {prev && prev.sets.length ? (
            <ol className="prev-sets">
              {prev.sets.map((s, i) => (
                <li key={s.id ?? i}>
                  <span className="prev-set-n">{i + 1}</span>
                  <span className="prev-set-v">{fmtPrevSet(s)}</span>
                </li>
              ))}
              {prev.note && <li className="prev-note">“{prev.note}”</li>}
            </ol>
          ) : (
            <p className="muted tiny">No previous session logged for this exercise yet.</p>
          )}
        </div>
      ) : (
        <div className="sets">
          {exercise.sets.map((s, i) => (
            <SetInput
              key={s.id ?? i}
              index={i}
              set={s}
              step={step}
              unit={unit}
              units={units}
              defaultReps={defReps}
              active={i === exercise.sets.findIndex((x) => !x.done)}
              prevWeight={prev?.sets[i]?.weight ?? prev?.sets.at(-1)?.weight ?? null}
              onChange={(p) => patchSet(i, p)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
