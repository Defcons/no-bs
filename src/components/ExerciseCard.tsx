// A single exercise within the active workout: header (name + scheme), its set
// rows, add/remove set, and an optional per-exercise note.
import { type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ExercisePerf, SetEntry } from "../types";
import { uid } from "../lib/uid";
import { SetInput } from "./SetInput";
import { ExerciseNameField } from "./ExerciseNameField";
import { resolveExercise } from "../lib/exercises";
import { type WeightUnit, weightStr } from "../lib/units";
import { daysAgoLabel, mmss, niceDate } from "../lib/format";
import { epley } from "../lib/stats";
import { playPr } from "../lib/sounds";

type Props = {
  exercise: ExercisePerf;
  step: number;
  prev?: ExercisePerf; // last session's performance of this exercise (for hints)
  prevDate?: string; // ISO date of that last session (for the swipe-in "last time" panel)
  onChange: (ex: ExercisePerf) => void;
  onSetDone?: () => void; // set explicitly marked done via its badge (not weight edits)
  bestE1rm?: number; // all-time best est-1RM for this lift (drives the live PR badge)
  isActive?: boolean; // this is the current exercise (its next set is up) — highlight + cue
  editableName?: boolean; // custom sessions: let the user name the exercise
  units?: WeightUnit; // weight display/entry unit
  nameHistory?: string[]; // distinct past exercise names (autocomplete)
  onRemove?: () => void; // custom sessions: remove this exercise
  onMoveUp?: () => void; // reorder within this session only
  onMoveDown?: () => void;
};

