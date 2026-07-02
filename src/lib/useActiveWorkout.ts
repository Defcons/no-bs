// The in-progress gym session. Kept in React state and mirrored to IndexedDB on
// every change so a phone refresh / accidental close mid-workout loses nothing.
import { useCallback, useEffect, useRef, useState } from "react";
import { db, getSetting, setSetting, type StoredWorkout } from "../db";
import type { DayTemplate, ExercisePerf, SetEntry } from "../types";

export type Draft = {
  startedAt: number; // epoch ms (session start, for the date)
  date: string; // ISO datetime
  dayName: string;
  templateId?: number;
  exercises: ExercisePerf[];
  note?: string;
  restEndsAt?: number; // epoch ms; running rest timer survives reload
  custom?: boolean; // "Alternative" free-form session (editable name/exercises)
  // Stopwatch (controllable; survives reload).
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
    const lastKnown = prevSets?.filter((s) => s.weight != null).at(-1)?.weight ?? null;
    const nSets = e.scheme.sets ?? 3;
    const defReps = typeof e.scheme.reps === "number" ? e.scheme.reps : null;
    const sets: SetEntry[] = Array.from({ length: nSets }, (_, i) => ({
      weight: prevSets?.[i]?.weight ?? lastKnown,
      reps: defReps,
    }));
    return { name: e.name, scheme: e.scheme, sets };
  });
}

export function useActiveWorkout() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const saveTimer = useRef<number | undefined>(undefined);

  // Load any persisted draft on mount (migrate pre-stopwatch drafts).
  useEffect(() => {
    getSetting<Draft | null>(DRAFT_KEY, null).then((d) => {
      if (d && d.swAccumMs === undefined) {
        d.swRunning = true;
        d.swAccumMs = Math.max(0, Date.now() - d.startedAt);
        d.swSegStart = Date.now();
      }
      setDraft(d);
      setLoaded(true);
    });
  }, []);

  // Tick the stopwatch once per second while running.
  useEffect(() => {
    if (!draft) return;
    const tick = () => setElapsed(Math.floor(swElapsedMs(draft) / 1000));
    tick();
    if (!draft.swRunning) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [draft?.swRunning, draft?.swSegStart, draft?.swAccumMs]);

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
      swRunning: true,
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
      swRunning: true,
      swAccumMs: 0,
      swSegStart: now,
    };
    setDraft(d);
    setSetting(DRAFT_KEY, d);
  }, []);

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

  // Persist the finished session and clear the draft. HR stats optional.
  const finish = useCallback(
    async (hr?: { avg?: number; max?: number }) => {
      if (!draft) return;
      const durationSec = Math.floor(swElapsedMs(draft) / 1000);
      const row: StoredWorkout = {
        date: draft.date,
        dayName: draft.dayName,
        templateId: draft.templateId,
        // Custom sessions: keep any named exercise (a run may have no weights).
        // Template sessions: drop untouched pre-filled exercises.
        exercises: draft.exercises.filter((ex) =>
          draft.custom ? ex.name.trim() !== "" : ex.sets.some((s) => s.weight != null) || ex.note,
        ),
        note: draft.note,
        durationSec,
        avgHr: hr?.avg,
        maxHr: hr?.max,
        moodBefore: draft.moodBefore,
        moodAfter: draft.moodAfter,
        source: "app",
        // Custom sessions have no matching sheet block → don't queue for sync.
        synced: draft.custom ? true : undefined,
      };
      await db.workouts.add(row);
      setDraft(null);
      await setSetting(DRAFT_KEY, null);
      return { ...row, custom: draft.custom };
    },
    [draft],
  );

  return {
    draft,
    loaded,
    elapsed,
    start,
    startCustom,
    cancel,
    finish,
    update,
    toggleStopwatch,
    resetStopwatch,
    moveExercise,
  };
}
