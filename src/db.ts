// IndexedDB (via Dexie) is the local-first source of truth for the running app.
// The Google Sheet history is imported once on first run for the History/PR views.
import Dexie, { type Table } from "dexie";
import type { DayTemplate, ExercisePerf, Scheme, TrackPoint } from "./types";
import type { Exercise } from "./lib/exercises";

export interface StoredWorkout {
  id?: number;
  date: string; // ISO datetime (start of session)
  dayName: string;
  templateId?: number;
  exercises: ExercisePerf[];
  note?: string;
  durationSec?: number;
  avgHr?: number;
  maxHr?: number;
  moodBefore?: number; // 1-10 feeling before the session
  moodAfter?: number; // 1-10 feeling after the session
  track?: TrackPoint[]; // GPS route for tracked cardio (e.g. a run)
  source: string; // "app" for new sessions, "sheet:2026" etc. for imports
  synced?: boolean; // written back to the Google Sheet
  custom?: boolean; // logged as a free-form "Alternative" session (not a template)
}

export interface Setting {
  key: string;
  value: unknown;
}

// A user-supplied break-over sound (their own audio file, stored on-device).
export interface CustomSound {
  id?: number;
  name: string;
  blob: Blob;
}

class GymDB extends Dexie {
  workouts!: Table<StoredWorkout, number>;
  templates!: Table<DayTemplate, number>;
  settings!: Table<Setting, string>;
  customSounds!: Table<CustomSound, number>;
  exercises!: Table<Exercise, string>; // user-created catalog (id = slug)

  constructor() {
    super("gym-tracker");
    this.version(1).stores({
      // index date + dayName for history/PR scans; source to dedupe imports
      workouts: "++id, date, dayName, source",
      templates: "++id, order, name",
      settings: "key",
    });
    // v2: user-uploaded break sounds. Additive — Dexie carries the v1 tables over.
    this.version(2).stores({ customSounds: "++id" });
    // v3: user exercise catalog (muscle group / equipment / unit for exercises the
    // built-in library doesn't cover). Additive; id is a string slug.
    this.version(3).stores({ exercises: "id, name, muscle" });
  }
}

export const db = new GymDB();

// --- Settings helpers -------------------------------------------------------
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

// --- Custom break sounds (user's own audio files) ---------------------------
export async function addCustomSound(name: string, blob: Blob): Promise<number> {
  return db.customSounds.add({ name, blob });
}
export function listCustomSounds(): Promise<CustomSound[]> {
  return db.customSounds.toArray();
}
export function getCustomSound(id: number): Promise<CustomSound | undefined> {
  return db.customSounds.get(id);
}
export async function deleteCustomSound(id: number): Promise<void> {
  await db.customSounds.delete(id);
}

// --- User exercise catalog (custom exercises the built-in library lacks) -----
export function listExercises(): Promise<Exercise[]> {
  return db.exercises.toArray();
}
export async function upsertExercise(ex: Exercise): Promise<void> {
  await db.exercises.put(ex);
}
export async function deleteExercise(id: string): Promise<void> {
  await db.exercises.delete(id);
}
// Distinct exercise names the user has logged (for name autocomplete).
export async function distinctExerciseNames(): Promise<string[]> {
  const ws = await db.workouts.toArray();
  const set = new Set<string>();
  for (const w of ws) for (const e of w.exercises) if (e.name.trim()) set.add(e.name.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}

const s = (sets: number, reps: number | "Max"): Scheme => ({ sets, reps });

// Starter split seeded on first run — universal names, fully editable.
export const GENERIC_TEMPLATES: Omit<DayTemplate, "id">[] = [
  {
    name: "Push",
    order: 0,
    exercises: [
      { name: "Bench Press", scheme: s(3, 5) },
      { name: "Overhead Press", scheme: s(3, 8) },
      { name: "Incline Press", scheme: s(3, 8) },
      { name: "Dips", scheme: s(3, 10) },
      { name: "Triceps Extension", scheme: s(3, 12) },
    ],
  },
  {
    name: "Pull",
    order: 1,
    exercises: [
      { name: "Deadlift", scheme: s(3, 5) },
      { name: "Pull-up", scheme: s(3, 8) },
      { name: "Barbell Row", scheme: s(3, 8) },
      { name: "Lat Pulldown", scheme: s(3, 10) },
      { name: "Biceps Curl", scheme: s(3, 12) },
    ],
  },
  {
    name: "Legs",
    order: 2,
    exercises: [
      { name: "Squat", scheme: s(3, 5) },
      { name: "Romanian Deadlift", scheme: s(3, 8) },
      { name: "Leg Press", scheme: s(3, 10) },
      { name: "Leg Curl", scheme: s(3, 12) },
      { name: "Calf Raise", scheme: s(3, 15) },
    ],
  },
];

// --- One-time bootstrap: seed templates + import sheet history ---------------
// Guarded against concurrent invocation (React StrictMode double-mounts effects
// in dev, which would otherwise double-seed before the flag is written).
let booting: Promise<void> | null = null;
export function ensureBootstrapped(): Promise<void> {
  // Don't cache a rejection — a transient IndexedDB failure (quota, private mode)
  // would otherwise brick every retry until a full restart.
  return (booting ??= doBootstrap().catch((e) => {
    booting = null;
    throw e;
  }));
}

async function doBootstrap(): Promise<void> {
  const done = await getSetting("bootstrapped", false);
  if (done) return;

  // Belt-and-suspenders: only seed when the tables are actually empty. Every build
  // gets the same generic starter split (editable/deletable). History comes from the
  // user's own import/restore — the app never ships anyone's data.
  if ((await db.templates.count()) === 0) {
    await db.templates.bulkAdd(GENERIC_TEMPLATES as DayTemplate[]);
  }

  await setSetting("bootstrapped", true);
}

// Last completed session of a given day type, for pre-filling weights.
export async function lastWorkoutForDay(dayName: string): Promise<StoredWorkout | undefined> {
  const all = await db.workouts.where("dayName").equals(dayName).toArray();
  all.sort((a, b) => b.date.localeCompare(a.date));
  return all[0];
}
