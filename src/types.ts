// Core data model for the gym tracker.
// Going-forward records are normalized; historical import from the Google Sheet
// (see reference_gym_sheet) is parsed into the same shape.

export type Scheme = {
  sets: number | null; // prescribed set count, e.g. 3
  reps: number | "Max" | null; // prescribed reps per set
};

export type SetEntry = {
  weight: number | null; // kg (per dumbbell for DB moves); null if unknown/bodyweight/text-only
  reps: number | null; // actual reps; null -> falls back to scheme reps
  note?: string;
  raw?: string; // original token from the sheet, kept for fidelity/debugging
};

export type ExercisePerf = {
  name: string;
  scheme: Scheme;
  sets: SetEntry[];
  note?: string;
  skipped?: boolean; // cell was "x"
};

export type Workout = {
  date: string; // ISO yyyy-mm-dd
  dayName: string; // e.g. "Chest & Arms"
  exercises: ExercisePerf[];
  note?: string; // per-session day note ("Note" row)
  source?: string; // origin tab name when imported, e.g. "2026"
};

// A reusable day definition (the split): what exercises, in what order, with schemes.
export type DayTemplate = {
  id?: number;
  name: string;
  order: number;
  exercises: { name: string; scheme: Scheme }[];
};
