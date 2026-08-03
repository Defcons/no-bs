// Core data model for the gym tracker.
// Going-forward records are normalized; historical import from the Google Sheet
// (see reference_gym_sheet) is parsed into the same shape.

export type Scheme = {
  sets: number | null; // prescribed set count, e.g. 3
  reps: number | "Max" | null; // prescribed reps per set
};

export type SetEntry = {
  id?: string; // stable key for React lists (see lib/uid)
  weight: number | null; // kg (per dumbbell for DB moves); for bodyweight moves = ADDED weight; null if none
  reps: number | null; // actual reps; null -> falls back to scheme reps
  seconds?: number | null; // duration (timed holds; also the time for a distance set)
  distanceM?: number | null; // metres, for distance exercises (run/bike/swim/row)
  assist?: number | null; // extra/assisted reps → written as "(n)" in the sheet
  done?: boolean; // set completed (green) — toggled by the badge or on any value edit
  note?: string;
  raw?: string; // original token from the sheet, kept for fidelity/debugging
};

export type ExercisePerf = {
  id?: string; // stable key for React lists (see lib/uid)
  name: string;
  exerciseId?: string; // catalog id (see lib/exercises) — survives name edits
  scheme: Scheme;
  step?: number; // per-exercise ± weight increment (overrides the Settings default)
  sets: SetEntry[];
  note?: string;
  skipped?: boolean; // cell was "x"
  added?: boolean; // added mid-session as an alternative (editable/removable in a non-custom session)
};

export type Workout = {
  date: string; // ISO yyyy-mm-dd
  dayName: string; // e.g. "Chest & Arms"
  exercises: ExercisePerf[];
  note?: string; // per-session day note ("Note" row)
  moodBefore?: number; // parsed from the "Mood" row ("before→after")
  moodAfter?: number;
  durationSec?: number; // parsed from the "Time" row ("h:mm:ss")
  avgHr?: number; // parsed from the "Avg HR" row
  source?: string; // origin tab name when imported, e.g. "2026"
};

// One recorded GPS sample during a tracked (cardio) session.
export type TrackPoint = {
  t: number; // epoch ms
  lat: number;
  lng: number;
  hr?: number; // heart rate at this point, if a monitor was connected
};

// One recorded rest/break taken during a session — for break stats in History and
// long-rest markers on the GPS route map. Its map location is derived by matching
// `at` to the nearest track point in time, so no location is stored here.
export type WorkoutBreak = {
  at: number; // epoch ms the break started
  sec: number; // actual rest taken, capped at the planned break length
};

// A reusable day definition (the split): what exercises, in what order, with schemes.
export type DayTemplate = {
  id?: number;
  name: string;
  order: number;
  exercises: { name: string; scheme: Scheme; step?: number; exerciseId?: string }[];
};
