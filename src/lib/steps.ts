// Free-weight moves that step in small increments default to finer 2 kg +/- jumps:
// single-arm dumbbell work (1h = "one hand", e.g. "1H Rows", "Curl 1h") and incline
// bench (dumbbells / small plate jumps).
const FINE_STEP_RE = /\b1\s*h\b|incline/i;

export function stepForExercise(name: string, fallback: number): number {
  return FINE_STEP_RE.test(name) ? 2 : fallback;
}