export function ExerciseCard({ exercise, step, prev, prevDate, onChange, onSetDone, bestE1rm, isActive, editableName, units, nameHistory, onRemove, onMoveUp, onMoveDown }: Props) {
  const [showNote, setShowNote] = useState(!!exercise.note);
  const resolved = resolveExercise(exercise.name, exercise.exerciseId);
  const unit = resolved.unit;

  // Live PR: among the sets you've MARKED DONE (tapping the badge is the "I did it"
  // signal — so this never fires mid-typing), the one whose est-1RM beats your
  // all-time best for this lift. Weight exercises only; needs prior history to beat.
  const prIndex = useMemo(() => {
    if (unit !== "weight" || !bestE1rm || bestE1rm <= 0) return -1;
    let idx = -1;
    let top = bestE1rm;
    exercise.sets.forEach((s, i) => {
      // MAX_PLAUSIBLE_KG guard (mirrors lib/stats): ignore typo weights like 40-4040.
      if (!s.done || s.weight == null || s.weight <= 0 || s.weight > 500 || !s.reps || s.reps <= 0) return;
      const e = epley(s.weight, s.reps);
      if (e > top) {
        top = e;
        idx = i;
      }
    });
    return idx;
  }, [exercise.sets, bestE1rm, unit]);

  // Play the celebratory flourish once, when a set first BECOMES the PR (id flips in).
  // Skip the initial mount so reopening the app on an already-set PR doesn't replay it.
  const prSetId = prIndex >= 0 ? exercise.sets[prIndex]?.id ?? null : null;
  const prevPr = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevPr.current === undefined) {
      prevPr.current = prSetId;
      return;
    }
    if (prSetId && prSetId !== prevPr.current) playPr();
    prevPr.current = prSetId;
  }, [prSetId]);

  // Swipe RIGHT (or the ↺ header button) reveals last time's numbers, read-only.
  const [showPrev, setShowPrev] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    // Don't begin a swipe from inside a field/control — editing weight/reps (or a
    // stepper drag) must not flip the card to the last-time panel.
    if ((e.target as HTMLElement).closest("input, textarea, select, button")) {
      touch.current = null;
      return;
    }
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
  const patchSet = (i: number, patch: Partial<SetEntry>) => {
    const sets = exercise.sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...exercise, sets });
    // A bare {done:true} patch = the set badge was tapped (weight/rep edits also
    // set done, but always alongside their value) — that's the "set finished" signal.
    if (patch.done === true && Object.keys(patch).length === 1) onSetDone?.();
  };
  // Scheme's target reps (null for "Max"): the rep-vs-target border cue + new-set default.
  const defReps = typeof exercise.scheme.reps === "number" ? exercise.scheme.reps : null;
  // "What's next" cue on the current exercise: the first set still to log + its target.
  const nextSetIdx = exercise.sets.findIndex((s) => !s.done);
  const repTarget = exercise.scheme.reps === "Max" ? "Max" : defReps != null ? String(defReps) : null;
  const repBased = unit !== "time" && unit !== "distance";
  const addSet = () => {
    const last = exercise.sets.at(-1);
    // Carry the previous set's weight, but reset reps to the exercise's scheme default.
    onChange({ ...exercise, sets: [...exercise.sets, { id: uid(), weight: last?.weight ?? null, reps: defReps, done: false }] });
  };
  const removeSet = () => {
    if (exercise.sets.length > 1) onChange({ ...exercise, sets: exercise.sets.slice(0, -1) });
  };

  return (
    <section className={`exercise-card ${isActive ? "active" : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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

      {isActive && nextSetIdx >= 0 && (
        <div className="active-hint tiny">
          <span className="active-now">▶ Current</span>
          <span className="muted">
            Set {nextSetIdx + 1}/{exercise.sets.length}
            {repBased && repTarget ? ` · aim ${repTarget} reps` : ""}
          </span>
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
        <div className="prev-panel lastweek" aria-readonly="true">
          <div className="lw-ribbon">
            <span className="lw-tag">Last week</span>
            {prevDate && (
              <span className="lw-date">
                {niceDate(prevDate)} · {daysAgoLabel(prevDate)}
              </span>
            )}
            <span className="lw-lock">🔒 read-only</span>
          </div>
          {prev && prev.sets.length ? (
            <div className="prev-rows">
              {prev.sets.map((s, i) => {
                const u = units ?? "kg";
                // Reps vs the scheme target: over = green, under = red (mirrors the live cue).
                const over = s.reps != null && defReps != null && s.reps > defReps;
                const under = s.reps != null && defReps != null && s.reps < defReps;
                return (
                  <div className="setrow ro" key={s.id ?? i}>
                    <span className="ro-badge num">{i + 1}</span>
                    {unit === "time" ? (
                      <span className="ro-val">
                        <span className="num">{s.seconds ?? "—"}</span>
                        <span className="ro-u">sec</span>
                      </span>
                    ) : unit === "distance" ? (
                      <>
                        <span className="ro-val">
                          <span className="num">{s.distanceM != null ? Number((s.distanceM / 1000).toFixed(2)) : "—"}</span>
                          <span className="ro-u">km</span>
                        </span>
                        {s.seconds != null && (
                          <span className="ro-val">
                            <span className="num">{mmss(s.seconds)}</span>
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="ro-val">
                          {unit === "bodyweight" ? (
                            s.weight ? (
                              <>
                                <span className="num">+{weightStr(s.weight, u)}</span>
                                <span className="ro-u">{u}</span>
                              </>
                            ) : (
                              <span className="ro-u">BW</span>
                            )
                          ) : s.weight != null ? (
                            <>
                              <span className="num">{weightStr(s.weight, u)}</span>
                              <span className="ro-u">{u}</span>
                            </>
                          ) : (
                            <span className="ro-u">—</span>
                          )}
                        </span>
                        <span className="ro-val">
                          <span className={`num repnum ${over ? "over" : under ? "under" : ""}`}>× {s.reps ?? "—"}</span>
                        </span>
                        {s.assist != null && s.assist > 0 && <span className="assist-n num">({s.assist})</span>}
                      </>
                    )}
                  </div>
                );
              })}
              {prev.note && <p className="lw-note">“{prev.note}”</p>}
            </div>
          ) : (
            <p className="muted tiny">No previous session logged for this exercise yet.</p>
          )}
          <button className="mini prev-back" onClick={() => setShowPrev(false)}>
            ← Back to this week (edit)
          </button>
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
              active={isActive && i === exercise.sets.findIndex((x) => !x.done)}
              isPr={i === prIndex}
              prevWeight={prev?.sets[i]?.weight ?? prev?.sets.at(-1)?.weight ?? null}
              onChange={(p) => patchSet(i, p)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
