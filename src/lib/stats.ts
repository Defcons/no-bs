// History analytics: PRs, records and summary stats over stored workouts.
import type { StoredWorkout } from "../db";
import { type ExerciseUnit, type MuscleGroup, resolveExercise } from "./exercises";

export const epley = (weight: number, reps: number): number => weight * (1 + reps / 30);

// Guard against sheet typos like "40-4040" producing absurd PRs.
const MAX_PLAUSIBLE_KG = 500;
const plausible = (w: number | null): w is number => w != null && w > 0 && w <= MAX_PLAUSIBLE_KG;

// Exercise identity + classification (canonName / canonKey / muscleGroup /
// MUSCLE_ORDER) moved to lib/exercises.ts and is now catalog-backed via
// resolveExercise(). The old regex layer survives there as the fallback.

// --- Training cadence (for color coding + reminders) ------------------------
export type Cadence = "green" | "orange" | "red";

// How overdue is a workout, given a weekly goal? `cycle` scales the expected
// interval (use the number of day-types for per-day-type coloring).
export function cadenceStatus(daysSince: number, daysPerWeek: number, cycle = 1): Cadence {
  const interval = (7 / Math.max(1, daysPerWeek)) * cycle;
  const ratio = daysSince / interval;
  if (ratio <= 1.15) return "green";
  if (ratio <= 2.2) return "orange";
  return "red";
}

// Should we train today to stay on pace? (Behind the per-workout interval, and
// not already trained today.)
export function trainingDue(daysSinceLast: number, daysPerWeek: number): boolean {
  return daysSinceLast >= 7 / Math.max(1, daysPerWeek);
}

export type LiftRecord = {
  name: string;
  key: string; // resolveExercise(...).id — used to pull this lift's progression
  muscle: MuscleGroup; // resolved muscle group (Records "by muscle")
  unit: ExerciseUnit; // decides which "best" metric matters
  standardKey?: string; // links to a strength standard, if any
  count: number; // sets logged
  maxWeight: { weight: number; reps: number; date: string }; // weight (added weight for bodyweight)
  bestE1rm: { est: number; weight: number; reps: number; date: string }; // weight only
  maxReps: { reps: number; weight: number; date: string }; // bodyweight
  maxDuration: { seconds: number; date: string }; // time
};

// A record has meaningful data for its unit (used to filter out empty rows).
export function hasRecord(r: LiftRecord): boolean {
  return r.maxWeight.weight > 0 || r.maxReps.reps > 0 || r.maxDuration.seconds > 0;
}

export function liftRecords(workouts: StoredWorkout[]): LiftRecord[] {
  const map = new Map<string, LiftRecord>();
  for (const w of workouts) {
    for (const ex of w.exercises) {
      const resolved = resolveExercise(ex.name, ex.exerciseId); // catalog match → shared id; else regex fallback
      const key = resolved.id;
      const schemeReps = typeof ex.scheme.reps === "number" ? ex.scheme.reps : 0;
      let rec = map.get(key);
      if (!rec) {
        rec = {
          name: resolved.name,
          key,
          muscle: resolved.muscle,
          unit: resolved.unit,
          standardKey: resolved.standardKey,
          count: 0,
          maxWeight: { weight: 0, reps: 0, date: "" },
          bestE1rm: { est: 0, weight: 0, reps: 0, date: "" },
          maxReps: { reps: 0, weight: 0, date: "" },
          maxDuration: { seconds: 0, date: "" },
        };
        map.set(key, rec);
      }
      for (const set of ex.sets) {
        if (resolved.unit === "time") {
          const s = set.seconds ?? 0;
          if (s > 0) {
            rec.count++;
            if (s > rec.maxDuration.seconds) rec.maxDuration = { seconds: s, date: w.date };
          }
          continue;
        }
        const reps = set.reps ?? schemeReps;
        if (resolved.unit === "bodyweight") {
          if (reps > 0 || plausible(set.weight)) rec.count++;
          if (reps > 0 && reps > rec.maxReps.reps) rec.maxReps = { reps, weight: set.weight ?? 0, date: w.date };
          if (plausible(set.weight) && set.weight > rec.maxWeight.weight) rec.maxWeight = { weight: set.weight, reps, date: w.date };
          continue;
        }
        // weight (default)
        if (!plausible(set.weight)) continue;
        rec.count++;
        if (set.weight > rec.maxWeight.weight) rec.maxWeight = { weight: set.weight, reps, date: w.date };
        if (reps > 0) {
          const e = epley(set.weight, reps);
          if (e > rec.bestE1rm.est) rec.bestE1rm = { est: e, weight: set.weight, reps, date: w.date };
        }
      }
    }
  }
  // Most-trained lifts first.
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// Sessions in each of the last `weeks` rolling 7-day windows, oldest→newest
// (rightmost = the last 7 days). For the consistency trend.
export function sessionsPerWeek(workouts: StoredWorkout[], weeks = 12): number[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const counts = new Array<number>(weeks).fill(0);
  for (const w of workouts) {
    const [y, m, d] = w.date.slice(0, 10).split("-").map(Number);
    const t = new Date(y, m - 1, d).getTime();
    const idx = Math.floor((todayMs - t) / (7 * 86400000));
    if (idx >= 0 && idx < weeks) counts[weeks - 1 - idx]++;
  }
  return counts;
}

// Bare ISO week number (1–53) for each of the last `weeks` weeks, oldest→newest —
// aligned 1:1 with sessionsPerWeek's buckets so they label the same bars.
export function weekNumbersForLast(weeks = 12): number[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 7 * 86400000);
    out.push(isoWeekNum(d.toISOString()) % 100);
  }
  return out;
}

