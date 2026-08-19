// Regression checks for the 2026-08-19 audit-fix batch (1.58.0): sessionKey
// sheet-shape normalization, epley r=1, 53-week streaks, the GPS spike gate, the
// resolver CANON re-probe, and cardio plausibility guards.
// Run anytime: npx tsx scripts/audit-check.ts
import { sessionKey } from "../src/lib/sheetSync";
import { epley, liftRecords, summarize, weekNumbersForLast } from "../src/lib/stats";
import { resolveExercise } from "../src/lib/exercises";
import { computeRun } from "../src/lib/runStats";
import type { StoredWorkout } from "../src/db";

let fails = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS ${name}`);
  else {
    fails++;
    console.error(`  FAIL ${name} ${detail}`);
  }
};

console.log("— sessionKey normalization (H3) —");
{
  // Local post-1.56 row: 3 sets, 1 done, 2 nulled; plus a note-only exercise.
  const local = {
    dayName: "Push",
    date: "2026-08-19T18:00:00.000Z",
    durationSec: 3600,
    exercises: [
      {
        name: "Bench",
        sets: [
          { weight: 80, reps: 8 },
          { weight: null, reps: null },
          { weight: null, reps: null },
        ],
      },
      { name: "OHP", sets: [{ weight: null, reps: null }] }, // note-only, all nulled
    ],
  };
  // The same session as the sheet round-trip reconstructs it: only content survives.
  const sheetCopy = {
    dayName: "Push",
    date: "2026-08-19",
    durationSec: 3600,
    exercises: [{ name: "Bench", sets: [{ weight: 80, reps: 8 }] }],
  };
  check("local == sheet round-trip", sessionKey(local) === sessionKey(sheetCopy), `${sessionKey(local)} vs ${sessionKey(sheetCopy)}`);
  const other = { ...sheetCopy, durationSec: 5400 };
  check("distinct sessions differ", sessionKey(sheetCopy) !== sessionKey(other));
  // Manual-cardio session (time/distance sets are sheet-invisible): 0-exercise signature both ways.
  const swim = {
    dayName: "Alternative",
    date: "2026-08-19T18:00:00.000Z",
    durationSec: 1800,
    exercises: [{ name: "Swimming", sets: [{ weight: null, reps: null }] }], // distance/seconds live on other fields
  };
  const swimSheet = { dayName: "Alternative", date: "2026-08-19", durationSec: 1800, exercises: [] };
  check("cardio local == sheet copy", sessionKey(swim) === sessionKey(swimSheet));
}

console.log("— epley r=1 (audit L) —");
check("epley(200,1) === 200", epley(200, 1) === 200);
check("epley(100,5) unchanged", Math.abs(epley(100, 5) - 116.666) < 0.01, String(epley(100, 5)));

console.log("— 53-week streak (prevWeek via summarize) —");
{
  const w = (date: string): StoredWorkout =>
    ({ date, dayName: "X", exercises: [], source: "app" }) as unknown as StoredWorkout;
  // 2026-12-30 is ISO week 53 of 2026; 2027-01-05 is ISO week 1 of 2027 — consecutive.
  const s = summarize([w("2026-12-30"), w("2027-01-05")]);
  check("streak crosses the 53-week NY", s?.currentStreakWeeks === 2, `got ${s?.currentStreakWeeks}`);
  const s2 = summarize([w("2026-12-21"), w("2026-12-30"), w("2027-01-05")]); // w52+w53+w1
  check("3-week streak intact", s2?.currentStreakWeeks === 3, `got ${s2?.currentStreakWeeks}`);
}

console.log("— computeRun spike gate —");
{
  // Straight-line jog: points every 4 s moving ~11 m (≈2.8 m/s) ≈ 110 m total.
  const t0 = 1700000000000;
  const pts = Array.from({ length: 11 }, (_, i) => ({ t: t0 + i * 4000, lat: 59.9 + i * 0.0001, lng: 10.7 }));
  const clean = computeRun(pts)!.distanceM;
  // Same track with a teleport spike pair injected (0.005° ≈ 550 m out and back).
  const spiked = [...pts.slice(0, 5), { t: t0 + 4 * 4000 + 1000, lat: 59.9 + 0.005, lng: 10.7 }, ...pts.slice(5)];
  const gated = computeRun(spiked)!.distanceM;
  check("spike does not inflate distance", Math.abs(gated - clean) < clean * 0.15, `clean=${clean.toFixed(0)} spiked=${gated.toFixed(0)}`);
  check("clean distance sane", clean > 90 && clean < 130, String(clean));
}

console.log("— resolver re-probe (H6) —");
check("Militarypress → overhead-press", resolveExercise("Militarypress").id === "overhead-press", resolveExercise("Militarypress").id);
check("militarypress alias too", resolveExercise("militarypress").id === "overhead-press");
check("standardKey carried", resolveExercise("Militarypress").standardKey === "ohp");
check("Incline curl keeps legacy fallback", resolveExercise("Incline curl").id === "incline", resolveExercise("Incline curl").id);
check("Skråbenk still incline bench", resolveExercise("Skråbenk").id === "incline-bench-press", resolveExercise("Skråbenk").id);
check("Bench Press still itself", resolveExercise("Bench Press").id === "bench-press");

console.log("— cardio plausibility + duration fold —");
{
  const w = (exs: unknown[]): StoredWorkout =>
    ({ date: "2026-08-01", dayName: "Alt", exercises: exs, source: "app" }) as unknown as StoredWorkout;
  const recs = liftRecords([
    w([
      { name: "Running", scheme: {}, sets: [{ weight: null, reps: null, distanceM: 10000, seconds: 120 }] }, // swapped fields → 12 s/km
      { name: "Cycling", scheme: {}, sets: [{ weight: null, reps: null, seconds: 2700 }] }, // duration-only
    ]),
    w([{ name: "Running", scheme: {}, sets: [{ weight: null, reps: null, distanceM: 5000, seconds: 1800 }] }]), // honest 6:00/km
  ]);
  const run = recs.find((r) => r.key === "running")!;
  const cyc = recs.find((r) => r.key === "cycling")!;
  check("swapped-field pace rejected", Math.round(run.bestPace.secPerKm) === 360, String(run.bestPace.secPerKm));
  check("duration-only cardio earns a record", cyc.maxDuration.seconds === 2700, String(cyc.maxDuration.seconds));
}

console.log("— weekNumbersForLast local-day labels —");
{
  const labels = weekNumbersForLast(12);
  check("12 labels", labels.length === 12);
  check("all in 1..53", labels.every((n) => n >= 1 && n <= 53), labels.join(","));
}

process.exitCode = fails ? 1 : 0;
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
