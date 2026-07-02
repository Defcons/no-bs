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

export type Rating = {
  level: Level | null; // null = below Beginner
  ratio: number; // 1RM / bodyweight
  next?: { level: Level; kg: number }; // next tier + absolute kg to reach it
  pct: number; // progress through the current band toward the next tier
};

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
  let pct = 100;
  for (let i = 0; i < tiers.length; i++) {
    if (ratio < tiers[i][1]) {
      next = { level: tiers[i][0], kg: Math.round(tiers[i][1] * bodyweightKg) };
      const lower = i > 0 ? tiers[i - 1][1] : 0;
      pct = Math.max(0, Math.min(100, ((ratio - lower) / (tiers[i][1] - lower)) * 100));
      break;
    }
  }
  return { level, ratio, next, pct };
}

export const levelClass = (level: Level | null): string =>
  level ? `lvl-${level.toLowerCase()}` : "lvl-none";
