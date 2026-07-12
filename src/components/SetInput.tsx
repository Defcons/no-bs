// One set row: big thumb-friendly weight entry with +/- steppers, reps, and an
// optional note. Weight is the primary input; reps is pre-filled from the scheme.
// Units ("kg"/"reps") are static suffixes inside each field so they don't throw
// off vertical alignment.
import { type FocusEvent, type KeyboardEvent, useState } from "react";
import type { SetEntry } from "../types";

type Props = {
  index: number;
  set: SetEntry;
  step: number; // +/- increment in kg
  active?: boolean; // the next set to log (first not-done) — subtle outline
  prevWeight?: number | null; // last session's weight, shown as ghost hint
  onChange: (patch: Partial<SetEntry>) => void;
};

function parseWeight(s: string): number | null {
  const v = s.replace(",", ".").trim();
  if (v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Select existing text on focus so typing replaces it (no manual backspacing).
const selectAll = (e: FocusEvent<HTMLInputElement>) => e.target.select();
// Enter (the keyboard's ✓/done key on phones) dismisses the keyboard.
const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

export function SetInput({ index, set, step, active, prevWeight, onChange }: Props) {
  const [showNote, setShowNote] = useState(!!set.note);
  const done = !!set.done;
  // Editing any value marks the set done (green).
  const bump = (d: number) => onChange({ weight: Math.max(0, (set.weight ?? prevWeight ?? 0) + d), done: true });

  return (
    <div className={`setrow ${done ? "done" : ""} ${active && !done ? "active" : ""}`}>
      <button className="set-badge" aria-label="toggle set done" onClick={() => onChange({ done: !done })}>
        {index + 1}
      </button>

      <div className="weight-group">
        <button className="stepper" aria-label="decrease" onClick={() => bump(-step)}>
          −
        </button>
        <div className="field weight-field">
          <input
            type="text"
            inputMode="decimal"
            value={set.weight ?? ""}
            placeholder={prevWeight != null ? String(prevWeight) : "—"}
            onFocus={selectAll}
            onKeyDown={blurOnEnter}
            onChange={(e) => onChange({ weight: parseWeight(e.target.value), done: true })}
          />
          <span className="unit">kg</span>
        </div>
        <button className="stepper" aria-label="increase" onClick={() => bump(step)}>
          +
        </button>
      </div>

      <div className="field reps-field">
        <input
          type="text"
          inputMode="numeric"
          value={set.reps ?? ""}
          placeholder="—"
          onFocus={selectAll}
          onKeyDown={blurOnEnter}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ reps: Number.isFinite(n) ? n : null, done: true });
          }}
        />
        <span className="unit">×</span>
      </div>

      <div className="field assist-field" title="assisted / extra reps → shown as (n) in the sheet">
        <span className="unit">(</span>
        <input
          type="text"
          inputMode="numeric"
          value={set.assist ?? ""}
          placeholder="–"
          onFocus={selectAll}
          onKeyDown={blurOnEnter}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ assist: Number.isFinite(n) ? n : null, done: true });
          }}
        />
        <span className="unit">)</span>
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
          onKeyDown={blurOnEnter}
          placeholder="note for this set…"
          onChange={(e) => onChange({ note: e.target.value || undefined })}
        />
      )}
    </div>
  );
}
