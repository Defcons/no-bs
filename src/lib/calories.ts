// Estimated calorie burn from heart rate — the Keytel et al. (2005) regression, the
// accepted way to turn average HR into kcal. Inputs are exactly the profile we already
// have (sex + age + bodyweight, all in Settings) plus avg HR and duration. Returns null
// whenever any input is missing, so the UI shows nothing rather than a fake number.
import type { Sex } from "./standards";

// kcal per minute at a given heart rate. The regression is LINEAR in HR, so a whole
// session's burn is exact from the AVERAGE HR × minutes — no need to integrate per fix.
export function kcalPerMin(bpm: number, weightKg: number, age: number, sex: Sex): number | null {
  if (!(bpm > 0) || !(weightKg > 0) || !(age > 0)) return null;
  const v =
    sex === "female"
      ? (-20.4022 + 0.4472 * bpm - 0.1263 * weightKg + 0.074 * age) / 4.184
      : (-55.0969 + 0.6309 * bpm + 0.1988 * weightKg + 0.2017 * age) / 4.184;
  return v > 0 ? v : 0;
}

// Whole-session (or live: avg-so-far × elapsed) estimate, rounded. null when HR or the
// profile is missing → callers hide the metric.
export function sessionKcal(
  avgBpm: number | null | undefined,
  durationSec: number | null | undefined,
  weightKg: number,
  age: number,
  sex: Sex,
): number | null {
  if (avgBpm == null || durationSec == null) return null;
  const perMin = kcalPerMin(avgBpm, weightKg, age, sex);
  if (perMin == null) return null;
  return Math.round(perMin * (durationSec / 60));
}
