// Dev-only: parse the full sheet history fixture and print a sanity summary
// so we can eyeball the parser against known PRs. Run: npx tsx scripts/validate.ts
import fs from "node:fs";
import { parseWorkbook } from "../src/lib/sheet";
import type { Workout } from "../src/types";

const all = JSON.parse(fs.readFileSync("dev-fixtures/gym-all.json", "utf8")) as Record<string, string>;
const workouts: Workout[] = parseWorkbook(all);

console.log(`Parsed ${workouts.length} workouts, ${workouts[0]?.date} .. ${workouts.at(-1)?.date}`);
const byDay = new Map<string, number>();
for (const w of workouts) byDay.set(w.dayName, (byDay.get(w.dayName) ?? 0) + 1);
console.log("Day types:", [...byDay.entries()].map(([k, v]) => `${k}(${v})`).join(", "));

const epley = (w: number, r: number) => w * (1 + r / 30);

// PR scan for signature lifts (match by keyword across NO/EN naming).
const lifts: Record<string, RegExp> = {
  Bench: /bench|benkpress/i,
  Squat: /squat|knebøy/i,
  Deadlift: /deadlift|mark/i,
  "Military/OHP": /military|shoulderpress|militarypress/i,
};

for (const [label, re] of Object.entries(lifts)) {
  let maxW = { w: 0, reps: 0, date: "", raw: "" };
  let max1rm = { est: 0, w: 0, reps: 0, date: "", raw: "" };
  for (const wo of workouts) {
    for (const ex of wo.exercises) {
      if (!re.test(ex.name)) continue;
      const reps = ex.scheme.reps;
      for (const s of ex.sets) {
        if (s.weight == null) continue;
        const r = s.reps ?? (typeof reps === "number" ? reps : 0);
        if (s.weight > maxW.w) maxW = { w: s.weight, reps: r, date: wo.date, raw: s.raw ?? "" };
        if (r > 0) {
          const e = epley(s.weight, r);
          if (e > max1rm.est) max1rm = { est: e, w: s.weight, reps: r, date: wo.date, raw: s.raw ?? "" };
        }
      }
    }
  }
  console.log(
    `\n${label}:` +
      `\n  max weight : ${maxW.w}kg x${maxW.reps} on ${maxW.date} (raw "${maxW.raw}")` +
      `\n  best e1RM  : ${max1rm.est.toFixed(1)}kg  (${max1rm.w}kg x${max1rm.reps} on ${max1rm.date})`,
  );
}

// Surface cells that produced a set with no numeric weight (text/odd) for review.
const weird: string[] = [];
for (const wo of workouts)
  for (const ex of wo.exercises)
    for (const s of ex.sets)
      if (s.weight == null && s.raw && weird.length < 25) weird.push(`${wo.date} ${ex.name}: "${s.raw}"`);
console.log(`\nSample of ${weird.length} non-numeric set tokens (for review):`);
weird.forEach((x) => console.log("  " + x));
