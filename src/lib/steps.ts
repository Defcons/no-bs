// Free-weight moves that step in small increments default to finer 2 kg +/- jumps:
// single-arm dumbbell work (1h = "one hand", e.g. "1H Rows", "Curl 1h") and incline
// bench — but NOT incline flyes (those stay on the default step).
export function stepForExercise(name: string, fallback: number): number {
  const fine = /\b1\s*h\b/i.test(name) || (/incline/i.test(name) && !/fly/i.test(name));
  return fine ? 2 : fallback;
}
