// Running records + two rankings for the Records screen:
//   1. ABSOLUTE pace tiers — fixed pace targets, the same for everyone.
//   2. PERSONAL-BEST medals — each run rated against the user's own fastest.
// A "run" is any saved workout that carries a GPS track (Alternative + Track GPS).
import { computeRun, type RunStats } from "./runStats";
import type { StoredWorkout } from "../db";

export type RunSummary = { date: string; run: RunStats };

// Every GPS-tracked run (newest first), dropping sub-50 m noise.
export function runsFrom(workouts: StoredWorkout[]): RunSummary[] {
  return workouts
    .filter((w) => w.track && w.track.length > 1)
    .map((w) => ({ date: w.date, run: computeRun(w.track) }))
    .filter((r): r is RunSummary => r.run != null && r.run.distanceM > 50)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export type RunPBs = { count: number; furthestM: number; fastestPace: number; longestSec: number; totalM: number };

export function runPBs(runs: RunSummary[]): RunPBs | null {
  if (!runs.length) return null;
  let furthestM = 0;
  let fastestPace = Infinity;
  let longestSec = 0;
  let totalM = 0;
  for (const { run } of runs) {
    furthestM = Math.max(furthestM, run.distanceM);
    longestSec = Math.max(longestSec, run.durationSec);
    totalM += run.distanceM;
    if (run.avgPaceSecPerKm > 0) fastestPace = Math.min(fastestPace, run.avgPaceSecPerKm);
  }
  return { count: runs.length, furthestM, fastestPace: Number.isFinite(fastestPace) ? fastestPace : 0, longestSec, totalM };
}

// Fixed pace tiers, slowest → fastest (sec/km). Rough recreational-runner ladder.
export const PACE_TIERS: { name: string; pace: number }[] = [
  { name: "Casual", pace: 8 * 60 },
  { name: "Beginner", pace: 7 * 60 },
  { name: "Novice", pace: 6 * 60 + 30 },
  { name: "Intermediate", pace: 6 * 60 },
  { name: "Trained", pace: 5 * 60 + 30 },
  { name: "Advanced", pace: 5 * 60 },
  { name: "Elite", pace: 4 * 60 + 30 },
];

// Where a pace sits on the tier ladder: tick %s, the fill %, the reached tier name,
// and the next tier's target pace (null at the top). Faster pace ⇒ further right.
export function paceLadder(bestPace: number): {
  ticks: number[];
  journeyPct: number;
  tier: string;
  nextPace: number | null;
} {
  const slowest = PACE_TIERS[0].pace;
  const fastest = PACE_TIERS[PACE_TIERS.length - 1].pace;
  const pct = (p: number) => Math.max(0, Math.min(100, ((slowest - p) / (slowest - fastest)) * 100));
  let idx = -1;
  for (let i = 0; i < PACE_TIERS.length; i++) if (bestPace > 0 && bestPace <= PACE_TIERS[i].pace) idx = i;
  const next = idx + 1 < PACE_TIERS.length ? PACE_TIERS[idx + 1] : null;
  return {
    ticks: PACE_TIERS.map((t) => pct(t.pace)),
    journeyPct: bestPace > 0 ? pct(bestPace) : 0,
    tier: idx >= 0 ? PACE_TIERS[idx].name : "Below casual",
    nextPace: idx < 0 ? PACE_TIERS[0].pace : next ? next.pace : null,
  };
}

// Rank each run against the user's own fastest pace: gold ≤ +3%, silver ≤ +8%,
// bronze ≤ +15%. The PB run is always gold.
export function paceMedals(runs: RunSummary[], bestPace: number): { gold: number; silver: number; bronze: number } {
  let gold = 0;
  let silver = 0;
  let bronze = 0;
  if (bestPace > 0) {
    for (const { run } of runs) {
      const p = run.avgPaceSecPerKm;
      if (!p) continue;
      if (p <= bestPace * 1.03) gold++;
      else if (p <= bestPace * 1.08) silver++;
      else if (p <= bestPace * 1.15) bronze++;
    }
  }
  return { gold, silver, bronze };
}
