// Science-based strength standards: 1RM as a multiple of bodyweight, adult male,
// mid-bodyweight (~90 kg) approximation. Sources: StrengthLevel + ExRx (Kilgore)
// consensus. Barbell lifts are high-confidence; machine lifts (pulldown, leg
// press) are rougher and machine-dependent (esp. leg press = 45° sled).
export type Level = "Beginner" | "Novice" | "Intermediate" | "Advanced" | "Elite";
export const LEVELS: Level[] = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"];

type Thresholds = { beginner: number; novice: number; intermediate: number; advanced: number; elite: number };
export type Sex = "male" | "female";
// Allometric reference bodyweight the base ratios are centred on, per sex.
export const REF_BW: Record<Sex, number> = { male: 90, female: 62 };

// The "important" lifts, in display order. `key` matches an exercise's standardKey
// (see lib/exercises.ts); `name` is the label. Ratios (1RM ÷ BW) per sex, from the
// StrengthLevel/ExRx consensus — barbell lifts reliable, machines rough.
export const KEY_LIFTS: { key: string; name: string; male: Thresholds; female: Thresholds; note?: string }[] = [
  { key: "squat", name: "Squat", male: { beginner: 0.75, novice: 1.25, intermediate: 1.5, advanced: 2.25, elite: 2.75 }, female: { beginner: 0.5, novice: 0.75, intermediate: 1.25, advanced: 1.75, elite: 2.25 } },
  { key: "bench", name: "Bench Press", male: { beginner: 0.5, novice: 0.75, intermediate: 1.25, advanced: 1.75, elite: 2.0 }, female: { beginner: 0.25, novice: 0.5, intermediate: 0.75, advanced: 1.0, elite: 1.5 } },
  { key: "deadlift", name: "Deadlift", male: { beginner: 1.0, novice: 1.5, intermediate: 2.0, advanced: 2.5, elite: 3.0 }, female: { beginner: 0.5, novice: 1.0, intermediate: 1.5, advanced: 2.0, elite: 2.5 } },
  { key: "ohp", name: "Overhead Press", male: { beginner: 0.35, novice: 0.55, intermediate: 0.8, advanced: 1.1, elite: 1.4 }, female: { beginner: 0.2, novice: 0.35, intermediate: 0.5, advanced: 0.75, elite: 1.0 } },
  { key: "row", name: "Barbell Row", male: { beginner: 0.5, novice: 0.75, intermediate: 1.0, advanced: 1.5, elite: 1.75 }, female: { beginner: 0.35, novice: 0.5, intermediate: 0.75, advanced: 1.0, elite: 1.25 } },
  { key: "pulldown", name: "Lat Pulldown", male: { beginner: 0.5, novice: 0.75, intermediate: 1.0, advanced: 1.5, elite: 1.75 }, female: { beginner: 0.4, novice: 0.6, intermediate: 0.85, advanced: 1.15, elite: 1.4 }, note: "machine — rough" },
  { key: "legpress", name: "Leg Press", male: { beginner: 1.0, novice: 1.75, intermediate: 2.75, advanced: 4.0, elite: 5.25 }, female: { beginner: 0.75, novice: 1.5, intermediate: 2.25, advanced: 3.25, elite: 4.25 }, note: "sled machine — very rough" },
];

// Adjust the 90 kg / open-age base thresholds for this lifter.
//  - Bodyweight (allometric, Lietzke): ratio ∝ BW^(-1/3), so
//    threshold(bw) = base * (90/bw)^(1/3). Lighter → higher bar, heavier → lower.
//  - Age (McCulloch-tracking): no change ≤35, then lower the bar with age.
// Both are fair "centering" adjustments, not precision instruments.
export function adjustThresholds(std: Thresholds, bodyweightKg: number, age: number, refBw = 90): Thresholds {
  const bwF = bodyweightKg > 0 ? Math.pow(refBw / bodyweightKg, 1 / 3) : 1;
  const d = age > 35 ? age - 35 : 0;
  const ageF = age > 0 ? 1 + 0.01 * d + 0.00025 * d * d : 1;
  const adj = (r: number) => (r * bwF) / ageF;
  return {
    beginner: adj(std.beginner),
    novice: adj(std.novice),
    intermediate: adj(std.intermediate),
    advanced: adj(std.advanced),
    elite: adj(std.elite),
  };
}

export type Rating = {
  level: Level | null; // null = below Beginner
  ratio: number; // 1RM / bodyweight
  next?: { level: Level; kg: number }; // next tier + absolute kg to reach it
  journeyPct: number; // overall progress toward Elite (fuller & more motivating)
  ticks: number[]; // tier threshold positions as % of the bar (Beginner..Advanced)
};

// std is expected to already be adjusted for the lifter (bodyweight + age).
export function rateLift(std: Thresholds, e1rm: number, bodyweightKg: number): Rating {
  const ratio = e1rm / bodyweightKg;
  const tiers: [Level, number][] = [
    ["Beginner", std.beginner],
    ["Novice", std.novice],
    ["Intermediate", std.intermediate],
    ["Advanced", std.advanced],
    ["Elite", std.elite],
  ];
  let level: Level | null = null;
  for (const [lvl, thr] of tiers) if (ratio >= thr) level = lvl;

  let next: { level: Level; kg: number } | undefined;
  for (const [lvl, thr] of tiers) {
    if (ratio < thr) {
      next = { level: lvl, kg: Math.round(thr * bodyweightKg) };
      break;
    }
  }

  // Bar spans Beginner (0%) → Elite (100%); fill = where you are on that road.
  const span = std.elite - std.beginner;
  const journeyPct = Math.max(3, Math.min(100, ((ratio - std.beginner) / span) * 100));
  const ticks = [std.novice, std.intermediate, std.advanced].map((t) =>
    Math.max(0, Math.min(100, ((t - std.beginner) / span) * 100)),
  );
  return { level, ratio, next, journeyPct, ticks };
}

export const levelClass = (level: Level | null): string =>
  level ? `lvl-${level.toLowerCase()}` : "lvl-none";

// Bodyweight changes over the years, so old PRs should be rated against what you
// weighed back then. `history` holds {year, kg} entries; the current bodyweight
// is treated as the current-year entry. For a given record year we use the most
// recent entry at or before it (carrying the earliest backward for older years).
export type BwEntry = { year: number; kg: number };

export function bodyweightForYear(
  year: number,
  history: BwEntry[],
  currentBw: number,
  currentYear: number,
): number {
  const list = history.filter((e) => e.kg > 0);
  if (currentBw > 0 && !list.some((e) => e.year === currentYear)) list.push({ year: currentYear, kg: currentBw });
  const sorted = list.sort((a, b) => a.year - b.year);
  if (sorted.length === 0) return currentBw;
  let chosen = sorted[0];
  for (const e of sorted) if (e.year <= year) chosen = e;
  return chosen.kg;
}
