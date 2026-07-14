// One set row. Adapts to the exercise's unit:
//  - weight (default): big weight (kg) + reps, with +/- steppers.
//  - bodyweight: same layout but the weight is optional ADDED weight ("+kg", "BW"
//    placeholder) and reps is the point (so pull-ups/dips/push-ups count).
//  - time: a single duration field (seconds) for planks/holds.
// The rare extras (assist reps + note) live behind a ⋯ reveal. (Phase 2 + P2 units.)
import { type KeyboardEvent, useRef, useState } from "react";
import type { ExerciseUnit } from "../lib/exercises";
import { type WeightUnit, displayStep, fromDisplayWeight, toDisplayWeight, weightStr } from "../lib/units";
import type { SetEntry } from "../types";

type Props = {
  index: number;
  set: SetEntry;
  step: number; // +/- increment in kg
  unit?: ExerciseUnit; // exercise unit (default weight)
  units?: WeightUnit; // weight display/entry unit (kg default)
  active?: boolean; // the next set to log (first not-done) — subtle outline
  prevWeight?: number | null; // last session's weight (kg), shown as ghost hint
  onChange: (patch: Partial<SetEntry>) => void;
};

function parseWeight(s: string): number | null {
  const v = s.replace(",", ".").trim();
  if (v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function parseInt10(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// Enter (the keyboard's ✓/done key on phones) dismisses the keyboard.
const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

type NumField = "weight" | "reps" | "assist" | "seconds";

export function SetInput({ index, set, step, unit = "weight", units = "kg", active, prevWeight, onChange }: Props) {
  const hasExtra = !!set.note || set.assist != null;
  const [showMore, setShowMore] = useState(hasExtra);
  const done = !!set.done;
  const bodyweight = unit === "bodyweight";
  const timed = unit === "time";
  // Weight is stored in kg; display + entry happen in the user's unit.
  const dispStep = displayStep(step, units);
  // Only the number badge marks a set done — value edits deliberately do NOT
  // (user decision 2026-07-12): prefilled weights would otherwise green-flag
  // sets you never performed.
  const bump = (dir: number) => {
    const curDisp = toDisplayWeight(set.weight ?? prevWeight ?? 0, units);
    onChange({ weight: fromDisplayWeight(Math.max(0, curDisp + dir * dispStep), units) });
  };

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

      {timed ? (
        <div className="field time-field">
          <input
            type="text"
            inputMode="numeric"
            value={set.seconds ?? ""}
            placeholder="—"
            onFocus={clearOnFocus("seconds")}
            onBlur={restoreOnBlur("seconds")}
            onKeyDown={blurOnEnter}
            onChange={(e) => onChange({ seconds: parseInt10(e.target.value) })}
          />
          <span className="unit">sec</span>
        </div>
      ) : (
        <>
          <div className="weight-group">
            <button className="stepper" aria-label="decrease" onClick={() => bump(-1)}>
              −
            </button>
            <div className="field weight-field">
              <input
                type="text"
                inputMode="decimal"
                value={set.weight == null ? "" : weightStr(set.weight, units)}
                placeholder={bodyweight ? "BW" : prevWeight != null ? weightStr(prevWeight, units) : "—"}
                onFocus={clearOnFocus("weight")}
                onBlur={restoreOnBlur("weight")}
                onKeyDown={blurOnEnter}
                onChange={(e) => {
                  const d = parseWeight(e.target.value);
                  onChange({ weight: d == null ? null : fromDisplayWeight(d, units) });
                }}
              />
              <span className="unit">{bodyweight ? `+${units}` : units}</span>
            </div>
            <button className="stepper" aria-label="increase" onClick={() => bump(1)}>
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
              onChange={(e) => onChange({ reps: parseInt10(e.target.value) })}
            />
            <span className="unit">reps</span>
          </div>
        </>
      )}

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
          {!timed && (
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
                  onChange={(e) => onChange({ assist: parseInt10(e.target.value) })}
                />
              </div>
            </label>
          )}
          <input
            className="set-note"
            type="text"
            value={set.note ?? ""}
            onKeyDown={blurOnEnter}
            placeholder="Note for this set…"
            onChange={(e) => onChange({ note: e.target.value || undefined })}
          />
        </div>
      )}
    </div>
  );
}
