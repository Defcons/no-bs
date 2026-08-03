// The in-progress gym session. Kept in React state and mirrored to IndexedDB on
// every change so a phone refresh / accidental close mid-workout loses nothing.
import { useCallback, useEffect, useRef, useState } from "react";
import { db, getSetting, setSetting, type StoredWorkout } from "../db";
import type { DayTemplate, ExercisePerf, SetEntry, WorkoutBreak } from "../types";
import { uid } from "./uid";
import { resolveExercise } from "./exercises";
import { mmss } from "./format";

export type Draft = {
  startedAt: number; // epoch ms (session start, for the date)
  date: string; // ISO datetime
  dayName: string;
  templateId?: number;
  exercises: ExercisePerf[];
  note?: string;
  restEndsAt?: number; // epoch ms; running rest timer survives reload
  restStartedAt?: number; // epoch ms the current break began (to record its actual length)
  breaks?: WorkoutBreak[]; // rest periods taken this session (banked as each break ends)
  custom?: boolean; // "Alternative" free-form session (editable name/exercises)
  trackGps?: boolean; // record a GPS route for this (cardio) session
  editId?: number; // when set, finishing UPDATES this existing workout (History edit)
  // Full workout timer: pure WALL-CLOCK since it started (user decision 2026-07-08 —
  // no pause/reset/idle-cap). wRunning = "has started" (Start button / first edit),
  // wSegStart = the start epoch. wAccumMs is only used as the FIXED recorded
  // duration when editing a past workout (wRunning stays false there).
  wRunning: boolean;
  wAccumMs: number;
  wSegStart: number;
  // Separate stopwatch (starts stopped).
  swRunning: boolean;
  swAccumMs: number; // ms banked before the current running segment
  swSegStart: number; // epoch ms the current running segment started (if swRunning)
  // Mood 1-10.
  moodBefore?: number;
  moodAfter?: number;
  // Epoch ms of the last real activity (a set edited/marked done, a break started).
  // An AUTO-end (left the gym / HR strap off) logs duration up to THIS, not "now" —
  // so the walk to the locker room + drive home isn't counted as workout time.
  lastActivityAt?: number;
};

const DRAFT_KEY = "activeDraft";

function isoNow(): string {
  return new Date().toISOString();
}

function swElapsedMs(d: Draft): number {
  return d.swAccumMs + (d.swRunning ? Date.now() - d.swSegStart : 0);
}

// Bank the currently-running break (if any) as a WorkoutBreak record. The rest is
// capped at its planned length (restEndsAt) so a late auto-dismiss or a finish taken
// mid-break can't inflate it; an early skip records the actual short rest. Returns
// null when no break is running (restStartedAt unset) or the rest rounds to 0s.
export function closeCurrentBreak(d: Pick<Draft, "restStartedAt" | "restEndsAt" | "breaks">): WorkoutBreak | null {
  if (d.restStartedAt == null) return null;
  const end = d.restEndsAt != null ? Math.min(Date.now(), d.restEndsAt) : Date.now();
  const sec = Math.round((end - d.restStartedAt) / 1000);
  if (sec <= 0) return null;
  return { at: d.restStartedAt, sec };
}

// Marker prefix for the auto-added interval line, so re-finishing/editing a session
// never appends a second copy.
export const INTERVAL_NOTE_PREFIX = "⏱ Intervals:";

// A one-line interval breakdown from the recorded breaks — the rests split the
// session into work efforts (start→1st break, between breaks, last break→end).
// Returns null unless there are ≥2 rests AND ≥2 work efforts, so it only fires on
// genuine interval/cardio sessions. `endMs` is the session end (start + duration).
export function intervalSummary(startedAt: number, endMs: number, breaks: WorkoutBreak[] | undefined): string | null {
  if (!breaks || breaks.length < 2) return null;
  const sorted = [...breaks].sort((a, b) => a.at - b.at);
  const work: number[] = [];
  let cursor = startedAt;
  for (const b of sorted) {
    const w = Math.round((b.at - cursor) / 1000);
    if (w > 0) work.push(w);
    cursor = b.at + b.sec * 1000;
  }
  const tail = Math.round((endMs - cursor) / 1000);
  if (tail > 0) work.push(tail);
  if (work.length < 2) return null;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, c) => a + c, 0) / xs.length);
  return `${INTERVAL_NOTE_PREFIX} ${work.length} × avg work ${mmss(avg(work))} / rest ${mmss(avg(sorted.map((b) => b.sec)))}`;
}
// Workout time: banked ms + the current running segment. Paused/not-started/edit
// drafts show the banked total (wAccumMs); a running one adds the live segment.
// Standard stopwatch math — same shape as swElapsedMs. Exported so PipView ticks
// from the exact same math as the in-app header.
export function wElapsedMs(d: Pick<Draft, "wAccumMs" | "wRunning" | "wSegStart">): number {
  return d.wAccumMs + (d.wRunning ? Date.now() - d.wSegStart : 0);
}

