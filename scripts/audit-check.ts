// Regression checks for the 2026-08-19 audit-fix batches (1.58.0): sessionKey
// sheet-shape normalization, epley r=1, 53-week streaks, the GPS spike gate, the
// resolver CANON re-probe, cardio plausibility guards, and localDay (H1) dating.
// Run anytime: npx tsx scripts/audit-check.ts
import { sessionKey, sessionKeys } from "../src/lib/sheetSync";
import { epley, liftRecords, summarize, weekNumbersForLast } from "../src/lib/stats";
import { resolveExercise } from "../src/lib/exercises";
import { computeRun } from "../src/lib/runStats";
import { localDay } from "../src/lib/format";
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
  // The same session as the sheet round-trip reconstructs it: only content
  // survives, and the sheet header carries the LOCAL bare day.
  const sheetCopy = {
    dayName: "Push",
    date: localDay(local.date),
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
  const swimSheet = { dayName: "Alternative", date: localDay(swim.date), durationSec: 1800, exercises: [] };
  check("cardio local == sheet copy", sessionKey(swim) === sessionKey(swimSheet));
}

console.log("— localDay + legacy dual keys (H1) —");
{
  check("bare date passes through", localDay("2026-08-19") === "2026-08-19");
  check("garbage falls back to slice", localDay("not-a-dateT!!") === "not-a-date");
  // A full ISO resolves to the LOCAL calendar day of that instant.
  const iso = "2026-08-19T23:30:00.000Z";
  const d = new Date(iso);
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  check("full ISO → local day", localDay(iso) === expected);
  // sessionKeys invariants (hold in EVERY timezone): canonical key first; the
  // legacy UTC-day key is always answered-for (either it IS the canonical one, or
  // it rides along as the second key so pre-1.58 sheet columns still dedup).
  const w = { dayName: "Push", date: iso, durationSec: 3600, exercises: [{ name: "Bench", sets: [{ weight: 80, reps: 8 }] }] };
  const keys = sessionKeys(w);
  check("canonical key first", keys[0] === sessionKey(w));
  check("legacy UTC key covered", keys.some((k) => k.includes("@@2026-08-19@@")));
  check("dual exactly when days differ", (keys.length === 2) === (localDay(iso) !== "2026-08-19"));
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
