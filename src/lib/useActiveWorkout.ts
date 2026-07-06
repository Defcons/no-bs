// The in-progress gym session. Kept in React state and mirrored to IndexedDB on
// every change so a phone refresh / accidental close mid-workout loses nothing.
import { useCallback, useEffect, useRef, useState } from "react";
import { db, getSetting, setSetting, type StoredWorkout } from "../db";
import type { DayTemplate, ExercisePerf, SetEntry } from "../types";
import { uid } from "./uid";

export type Draft = {
  startedAt: number; // epoch ms (session start, for the date)
  date: string; // ISO datetime
  dayName: string;
  templateId?: number;
  exercises: ExercisePerf[];
  note?: string;
  restEndsAt?: number; // epoch ms; running rest timer survives reload
  custom?: boolean; // "Alternative" free-form session (editable name/exercises)
  trackGps?: boolean; // record a GPS route for this (cardio) session
  editId?: number; // when set, finishing UPDATES this existing workout (History edit)
  // Full workout timer (auto-runs, but pausable/resettable).
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
};

const DRAFT_KEY = "activeDraft";

function isoNow(): string {
  return new Date().toISOString();
}

function swElapsedMs(d: Draft): number {
  return d.swAccumMs + (d.swRunning ? Date.now() - d.swSegStart : 0);
}
function wElapsedMs(d: Draft): number {
  return d.wAccumMs + (d.wRunning ? Date.now() - d.wSegStart : 0);
}

// Build fresh exercises for a day, pre-filling each set with last week's number
// for that exercise. `history` is this day-type's past sessions, newest first;
// if the most recent session left an exercise empty, we walk back to the most
// recent session that actually logged a weight for it.
function buildExercises(tpl: DayTemplate, history: StoredWorkout[]): ExercisePerf[] {
  return tpl.exercises.map((e) => {
    // Most recent past sets (with any weight) for this exercise.
    let prevSets: SetEntry[] | undefined;
    for (const w of history) {
      const p = w.exercises.find((x) => x.name === e.name);
      if (p && p.sets.some((s) => s.weight != null)) {
        prevSets = p.sets;
        break;
      }
    }
    const weighted = prevSets?.filter((s) => s.weight != null).map((s) => s.weight as number) ?? [];
    const lastKnown = weighted.at(-1) ?? null;
    const nSets = e.scheme.sets ?? 3;
    const defReps = typeof e.scheme.reps === "number" ? e.scheme.reps : null;
    // If last session logged MORE sets than the scheme's default, seed with the
    // heaviest N (descending); otherwise carry each set's weight across position.
    const seed: (number | null)[] =
      weighted.length > nSets
        ? [...weighted].sort((a, b) => b - a).slice(0, nSets)
        : Array.from({ length: nSets }, (_, i) => prevSets?.[i]?.weight ?? lastKnown);
    const sets: SetEntry[] = seed.map((w) => ({ id: uid(), weight: w ?? lastKnown, reps: defReps }));
    return { id: uid(), name: e.name, scheme: e.scheme, sets };
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

  // A background gap longer than this isn't counted as workout time (a forgotten
  // session left running overnight shouldn't write a multi-hour duration).
  const IDLE_CAP_MS = 30 * 60 * 1000;

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
        d.wAccumMs = Math.max(0, Date.now() - d.startedAt);
        d.wSegStart = Date.now();
      }
      // Killed-and-reopened after a long idle gap: don't count the closed time.
      if (d && d.wRunning && Date.now() - d.wSegStart > IDLE_CAP_MS) d.wSegStart = Date.now();
      setDraft(d);
      setLoaded(true);
    });
  }, []);

  // Persist immediately when backgrounded/closed (the debounce could otherwise lose
  // the last edit if the OS kills the app), and drop long idle gaps from the timer.
  useEffect(() => {
    let hiddenAt = 0;
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      setSetting(DRAFT_KEY, draftRef.current);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        flush();
      } else if (hiddenAt) {
        const gap = Date.now() - hiddenAt;
        hiddenAt = 0;
        if (gap > IDLE_CAP_MS) {
          setDraft((d) => {
            if (!d || !d.wRunning) return d;
            const next = { ...d, wSegStart: d.wSegStart + gap };
            setSetting(DRAFT_KEY, next);
            return next;
          });
        }
      }
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
        scheme: e.scheme,
        note: e.note,
        skipped: e.skipped,
        sets: e.sets.map((s) => ({ ...s, id: uid() })),
      })),
      note: w.note,
      moodBefore: w.moodBefore,
      moodAfter: w.moodAfter,
      wRunning: false,
      wAccumMs: (w.durationSec ?? 0) * 1000, // keep the recorded duration editable
      wSegStart: now,
      swRunning: false,
      swAccumMs: 0,
      swSegStart: now,
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
    };
    setDraft(d);
    setSetting(DRAFT_KEY, d);
  }, []);

  // Full workout timer controls.
  const toggleWorkoutTimer = useCallback(
    () =>
      update((d) =>
        d.wRunning
          ? { ...d, wRunning: false, wAccumMs: d.wAccumMs + (Date.now() - d.wSegStart) }
          : { ...d, wRunning: true, wSegStart: Date.now() },
      ),
    [update],
  );
  const resetWorkoutTimer = useCallback(
    () => update((d) => ({ ...d, wAccumMs: 0, wSegStart: Date.now() })),
    [update],
  );
  // Idempotent: start the workout timer if it isn't already running (called on
  // the first weight/rep edit).
  const startWorkoutTimer = useCallback(
    () => update((d) => (d.wRunning ? d : { ...d, wRunning: true, wSegStart: Date.now() })),
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
    setDraft(null);
    setSetting(DRAFT_KEY, null);
  }, []);

  // Persist the finished session and clear the draft. HR stats + extra fields
  // (e.g. a recorded GPS track) optional.
  const finish = useCallback(
    async (hr?: { avg?: number; max?: number }, extra?: Partial<StoredWorkout>) => {
      if (!draft) return;
      const durationSec = Math.floor(wElapsedMs(draft) / 1000);
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
            : ex.sets.some((s) => s.weight != null || s.reps != null || s.done || s.note) || ex.note,
        ),
        note: draft.note,
        durationSec,
        avgHr: hr?.avg,
        maxHr: hr?.max,
        moodBefore: draft.moodBefore,
        moodAfter: draft.moodAfter,
        source: "app",
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
    toggleWorkoutTimer,
    resetWorkoutTimer,
    startWorkoutTimer,
    toggleStopwatch,
    resetStopwatch,
    moveExercise,
  };
}
