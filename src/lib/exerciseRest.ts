// Per-exercise default rest, GLOBAL per exercise (user decision 2026-07-24): a
// heavy lift like Deadlift wants ~2 min, a curl wants seconds. Keyed by the
// RESOLVED exercise id (see resolveExercise) so it attaches to built-in library
// exercises AND user-created ones alike, and applies everywhere that exercise
// shows up — templates and typed-in Alternative sessions. Falls back to the
// Settings rest default when an exercise has no value of its own.
//
// Singleton cache (like the exercise resolver) so any component can read it at
// break time without prop-drilling; loaded once at app start.
import { getSetting, setSetting } from "../db";

let cache: Record<string, number> = {};

export async function loadExerciseRest(): Promise<void> {
  cache = (await getSetting<Record<string, number>>("exerciseRest", {})) ?? {};
}

// Seconds for this exercise id, or undefined to mean "use the global default".
export function restForId(id: string): number | undefined {
  return cache[id];
}

// Set (or clear, with null/0 → back to the global default) an exercise's rest.
export async function setRestForId(id: string, sec: number | null): Promise<void> {
  const next = { ...cache };
  if (sec == null || sec <= 0) delete next[id];
  else next[id] = sec;
  cache = next;
  await setSetting("exerciseRest", cache);
}