// Build fresh exercises for a day, pre-filling each set with last week's number
// for that exercise. `history` is this day-type's past sessions, newest first;
// if the most recent session left an exercise empty, we walk back to the most
// recent session that actually logged a weight for it.
function buildExercises(tpl: DayTemplate, history: StoredWorkout[]): ExercisePerf[] {
  return tpl.exercises.map((e) => {
    // Most recent past sets (with any weight) for this exercise (matched by
    // resolved catalog id so name/spelling variants still line up).
    const eid = resolveExercise(e.name, e.exerciseId).id;
    let prevSets: SetEntry[] | undefined;
    for (const w of history) {
      const p = w.exercises.find((x) => resolveExercise(x.name, x.exerciseId).id === eid);
      if (p && p.sets.some((s) => s.weight != null)) {
        prevSets = p.sets;
        break;
      }
    }
    const weighted = prevSets?.filter((s) => s.weight != null).map((s) => s.weight as number) ?? [];
    const lastKnown = weighted.at(-1) ?? null;
    const nSets = e.scheme.sets ?? 3;
    const defReps = typeof e.scheme.reps === "number" ? e.scheme.reps : null;
    // If last session logged MORE sets than the scheme's default, keep the heaviest
    // N but IN THE ORDER THEY WERE PERFORMED — a 70-80-90-100 ramp must seed
    // 80-90-100, not 100-90-80. Otherwise carry each set's weight across position.
    const seed: (number | null)[] =
      weighted.length > nSets
        ? weighted
            .map((w, i) => ({ w, i }))
            .sort((a, b) => b.w - a.w)
            .slice(0, nSets)
            .sort((a, b) => a.i - b.i)
            .map((x) => x.w)
        : Array.from({ length: nSets }, (_, i) => prevSets?.[i]?.weight ?? lastKnown);
    const sets: SetEntry[] = seed.map((w) => ({ id: uid(), weight: w ?? lastKnown, reps: defReps }));
    return { id: uid(), name: e.name, exerciseId: e.exerciseId, scheme: e.scheme, step: e.step, sets };
  });
}

