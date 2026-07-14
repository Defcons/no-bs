// Resolve an exercise's ± weight increment. Priority: explicit per-exercise
// override (set in the workout editor) → name heuristic → the Settings default.
// The heuristic gives finer 2 kg jumps to single-arm dumbbell work (1h = "one
// hand", e.g. "1H Rows", "Curl 1h") and incline bench — but NOT incline flyes.
export function stepForExercise(name: string, fallback: number, override?: number): number {
  if (override != null && override > 0) return override;
  const fine = /\b1\s*h\b/i.test(name) || (/incline/i.test(name) && !/fly/i.test(name));
  return fine ? 2 : fallback;
}
