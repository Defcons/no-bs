// One set row. Adapts to the exercise's unit:
//  - weight (default): big weight (kg) + reps, with +/- steppers.
//  - bodyweight: same layout but the weight is optional ADDED weight ("+kg", "BW"
//    placeholder) and reps is the point (so pull-ups/dips/push-ups count).
//  - time: a single duration field (seconds) for planks/holds.
//  - distance: km + minutes, what runners/swimmers/cyclists actually log.
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
  defaultReps?: number | null; // scheme's target reps — border greens if you beat it, reds if under
  active?: boolean; // the next set to log (first not-done) — subtle outline
  isPr?: boolean; // this set is a new all-time est-1RM PR — gold celebratory badge
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

type NumField = "weight" | "reps" | "assist" | "seconds" | "distanceM";
// Trim trailing zeros: 5.20 → "5.2", 5.00 → "5".
const tidy = (n: number, digits: number) => String(Number(n.toFixed(digits)));

export function SetInput({ index, set, step, unit = "weight", units = "kg", defaultReps, active, isPr, prevWeight, onChange }: Props) {
  const hasExtra = !!set.note || set.assist != null;
  const [showMore, setShowMore] = useState(hasExtra);
  const done = !!set.done;
  const bodyweight = unit === "bodyweight";
  const timed = unit === "time";
  const distance = unit === "distance";
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
    <div className={`setrow ${done ? "done" : ""} ${active && !done ? "active" : ""} ${isPr ? "pr" : ""}`}>
      <button className="set-badge" aria-label="toggle set done" onClick={() => onChange({ done: !done })}>
        {index + 1}
      </button>
      {isPr && (
        <span className="pr-badge" title="Personal record — best estimated 1-rep max">
          PR
        </span>
      )}

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
      ) : distance ? (
        <>
          <div className="field dist-field">
            <input
              type="text"
              inputMode="decimal"
              value={set.distanceM == null ? "" : tidy(set.distanceM / 1000, 2)}
              placeholder="—"
              onFocus={clearOnFocus("distanceM")}
              onBlur={restoreOnBlur("distanceM")}
              onKeyDown={blurOnEnter}
              onChange={(e) => {
                const km = parseWeight(e.target.value);
                onChange({ distanceM: km == null ? null : Math.round(km * 1000) });
              }}
            />
            <span className="unit">km</span>
          </div>
          <div className="field dist-field">
            <input
              type="text"
              inputMode="decimal"
              value={set.seconds == null ? "" : tidy(set.seconds / 60, 1)}
              placeholder="—"
              onFocus={clearOnFocus("seconds")}
              onBlur={restoreOnBlur("seconds")}
              onKeyDown={blurOnEnter}
              onChange={(e) => {
                const min = parseWeight(e.target.value);
                onChange({ seconds: min == null ? null : Math.round(min * 60) });
              }}
            />
            <span className="unit">min</span>
          </div>
        </>
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

          <div
            className={`field reps-field ${
              set.reps != null && defaultReps != null && set.reps !== defaultReps
                ? set.reps > defaultReps
                  ? "reps-over"
                  : "reps-under"
                : ""
            }`}
          >
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
          {!timed && !distance && (
            <label className="extra-field" title="assisted reps — shown as (n) in the sheet">
              <span className="extra-lbl">Assisted reps</span>
              <div className="field assist-field">
                {/* Plain input (no clear-on-focus/restore-on-blur): this optional field
                    must edit and CLEAR normally — the tap-to-retype pattern used for
                    weight/reps would restore the old value and block blanking it. */}
                <input
                  type="text"
                  inputMode="numeric"
                  value={set.assist ?? ""}
                  placeholder="—"
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