export type ProgressPoint = { date: string; e1rm: number; topWeight: number };

// Per-session best (est-1RM + top weight) for one lift, oldest→newest — for the chart.
export function progression(workouts: StoredWorkout[], key: string): ProgressPoint[] {
  const byDay = new Map<string, { e1rm: number; topWeight: number }>();
  for (const w of workouts) {
    const day = w.date.slice(0, 10);
    for (const ex of w.exercises) {
      if (resolveExercise(ex.name, ex.exerciseId).id !== key) continue;
      const schemeReps = typeof ex.scheme.reps === "number" ? ex.scheme.reps : 0;
      for (const set of ex.sets) {
        if (!plausible(set.weight)) continue;
        const reps = set.reps ?? schemeReps;
        const e = reps > 0 ? epley(set.weight, reps) : set.weight;
        const cur = byDay.get(day) ?? { e1rm: 0, topWeight: 0 };
        if (e > cur.e1rm) cur.e1rm = e;
        if (set.weight > cur.topWeight) cur.topWeight = set.weight;
        byDay.set(day, cur);
      }
    }
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({ date, e1rm: v.e1rm, topWeight: v.topWeight }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function workoutVolume(w: StoredWorkout): number {
  let v = 0;
  for (const ex of w.exercises) {
    const schemeReps = typeof ex.scheme.reps === "number" ? ex.scheme.reps : 0;
    for (const set of ex.sets) {
      if (!plausible(set.weight)) continue;
      v += set.weight * (set.reps ?? schemeReps);
    }
  }
  return v;
}

export type Summary = {
  total: number;
  first: string;
  last: string;
  longestBreakDays: number;
  longestBreakBetween: [string, string];
  currentStreakWeeks: number;
  busiestMonth: { month: string; count: number };
  heaviest: { name: string; weight: number; reps: number; date: string };
  bestE1rm: { name: string; est: number; date: string };
};

const dayMs = 86400000;
const monthKey = (iso: string) => iso.slice(0, 7);

export function summarize(workouts: StoredWorkout[]): Summary | null {
  if (workouts.length === 0) return null;
  const ws = [...workouts].sort((a, b) => a.date.localeCompare(b.date));
  const dates = ws.map((w) => w.date.slice(0, 10));

  // Longest break = biggest gap between consecutive session days.
  let longestBreakDays = 0;
  let longestBreakBetween: [string, string] = [dates[0], dates[0]];
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / dayMs);
    if (gap > longestBreakDays) {
      longestBreakDays = gap;
      longestBreakBetween = [dates[i - 1], dates[i]];
    }
  }

  // Current streak = consecutive ISO weeks with >=1 session, counting back from the last.
  const weeks = new Set(ws.map((w) => isoWeek(w.date)));
  let currentStreakWeeks = 0;
  let cursor = isoWeekNum(ws.at(-1)!.date);
  while (weeks.has(weekLabel(cursor))) {
    currentStreakWeeks++;
    cursor = prevWeek(cursor);
  }

  // Busiest month.
  const byMonth = new Map<string, number>();
  for (const w of ws) byMonth.set(monthKey(w.date), (byMonth.get(monthKey(w.date)) ?? 0) + 1);
  let busiestMonth = { month: "", count: 0 };
  for (const [m, c] of byMonth) if (c > busiestMonth.count) busiestMonth = { month: m, count: c };

  // Heaviest single lift + best e1RM across everything.
  const recs = liftRecords(ws);
  let heaviest = { name: "", weight: 0, reps: 0, date: "" };
  let bestE1rm = { name: "", est: 0, date: "" };
  for (const r of recs) {
    if (r.maxWeight.weight > heaviest.weight)
      heaviest = { name: r.name, ...r.maxWeight };
    if (r.bestE1rm.est > bestE1rm.est)
      bestE1rm = { name: r.name, est: r.bestE1rm.est, date: r.bestE1rm.date };
  }

  return {
    total: ws.length,
    first: dates[0],
    last: dates.at(-1)!,
    longestBreakDays,
    longestBreakBetween,
    currentStreakWeeks,
    busiestMonth,
    heaviest,
    bestE1rm,
  };
}

// --- ISO week helpers (year*100 + week) -------------------------------------
function isoWeekNum(iso: string): number {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d.getTime() - firstThursday.getTime()) / dayMs - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() * 100 + week;
}
const weekLabel = (n: number) => String(n);
const isoWeek = (iso: string) => weekLabel(isoWeekNum(iso));
function prevWeek(n: number): number {
  const year = Math.floor(n / 100);
  const week = n % 100;
  if (week > 1) return year * 100 + (week - 1);
  return (year - 1) * 100 + 52; // approx; good enough for a streak counter
}
