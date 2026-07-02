// The in-progress gym session. Kept in React state and mirrored to IndexedDB on
// every change so a phone refresh / accidental close mid-workout loses nothing.
import { useCallback, useEffect, useRef, useState } from "react";
import { db, getSetting, lastWorkoutForDay, setSetting, type StoredWorkout } from "../db";
import type { DayTemplate, ExercisePerf, SetEntry } from "../types";

export type Draft = {
  startedAt: number; // epoch ms
  date: string; // ISO datetime
  dayName: string;
  templateId?: number;
  exercises: ExercisePerf[];
  note?: string;
  restEndsAt?: number; // epoch ms; running rest timer survives reload
};

const DRAFT_KEY = "activeDraft";

function isoNow(): string {
  return new Date().toISOString();
}

// Build fresh exercises for a day, pre-filling weight from last session and
// reps from each exercise's scheme, so the user usually just confirms/nudges.
function buildExercises(tpl: DayTemplate, last?: StoredWorkout): ExercisePerf[] {
  return tpl.exercises.map((e) => {
    const prev = last?.exercises.find((p) => p.name === e.name);
    const nSets = e.scheme.sets ?? 3;
    const defReps = typeof e.scheme.reps === "number" ? e.scheme.reps : null;
    const sets: SetEntry[] = Array.from({ length: nSets }, (_, i) => ({
      weight: prev?.sets[i]?.weight ?? prev?.sets.at(-1)?.weight ?? null,
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

  // Load any persisted draft on mount.
  useEffect(() => {
    getSetting<Draft | null>(DRAFT_KEY, null).then((d) => {
      setDraft(d);
      setLoaded(true);
    });
  }, []);

  // Tick the total workout timer once per second while a session is active.
  useEffect(() => {
    if (!draft) return;
    const tick = () => setElapsed(Math.floor((Date.now() - draft.startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [draft?.startedAt]);

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
    const last = await lastWorkoutForDay(tpl.name);
    const d: Draft = {
      startedAt: Date.now(),
      date: isoNow(),
      dayName: tpl.name,
      templateId: tpl.id,
      exercises: buildExercises(tpl, last),
    };
    setDraft(d);
    setSetting(DRAFT_KEY, d);
  }, []);

  const cancel = useCallback(() => {
    setDraft(null);
    setSetting(DRAFT_KEY, null);
  }, []);

  // Persist the finished session and clear the draft. HR stats optional.
  const finish = useCallback(
    async (hr?: { avg?: number; max?: number }) => {
      if (!draft) return;
      const durationSec = Math.floor((Date.now() - draft.startedAt) / 1000);
      const row: StoredWorkout = {
        date: draft.date,
        dayName: draft.dayName,
        templateId: draft.templateId,
        exercises: draft.exercises.filter((ex) => ex.sets.some((s) => s.weight != null) || ex.note),
        note: draft.note,
        durationSec,
        avgHr: hr?.avg,
        maxHr: hr?.max,
        source: "app",
      };
      await db.workouts.add(row);
      setDraft(null);
      await setSetting(DRAFT_KEY, null);
      return row;
    },
    [draft],
  );

  return { draft, loaded, elapsed, start, cancel, finish, update };
}
