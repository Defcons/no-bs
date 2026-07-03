// Science-based strength standards: 1RM as a multiple of bodyweight, adult male,
// mid-bodyweight (~90 kg) approximation. Sources: StrengthLevel + ExRx (Kilgore)
// consensus. Barbell lifts are high-confidence; machine lifts (pulldown, leg
// press) are rougher and machine-dependent (esp. leg press = 45° sled).
export type Level = "Beginner" | "Novice" | "Intermediate" | "Advanced" | "Elite";
export const LEVELS: Level[] = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"];

type Thresholds = { beginner: number; novice: number; intermediate: number; advanced: number; elite: number };

// Only the "important" lifts, in display order. `canon` matches canonName().
export const KEY_LIFTS: { canon: string; std: Thresholds; note?: string }[] = [
  { canon: "Squat", std: { beginner: 0.75, novice: 1.25, intermediate: 1.5, advanced: 2.25, elite: 2.75 } },
  { canon: "Bench", std: { beginner: 0.5, novice: 0.75, intermediate: 1.25, advanced: 1.75, elite: 2.0 } },
  { canon: "Deadlift", std: { beginner: 1.0, novice: 1.5, intermediate: 2.0, advanced: 2.5, elite: 3.0 } },
  { canon: "Military press", std: { beginner: 0.35, novice: 0.55, intermediate: 0.8, advanced: 1.1, elite: 1.4 } },
  { canon: "Pulldown", std: { beginner: 0.5, novice: 0.75, intermediate: 1.0, advanced: 1.5, elite: 1.75 }, note: "machine — rough" },
  { canon: "Legpress", std: { beginner: 1.0, novice: 1.75, intermediate: 2.75, advanced: 4.0, elite: 5.25 }, note: "sled machine — very rough" },
];

// Adjust the 90 kg / open-age base thresholds for this lifter.
//  - Bodyweight (allometric, Lietzke): ratio ∝ BW^(-1/3), so
//    threshold(bw) = base * (90/bw)^(1/3). Lighter → higher bar, heavier → lower.
//  - Age (McCulloch-tracking): no change ≤35, then lower the bar with age.
// Both are fair "centering" adjustments, not precision instruments.
export function adjustThresholds(std: Thresholds, bodyweightKg: number, age: number): Thresholds {
  const bwF = bodyweightKg > 0 ? Math.pow(90 / bodyweightKg, 1 / 3) : 1;
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
