// Single-arm free-weight moves (1h = "one hand", e.g. "1H Rows", "Curl 1h") use
// finer 2 kg +/- jumps by default, since dumbbells step in small increments.
const FINE_STEP_RE = /\b1\s*h\b/i;

export function stepForExercise(name: string, fallback: number): number {
  return FINE_STEP_RE.test(name) ? 2 : fallback;
}
