// A single exercise within the active workout: header (name + scheme), its set
// rows, add/remove set, and an optional per-exercise note. Swipe the card LEFT to
// step back through up to 3 previous sessions of this exercise (read-only), RIGHT
// to come forward; the ↺ header button does the same by tap.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExercisePerf, SetEntry } from "../types";
import { uid } from "../lib/uid";
import { SetInput } from "./SetInput";
import { ExerciseNameField } from "./ExerciseNameField";
import { resolveExercise } from "../lib/exercises";
import { type WeightUnit, weightStr } from "../lib/units";
import { daysAgoLabel, mmss, niceDate } from "../lib/format";
import { MAX_PLAUSIBLE_KG, epley } from "../lib/stats";
import { playPr } from "../lib/sounds";

// One past performance of this exercise + the date it was logged (most-recent first).
export type PrevSession = { date: string; perf: ExercisePerf };
const MAX_BACK = 3; // how many sessions back the swipe can reach

type Props = {
  exercise: ExercisePerf;
  step: number;
  history?: PrevSession[]; // up to MAX_BACK previous sessions of this exercise, newest first
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

export function ExerciseCard({ exercise, step, history, onChange, onSetDone, bestE1rm, isActive, editableName, units, nameHistory, onRemove, onMoveUp, onMoveDown }: Props) {
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
      if (!s.done || s.weight == null || s.weight <= 0 || s.weight > MAX_PLAUSIBLE_KG || !s.reps || s.reps <= 0) return;
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

  // History browsing. histOffset 0 = this week (editable); 1..maxBack = that many
  // sessions back (read-only). Swipe LEFT / ↺ steps back, swipe RIGHT comes forward.
  const prev = history?.[0]?.perf; // most recent — drives the per-set "last time" hints
  const maxBack = Math.min(history?.length ?? 0, MAX_BACK);
  const [histOffset, setHistOffset] = useState(0);
  const off = Math.min(histOffset, maxBack);
  const shown = off > 0 ? history?.[off - 1] : undefined;
  const backLabel = off === 1 ? "Last time" : `${off} sessions back`;
  const cycleBack = () => setHistOffset((o) => (maxBack === 0 ? 0 : o >= maxBack ? 0 : o + 1));

  // Whole-card horizontal swipe. Native (non-passive) listeners so a horizontal drag
  // can preventDefault — that stops page scroll AND lets the swipe start over a field
  // or button: on the first clearly-horizontal move we blur any focused input (so
  // swiping across a weight box never pops the keyboard) and own the gesture. A
  // vertical drag is left alone for normal scrolling.
  const cardRef = useRef<HTMLElement | null>(null);
  const swipedRef = useRef(false); // a swipe just happened → swallow the trailing click
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    let dir: "?" | "h" | "v" = "?";
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        dir = "v";
        return;
      }
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      dir = "?";
      swipedRef.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (dir === "v") return;
      const dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (dir === "?") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // too small to tell yet
        dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? "h" : "v";
        if (dir === "h") (document.activeElement as HTMLElement | null)?.blur?.();
      }
      if (dir === "h") {
        e.preventDefault();
        swipedRef.current = true;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (dir !== "h") {
        dir = "?";
        return;
      }
      const dx = e.changedTouches[0].clientX - sx;
      dir = "?";
      if (Math.abs(dx) < 45) return; // too short to count as a swipe
      const m = Math.min(history?.length ?? 0, MAX_BACK);
      setHistOffset((o) => (dx < 0 ? Math.min(o + 1, m) : Math.max(o - 1, 0)));
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [history?.length]);

  const patchSet = (i: number, patch: Partial<SetEntry>) => {
    const sets = exercise.sets.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...exercise, sets });
    // A bare {done:true} patch = the set badge was tapped — the ONLY way a set gets
    // marked done (value edits deliberately don't, and since 1.56.0 finish() records
    // numbers only for done sets) — that's the "set finished" signal.
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
    <section
      ref={cardRef}
      className={`exercise-card ${isActive ? "active" : ""}`}
      onClickCapture={(e) => {
        // A finished swipe can leave a stray click on whatever was under the finger
        // (a set badge, a stepper) — swallow exactly that one.
        if (swipedRef.current) {
          e.stopPropagation();
          e.preventDefault();
          swipedRef.current = false;
        }
      }}
    >
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
            className={`hbtn ${off > 0 ? "has-note" : ""}`}
            aria-label="previous sessions"
            title="Previous sessions (or swipe ←)"
            onClick={cycleBack}
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

      {isActive && off === 0 && nextSetIdx >= 0 && (
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

      {off > 0 && shown ? (
        <div className="prev-panel lastweek" aria-readonly="true">
          <div className="lw-ribbon">
            <span className="lw-tag">{backLabel}</span>
            <span className="lw-date">
              {niceDate(shown.date)} · {daysAgoLabel(shown.date)}
            </span>
            {maxBack > 1 && <span className="lw-count num">{off}/{maxBack}</span>}
            <span className="lw-lock">🔒 read-only</span>
          </div>
          {shown.perf.sets.length ? (
            <div className="prev-rows">
              {shown.perf.sets.map((s, i) => {
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
              {shown.perf.note && <p className="lw-note">“{shown.perf.note}”</p>}
            </div>
          ) : (
            <p className="muted tiny">No sets logged for this exercise that session.</p>
          )}
          <button className="mini prev-back" onClick={() => setHistOffset(0)}>
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
              prevNote={prev?.sets[i]?.note ?? null}
              prevReps={prev?.sets[i]?.reps ?? null}
              onChange={(p) => patchSet(i, p)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
