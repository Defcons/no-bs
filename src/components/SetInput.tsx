// One set row: big thumb-friendly weight entry with +/- steppers, reps, and an
// optional note. Weight is the primary input; reps is pre-filled from the scheme.
import { useState } from "react";
import type { SetEntry } from "../types";

type Props = {
  index: number;
  set: SetEntry;
  step: number; // +/- increment in kg
  prevWeight?: number | null; // last session's weight, shown as ghost hint
  onChange: (patch: Partial<SetEntry>) => void;
};

function parseWeight(s: string): number | null {
  const v = s.replace(",", ".").trim();
  if (v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function SetInput({ index, set, step, prevWeight, onChange }: Props) {
  const [showNote, setShowNote] = useState(!!set.note);
  const done = set.weight != null;
  const bump = (d: number) => onChange({ weight: Math.max(0, (set.weight ?? prevWeight ?? 0) + d) });

  return (
    <div className={`setrow ${done ? "done" : ""}`}>
      <div className="set-badge">{index + 1}</div>

      <div className="weight-group">
        <button className="stepper" aria-label="decrease" onClick={() => bump(-step)}>
          −
        </button>
        <input
          className="weight-input"
          type="text"
          inputMode="decimal"
          value={set.weight ?? ""}
          placeholder={prevWeight != null ? String(prevWeight) : "kg"}
          onChange={(e) => onChange({ weight: parseWeight(e.target.value) })}
        />
        <button className="stepper" aria-label="increase" onClick={() => bump(step)}>
          +
        </button>
      </div>

      <div className="reps-group">
        <input
          className="reps-input"
          type="text"
          inputMode="numeric"
          value={set.reps ?? ""}
          placeholder="reps"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ reps: Number.isFinite(n) ? n : null });
          }}
        />
        <span className="reps-label">reps</span>
      </div>

      <button
        className={`note-toggle ${set.note ? "has-note" : ""}`}
        aria-label="set note"
        onClick={() => setShowNote((v) => !v)}
      >
        ✎
      </button>

      {showNote && (
        <input
          className="set-note"
          type="text"
          value={set.note ?? ""}
          placeholder="note for this set…"
          onChange={(e) => onChange({ note: e.target.value || undefined })}
        />
      )}
    </div>
  );
}
