// A single exercise within the active workout: header (name + scheme), its set
// rows, add/remove set, and an optional per-exercise note.
import { useState } from "react";
import type { ExercisePerf, SetEntry } from "../types";
import { uid } from "../lib/uid";
import { SetInput } from "./SetInput";

type Props = {
  exercise: ExercisePerf;
  step: number;
  prev?: ExercisePerf; // last session's performance of this exercise (for hints)
  onChange: (ex: ExercisePerf) => void;
  editableName?: boolean; // custom sessions: let the user name the exercise
  onRemove?: () => void; // custom sessions: remove this exercise
  onMoveUp?: () => void; // reorder within this session only
  onMoveDown?: () => void;
};

export function ExerciseCard({ exercise, step, prev, onChange, editableName, onRemove, onMoveUp, onMoveDown }: Props) {
  const [showNote, setShowNote] = useState(!!exercise.note);

  const patchSet = (i: number, patch: Partial<SetEntry>) => {
    const sets = exercise.sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...exercise, sets });
  };
  const addSet = () => {
    const last = exercise.sets.at(-1);
    // Carry the previous set's weight, but reset reps to the exercise's scheme default.
    const defReps = typeof exercise.scheme.reps === "number" ? exercise.scheme.reps : null;
    onChange({ ...exercise, sets: [...exercise.sets, { id: uid(), weight: last?.weight ?? null, reps: defReps, done: false }] });
  };
  const removeSet = () => {
    if (exercise.sets.length > 1) onChange({ ...exercise, sets: exercise.sets.slice(0, -1) });
  };

  return (
    <section className="exercise-card">
      <header className="exercise-head">
        {editableName ? (
          <input
            className="exercise-name-input"
            type="text"
            value={exercise.name}
            placeholder="exercise name…"
            onChange={(e) => onChange({ ...exercise, name: e.target.value })}
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
            key={s.id ?? i}
            index={i}
            set={s}
            step={step}
            active={i === exercise.sets.findIndex((x) => !x.done)}
            prevWeight={prev?.sets[i]?.weight ?? prev?.sets.at(-1)?.weight ?? null}
            onChange={(p) => patchSet(i, p)}
          />
        ))}
      </div>
    </section>
  );
}
