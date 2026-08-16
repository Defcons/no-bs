// One set row. Adapts to the exercise's unit:
//  - weight (default): big weight (kg) + reps, with +/- steppers.
//  - bodyweight: same layout but the weight is optional ADDED weight ("+kg", "BW"
//    placeholder) and reps is the point (so pull-ups/dips/push-ups count).
//  - time: a single duration field (seconds) for planks/holds.
//  - distance: km + minutes, what runners/swimmers/cyclists actually log.
// The rare extras (assist reps + note) live behind a ⋯ reveal. (Phase 2 + P2 units.)
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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
  prevNote?: string | null; // last session's note on this set → hint the ⋯ + prefill its placeholder
  prevReps?: number | null; // last session's reps on this set → faint hint if it beat the target
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

// A decimal number field that keeps what you TYPE while you're typing. The value is
// parsed to a number live (so "done"/PR logic sees it), but the raw string — with a
// half-finished "5." or "5," — stays on screen instead of being reformatted away, so
// the decimal separator is no longer eaten before you can type the next digit.
// Tap-to-retype: clears on focus; restores the old value if you blur without a new one.
function DecField({
  value,
  format,
  parse,
  onCommit,
  placeholder,
  unit,
  fieldClass,
  extraClass,
}: {
  value: number | null;
  format: (n: number) => string;
  parse: (s: string) => number | null;
  onCommit: (n: number | null) => void;
  placeholder: string;
  unit: string;
  fieldClass: string;
  extraClass?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null); // non-null while the user is editing
  const stash = useRef<number | null>(null);
  const display = raw != null ? raw : value == null ? "" : format(value);
  return (
    <div className={`field ${fieldClass}${extraClass ? ` ${extraClass}` : ""}`}>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        placeholder={placeholder}
        onFocus={() => {
          stash.current = value;
          setRaw("");
          if (value != null) onCommit(null);
        }}
        onBlur={() => {
          if ((raw ?? "").trim() === "" && value == null && stash.current != null) onCommit(stash.current);
          setRaw(null);
        }}
        onKeyDown={blurOnEnter}
        onChange={(e) => {
          setRaw(e.target.value);
          onCommit(parse(e.target.value));
        }}
      />
      <span className="unit">{unit}</span>
    </div>
  );
}

export function SetInput({ index, set, step, unit = "weight", units = "kg", defaultReps, active, isPr, prevWeight, prevNote, prevReps, onChange }: Props) {
  const hasExtra = !!set.note || set.assist != null;
  const [showMore, setShowMore] = useState(hasExtra);
  const done = !!set.done;
  const bodyweight = unit === "bodyweight";
  const timed = unit === "time";
  const distance = unit === "distance";
  // Weight is stored in kg; display + entry happen in the user's unit.
  const dispStep = displayStep(step, units);

  // Auto-collapse the ⋯ panel a few seconds after you finish writing a note, so the
  // set row tidies itself back up. Rescheduled on each keystroke → fires 3s after the
  // last one; cancelled while you're in the assist field.
  const collapseRef = useRef<number | undefined>(undefined);
  const scheduleCollapse = () => {
    window.clearTimeout(collapseRef.current);
    collapseRef.current = window.setTimeout(() => setShowMore(false), 3000);
  };
  const cancelCollapse = () => window.clearTimeout(collapseRef.current);
  useEffect(() => () => window.clearTimeout(collapseRef.current), []);

  // Only the number badge marks a set done — value edits deliberately do NOT
  // (user decision 2026-07-12): prefilled weights would otherwise green-flag
  // sets you never performed.
  const bump = (dir: number) => {
    const curDisp = toDisplayWeight(set.weight ?? prevWeight ?? 0, units);
    onChange({ weight: fromDisplayWeight(Math.max(0, curDisp + dir * dispStep), units) });
  };

  // Tap-to-edit for the INTEGER fields (reps/seconds): clear on focus (no highlighted
  // text → no Android copy/paste toolbar), restore the old value if you tap away
  // without typing. (Decimal fields use DecField, which owns the same pattern.)
  const stash = useRef<Partial<Record<NumField, number | null>>>({});
  const clearOnFocus = (f: NumField) => () => {
    stash.current[f] = set[f] as number | null;
    if (set[f] != null) onChange({ [f]: null });
  };
  const restoreOnBlur = (f: NumField) => () => {
    if (set[f] == null && stash.current[f] != null) onChange({ [f]: stash.current[f] });
  };

  // Last time you beat the scheme's target reps on this set → a faint "last week"
  // tint on the reps field (only until you log this set's reps).
  const repsPrevBeat = set.reps == null && prevReps != null && defaultReps != null && prevReps > defaultReps;

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
          <DecField
            value={set.distanceM ?? null}
            format={(m) => tidy(m / 1000, 2)}
            parse={(s) => {
              const km = parseWeight(s);
              return km == null ? null : Math.round(km * 1000);
            }}
            onCommit={(v) => onChange({ distanceM: v })}
            placeholder="—"
            unit="km"
            fieldClass="dist-field"
          />
          <DecField
            value={set.seconds ?? null}
            format={(s) => tidy(s / 60, 1)}
            parse={(s) => {
              const min = parseWeight(s);
              return min == null ? null : Math.round(min * 60);
            }}
            onCommit={(v) => onChange({ seconds: v })}
            placeholder="—"
            unit="min"
            fieldClass="dist-field"
          />
        </>
      ) : (
        <>
          <div className="weight-group">
            <button className="stepper" aria-label="decrease" onClick={() => bump(-1)}>
              −
            </button>
            <DecField
              value={set.weight ?? null}
              format={(kg) => weightStr(kg, units)}
              parse={(s) => {
                const d = parseWeight(s);
                return d == null ? null : fromDisplayWeight(d, units);
              }}
              onCommit={(v) => onChange({ weight: v })}
              placeholder={bodyweight ? "BW" : prevWeight != null ? weightStr(prevWeight, units) : "—"}
              unit={bodyweight ? `+${units}` : units}
              fieldClass="weight-field"
            />
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
            } ${repsPrevBeat ? "prev-beat" : ""}`}
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
        className={`more-toggle ${hasExtra ? "has-extra" : ""} ${showMore ? "open" : ""} ${prevNote && !set.note ? "hint-prev" : ""}`}
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
                  onFocus={cancelCollapse}
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
            onFocus={cancelCollapse}
            onKeyDown={blurOnEnter}
            placeholder={prevNote ? `Last time: "${prevNote}"` : "Note for this set…"}
            onChange={(e) => {
              onChange({ note: e.target.value || undefined });
              scheduleCollapse();
            }}
          />
        </div>
      )}
    </div>
  );
}
