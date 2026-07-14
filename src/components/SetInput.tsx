// One set row: big thumb-friendly weight entry with +/- steppers and reps. Weight
// is the primary input; reps is pre-filled from the scheme. The rare extras —
// assist/extra reps and a per-set note — live behind a ⋯ reveal so the row you
// touch every set stays clean with 44px targets. (Phase 2 redesign.)
import { type KeyboardEvent, useRef, useState } from "react";
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

// Enter (the keyboard's ✓/done key on phones) dismisses the keyboard.
const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

type NumField = "weight" | "reps" | "assist";

export function SetInput({ index, set, step, active, prevWeight, onChange }: Props) {
  const hasExtra = !!set.note || set.assist != null;
  const [showMore, setShowMore] = useState(hasExtra);
  const done = !!set.done;
  // Only the number badge marks a set done — value edits deliberately do NOT
  // (user decision 2026-07-12): prefilled weights would otherwise green-flag
  // sets you never performed.
  const bump = (d: number) => onChange({ weight: Math.max(0, (set.weight ?? prevWeight ?? 0) + d) });

  // Tap-to-edit: clear the field on focus (so there's no highlighted text and thus
  // no Android copy/paste toolbar — just start typing the new value). If the user
  // taps away without typing, the previous value is restored. (user decision 2026-07-12)
  const stash = useRef<Partial<Record<NumField, number | null>>>({});
  const clearOnFocus = (f: NumField) => () => {
    stash.current[f] = set[f] as number | null;
    if (set[f] != null) onChange({ [f]: null });
  };
  const restoreOnBlur = (f: NumField) => () => {
    if (set[f] == null && stash.current[f] != null) onChange({ [f]: stash.current[f] });
  };

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
            onFocus={clearOnFocus("weight")}
            onBlur={restoreOnBlur("weight")}
            onKeyDown={blurOnEnter}
            onChange={(e) => onChange({ weight: parseWeight(e.target.value) })}
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
          onFocus={clearOnFocus("reps")}
          onBlur={restoreOnBlur("reps")}
          onKeyDown={blurOnEnter}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ reps: Number.isFinite(n) ? n : null });
          }}
        />
        <span className="unit">reps</span>
      </div>

      <button
        className={`more-toggle ${hasExtra ? "has-extra" : ""} ${showMore ? "open" : ""}`}
        aria-label="assist reps & note"
        aria-expanded={showMore}
        onClick={() => setShowMore((v) => !v)}
      >
        ⋯
      </button>

      {showMore && (
        <div className="set-extra">
          <label className="extra-field" title="assisted or extra reps — shown as (n) in the sheet">
            <span className="extra-lbl">Assist / extra reps</span>
            <div className="field assist-field">
              <input
                type="text"
                inputMode="numeric"
                value={set.assist ?? ""}
                placeholder="—"
                onFocus={clearOnFocus("assist")}
                onBlur={restoreOnBlur("assist")}
                onKeyDown={blurOnEnter}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  onChange({ assist: Number.isFinite(n) ? n : null });
                }}
              />
            </div>
          </label>
          <input
            className="set-note"
            type="text"
            value={set.note ?? ""}
            onKeyDown={blurOnEnter}
            placeholder="note for this set…"
            onChange={(e) => onChange({ note: e.target.value || undefined })}
          />
        </div>
      )}
    </div>
  );
}
