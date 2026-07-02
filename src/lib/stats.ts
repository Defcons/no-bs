// History analytics: PRs, records and summary stats over stored workouts.
import type { StoredWorkout } from "../db";

export const epley = (weight: number, reps: number): number => weight * (1 + reps / 30);

// Guard against sheet typos like "40-4040" producing absurd PRs.
const MAX_PLAUSIBLE_KG = 500;
const plausible = (w: number | null): w is number => w != null && w > 0 && w <= MAX_PLAUSIBLE_KG;

// Group exercise variants under a canonical name so PRs aggregate across years
// (e.g. "Benkpress"/"Bench press" -> "Bench"). Falls back to the raw name.
// Order matters — first match wins. More specific patterns go first.
const CANON: [RegExp, string][] = [
  [/rear.?delt|rear.?fl|back.?fl/i, "Rear delt flyes"], // NOT chest — before flyes/back rules
  [/decline.?press|decline.?bench/i, "Decline press"],
  [/decline.?fl/i, "Decline flyes"], // "Decline flyes" / "Decline-Flyes" / "Decline-flyes"
  [/bench|benkpress/i, "Bench"],
  [/squat|knebøy/i, "Squat"],
  [/deadlift|\bmark/i, "Deadlift"],
  [/military|militarypress/i, "Military press"],
  [/shoulderpress|shoulder press/i, "Shoulder press"],
  [/incline|skråbenk|skråpress/i, "Incline"], // incline bench == skråbenk
  [/legpress|leg press/i, "Legpress"],
  [/pulldown|nedtrekk/i, "Pulldown"],
  [/\bcurl stang|barbell curl/i, "Barbell curl"],
  [/side.?hev|side.?lift|lateral/i, "Lateral raise"],
  [/calves|calf/i, "Calves"],
  [/quad/i, "Quad"],
  [/hamstring/i, "Hamstring"],
  [/shrug/i, "Shrugs"],
];

// Loose key: canonical name, then separator/case-insensitive, so any remaining
// "Decline-Flyes" vs "Decline flyes" variants still merge into one record.
export function canonKey(name: string): string {
  return canonName(name)
    .toLowerCase()
    .replace(/[\s\-_/]+/g, " ")
    .trim();
}

export function canonName(name: string): string {
  for (const [re, c] of CANON) if (re.test(name)) return c;
  return name.trim();
}

// Muscle-group buckets for the Records tab. Heuristic, tuned to the owner's exercises;
// "Other" catches anything unmatched. Arms is checked first so curls/extensions
// don't fall into leg/press buckets.
export const MUSCLE_ORDER = ["Chest", "Back", "Shoulder", "Legs", "Arms", "Core", "Other"];
export function muscleGroup(name: string): string {
  const n = name.toLowerCase();
  if (/extension|curl|tricep|bicep|skull|pushdown|pressdown/.test(n)) return "Arms";
  // Shoulder BEFORE chest so rear-delt/lateral "flyes" don't land in Chest.
  if (/shoulder|military|shrug|delt|\bohp\b|sidehev|sidelift|lateral|face ?pull|rear|back ?fl/.test(n)) return "Shoulder";
  if (/bench|incline|skråbenk|\bfly|decline|chest/.test(n)) return "Chest";
  if (/deadlift|row|pulldown|pull-?up|chin|\blat|korsrygg|nedtrekk|\bback\b|\bmark/.test(n)) return "Back";
  if (/squat|\bleg|calf|calves|quad|hamstring|lunge|utfall|glute|benhev/.test(n)) return "Legs";
  if (/abs|crunch|core|plank|sit-?up|situp/.test(n)) return "Core";
  return "Other";
}

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
  count: number; // sets logged
  maxWeight: { weight: number; reps: number; date: string };
  bestE1rm: { est: number; weight: number; reps: number; date: string };
};

export function liftRecords(workouts: StoredWorkout[]): LiftRecord[] {
  const map = new Map<string, LiftRecord>();
  for (const w of workouts) {
    for (const ex of w.exercises) {
      const name = canonName(ex.name);
      const key = canonKey(ex.name); // loose key merges separator/case variants
      const schemeReps = typeof ex.scheme.reps === "number" ? ex.scheme.reps : 0;
      for (const set of ex.sets) {
        if (!plausible(set.weight)) continue;
        const reps = set.reps ?? schemeReps;
        let rec = map.get(key);
        if (!rec) {
          rec = {
            name,
            count: 0,
            maxWeight: { weight: 0, reps: 0, date: "" },
            bestE1rm: { est: 0, weight: 0, reps: 0, date: "" },
          };
          map.set(key, rec);
        }
        rec.count++;
        if (set.weight > rec.maxWeight.weight)
          rec.maxWeight = { weight: set.weight, reps, date: w.date };
        if (reps > 0) {
          const e = epley(set.weight, reps);
          if (e > rec.bestE1rm.est)
            rec.bestE1rm = { est: e, weight: set.weight, reps, date: w.date };
        }
      }
    }
  }
  // Most-trained lifts first.
  return [...map.values()].sort((a, b) => b.count - a.count);
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