export function useActiveWorkout() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [elapsed, setElapsed] = useState(0); // full workout time (auto)
  const [swElapsed, setSwElapsed] = useState(0); // separate stopwatch
  const saveTimer = useRef<number | undefined>(undefined);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  // Load any persisted draft on mount (migrate pre-stopwatch drafts).
  useEffect(() => {
    getSetting<Draft | null>(DRAFT_KEY, null).then((d) => {
      if (d && d.swAccumMs === undefined) {
        d.swRunning = false;
        d.swAccumMs = 0;
        d.swSegStart = Date.now();
      }
      if (d && d.wAccumMs === undefined) {
        d.wRunning = true;
        d.wAccumMs = 0;
        d.wSegStart = d.startedAt;
      }
      setDraft(d);
      setLoaded(true);
    });
  }, []);

  // Persist immediately when backgrounded/closed (the debounce could otherwise lose
  // the last edit if the OS kills the app).
  useEffect(() => {
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      setSetting(DRAFT_KEY, draftRef.current);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  // Tick both timers once per second: the full workout time (always running) and
  // the separate controllable stopwatch.
  useEffect(() => {
    if (!draft) return;
    const tick = () => {
      setElapsed(Math.floor(wElapsedMs(draft) / 1000));
      setSwElapsed(Math.floor(swElapsedMs(draft) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [draft?.wRunning, draft?.wSegStart, draft?.wAccumMs, draft?.swRunning, draft?.swSegStart, draft?.swAccumMs]);

  // Debounced persistence of the draft.
  const persist = useCallback((d: Draft | null) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSetting(DRAFT_KEY, d);
    }, 200);
  }, []);

  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      setDraft((cur) => {
        if (!cur) return cur;
        const next = fn(cur);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const start = useCallback(async (tpl: DayTemplate) => {
    const history = (await db.workouts.where("dayName").equals(tpl.name).toArray()).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    const now = Date.now();
    const d: Draft = {
      startedAt: now,
      date: isoNow(),
      dayName: tpl.name,
      templateId: tpl.id,
      exercises: buildExercises(tpl, history),
      wRunning: false, // starts on Start button or first weight/rep edit
      wAccumMs: 0,
      wSegStart: now,
      swRunning: false,
      swAccumMs: 0,
      swSegStart: now,
      lastActivityAt: now,
    };
    setDraft(d);
    setSetting(DRAFT_KEY, d);
  }, []);

  // Load an existing (past) workout into the editor. Finishing updates it in place.
  const beginEdit = useCallback((w: StoredWorkout) => {
    const now = Date.now();
    const d: Draft = {
      startedAt: new Date(w.date).getTime() || now,
      date: w.date,
      dayName: w.dayName,
      templateId: w.templateId,
      editId: w.id,
      custom: true, // fully editable: rename/add/remove
      exercises: w.exercises.map((e) => ({
        id: uid(),
        name: e.name,
        exerciseId: e.exerciseId,
        scheme: e.scheme,
        note: e.note,
        skipped: e.skipped,
        sets: e.sets.map((s) => ({ ...s, id: uid() })),
      })),
      note: w.note,
      moodBefore: w.moodBefore,
      moodAfter: w.moodAfter,
      breaks: w.breaks, // preserve recorded breaks across a History edit
      wRunning: false,
      wAccumMs: (w.durationSec ?? 0) * 1000, // keep the recorded duration editable
      wSegStart: now,
      swRunning: false,
      swAccumMs: 0,
      swSegStart: now,
      lastActivityAt: now,
    };
    setDraft(d);
    setSetting(DRAFT_KEY, d);
  }, []);

  // Free-form "Alternative" session: editable title + you add your own exercises.
  const startCustom = useCallback((label = "Alternative") => {
    const now = Date.now();
    const d: Draft = {
      startedAt: now,
      date: isoNow(),
      dayName: label,
      exercises: [],
      custom: true,
      wRunning: false,
      wAccumMs: 0,
      wSegStart: now,
      swRunning: false,
      swAccumMs: 0,
      swSegStart: now,
      lastActivityAt: now,
    };
    setDraft(d);
    setSetting(DRAFT_KEY, d);
  }, []);

  // Idempotent: start the workout timer if it isn't already running (called on
  // the Start button / first weight-rep edit). From then on it's pure wall-clock —
  // no pause/reset. Editing a past workout must NOT restart the clock (its
  // recorded duration lives in wAccumMs and is kept as-is).
  // Idempotent auto-start on the Start button / first weight-rep edit. Skips a
  // timer that's already running, an edit draft, AND one the user has manually
  // paused (wAccumMs > 0 means it ran and was banked) — an explicit pause sticks
  // until they tap to resume, rather than a set edit silently restarting it.
  const startWorkoutTimer = useCallback(
    () =>
      update((d) =>
        d.wRunning || d.editId != null || d.wAccumMs > 0 ? d : { ...d, wRunning: true, wSegStart: Date.now() },
      ),
    [update],
  );

  // Tap the workout timer to pause/resume it. Pausing banks the running segment
  // into wAccumMs; resuming (or a first tap before any set is logged) starts a new
  // segment. No-op while editing a past workout (its duration is fixed in wAccumMs).
  const toggleWorkoutTimer = useCallback(
    () =>
      update((d) =>
        d.editId != null
          ? d
          : d.wRunning
            ? { ...d, wRunning: false, wAccumMs: d.wAccumMs + (Date.now() - d.wSegStart) }
            : { ...d, wRunning: true, wSegStart: Date.now() },
      ),
    [update],
  );

  // Stopwatch controls.
  const toggleStopwatch = useCallback(
    () =>
      update((d) =>
        d.swRunning
          ? { ...d, swRunning: false, swAccumMs: d.swAccumMs + (Date.now() - d.swSegStart) }
          : { ...d, swRunning: true, swSegStart: Date.now() },
      ),
    [update],
  );
  const resetStopwatch = useCallback(
    () => update((d) => ({ ...d, swAccumMs: 0, swSegStart: Date.now() })),
    [update],
  );

  // Reorder exercises for THIS session only (template order is untouched).
  const moveExercise = useCallback(
    (i: number, dir: -1 | 1) =>
      update((d) => {
        const j = i + dir;
        if (j < 0 || j >= d.exercises.length) return d;
        const ex = [...d.exercises];
        [ex[i], ex[j]] = [ex[j], ex[i]];
        return { ...d, exercises: ex };
      }),
    [update],
  );

  const cancel = useCallback(() => {
    // Kill any in-flight debounced persist — a stale timer firing after the
    // null-write would resurrect the draft as a ghost in-progress workout.
    window.clearTimeout(saveTimer.current);
    setDraft(null);
    setSetting(DRAFT_KEY, null);
  }, []);

  // Persist the finished session and clear the draft. HR stats + extra fields
  // (e.g. a recorded GPS track) optional.
  const finish = useCallback(
    async (hr?: { avg?: number; max?: number }, extra?: Partial<StoredWorkout>, opts?: { endedAt?: number }) => {
      if (!draft) return;
      window.clearTimeout(saveTimer.current); // same ghost-draft guard as cancel()
      // Manual finish → wall-clock. Auto-end → up to the last logged set (opts.endedAt),
      // clamped so it can never go negative or below a couple of minutes.
      const durationSec =
        opts?.endedAt != null
          ? Math.max(60, Math.floor((opts.endedAt - draft.startedAt) / 1000))
          : Math.floor(wElapsedMs(draft) / 1000);
      // Bank a break still running at finish, then keep the session's breaks (if any).
      const lastBreak = closeCurrentBreak(draft);
      const breaks = lastBreak ? [...(draft.breaks ?? []), lastBreak] : draft.breaks;
      // Interval/cardio sessions (custom, ≥2 rests) get a one-line interval breakdown
      // auto-appended to the note — append-only + dedup-guarded, so a History edit or
      // re-finish never duplicates it, and strength (template) sessions never get it
      // even when they have many per-set breaks.
      const ivLine = draft.custom ? intervalSummary(draft.startedAt, draft.startedAt + durationSec * 1000, breaks) : null;
      const note =
        ivLine && !(draft.note ?? "").includes(INTERVAL_NOTE_PREFIX)
          ? `${draft.note ? draft.note + "\n" : ""}${ivLine}`
          : draft.note;
      const row: StoredWorkout = {
        date: draft.date,
        dayName: draft.dayName,
        templateId: draft.templateId,
        // Custom sessions: keep any named exercise (a run may have no weights).
        // Template sessions: keep an exercise if ANY set was actually logged —
        // weight OR reps OR a done/note flag (bodyweight moves like Crunches log
        // reps only, no weight, and must not be dropped) — or it has a note.
        exercises: draft.exercises.filter((ex) =>
          draft.custom
            ? ex.name.trim() !== ""
            : (ex.sets.some((s) => s.weight != null || s.reps != null || s.done || s.note) || ex.note) &&
              // An alternative added mid-session must have a name to be kept.
              (!ex.added || ex.name.trim() !== ""),
        ),
        note,
        durationSec,
        avgHr: hr?.avg,
        maxHr: hr?.max,
        moodBefore: draft.moodBefore,
        moodAfter: draft.moodAfter,
        breaks,
        source: "app",
        // Flag free-form Alternative sessions so stats can optionally exclude them
        // from the weekly count (undefined for template sessions → stays clean).
        custom: draft.custom || undefined,
        // Alternative sessions sync too — the script auto-creates a named block.
        synced: undefined,
        ...extra,
      };
      const editing = draft.editId != null;
      if (editing) {
        // Update the existing workout in place; keep its original date/source/synced.
        await db.workouts.update(draft.editId!, {
          dayName: row.dayName,
          exercises: row.exercises,
          note: row.note,
          moodBefore: row.moodBefore,
          moodAfter: row.moodAfter,
          breaks: row.breaks,
          durationSec: row.durationSec,
        });
      } else {
        await db.workouts.add(row);
      }
      setDraft(null);
      await setSetting(DRAFT_KEY, null);
      return { ...row, custom: draft.custom, edited: editing };
    },
    [draft],
  );

  return {
    draft,
    loaded,
    elapsed,
    swElapsed,
    start,
    startCustom,
    beginEdit,
    cancel,
    finish,
    update,
    startWorkoutTimer,
    toggleWorkoutTimer,
    toggleStopwatch,
    resetStopwatch,
    moveExercise,
  };
}
