// A single exercise within the active workout: header (name + scheme), its set
// rows, add/remove set, and an optional per-exercise note.
import { useState } from "react";
import type { ExercisePerf, SetEntry } from "../types";
import { SetInput } from "./SetInput";

type Props = {
  exercise: ExercisePerf;
  step: number;
  prev?: ExercisePerf; // last session's performance of this exercise (for hints)
  onChange: (ex: ExercisePerf) => void;
};

function schemeLabel(ex: ExercisePerf): string {
  const { sets, reps } = ex.scheme;
  if (sets == null && reps == null) return "";
  return `${sets ?? "?"}×${reps ?? "?"}`;
}

export function ExerciseCard({ exercise, step, prev, onChange }: Props) {
  const [showNote, setShowNote] = useState(!!exercise.note);

  const patchSet = (i: number, patch: Partial<SetEntry>) => {
    const sets = exercise.sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...exercise, sets });
  };
  const addSet = () => {
    const last = exercise.sets.at(-1);
    onChange({ ...exercise, sets: [...exercise.sets, { weight: null, reps: last?.reps ?? null }] });
  };
  const removeSet = () => {
    if (exercise.sets.length > 1) onChange({ ...exercise, sets: exercise.sets.slice(0, -1) });
  };

  return (
    <section className="exercise-card">
      <header className="exercise-head">
        <h3>{exercise.name}</h3>
        <span className="scheme">{schemeLabel(exercise)}</span>
        <button
          className={`note-toggle ${exercise.note ? "has-note" : ""}`}
          aria-label="exercise note"
          onClick={() => setShowNote((v) => !v)}
        >
          ✎
        </button>
      </header>

      {showNote && (
        <input
          className="exercise-note"
          type="text"
          value={exercise.note ?? ""}
          placeholder="note for this exercise…"
          onChange={(e) => onChange({ ...exercise, note: e.target.value || undefined })}
        />
      )}

      <div className="sets">
        {exercise.sets.map((s, i) => (
          <SetInput
            key={i}
            index={i}
            set={s}
            step={step}
            prevWeight={prev?.sets[i]?.weight ?? prev?.sets.at(-1)?.weight ?? null}
            onChange={(p) => patchSet(i, p)}
          />
        ))}
      </div>

      <div className="set-actions">
        <span className="set-actions-label">Sets:</span>
        <button className="mini set-step" aria-label="remove set" onClick={removeSet}>
          −
        </button>
        <button className="mini set-step" aria-label="add set" onClick={addSet}>
          +
        </button>
      </div>
    </section>
  );
}
