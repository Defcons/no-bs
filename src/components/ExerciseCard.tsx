// A single exercise within the active workout: header (name + scheme), its set
// rows, add/remove set, and an optional per-exercise note.
import { useEffect, useState } from "react";
import type { ExercisePerf, SetEntry } from "../types";
import { uid } from "../lib/uid";
import { SetInput } from "./SetInput";
import { ExerciseNameField } from "./ExerciseNameField";
import { resolveExercise } from "../lib/exercises";
import { restForId, setRestForId } from "../lib/exerciseRest";
import type { WeightUnit } from "../lib/units";

const REST_PRESETS = [30, 60, 90, 120, 150, 180];
const fmtRest = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`);

type Props = {
  exercise: ExercisePerf;
  step: number;
  prev?: ExercisePerf; // last session's performance of this exercise (for hints)
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

export function ExerciseCard({ exercise, step, prev, onChange, onSetDone, defaultRest = 90, editableName, units, nameHistory, onRemove, onMoveUp, onMoveDown }: Props) {
  const [showNote, setShowNote] = useState(!!exercise.note);
  const resolved = resolveExercise(exercise.name, exercise.exerciseId);
  const unit = resolved.unit;
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
    <section className="exercise-card">
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
    </section>
  );
}
