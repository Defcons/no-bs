// IndexedDB (via Dexie) is the local-first source of truth for the running app.
// The Google Sheet history is imported once on first run for the History/PR views.
import Dexie, { type Table } from "dexie";
import type { DayTemplate, ExercisePerf, Scheme, TrackPoint } from "./types";

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

// --- The current split (seeded once, editable later) ------------------------
// Taken from the 2026 tab of the sheet (see reference_gym_sheet).
const s = (sets: number, reps: number | "Max"): Scheme => ({ sets, reps });
export const DEFAULT_TEMPLATES: Omit<DayTemplate, "id">[] = [
  {
    name: "Chest & Arms",
    order: 0,
    exercises: [
      { name: "Bench", scheme: s(3, 5) },
      { name: "Incline", scheme: s(3, 8) },
      { name: "Flyes", scheme: s(3, 8) },
      { name: "Decline flyes", scheme: s(3, 8) },
      { name: "2H Extension", scheme: s(3, 8) },
      { name: "1H Extension", scheme: s(3, 10) },
    ],
  },
  {
    name: "Back & Bi & Abs",
    order: 1,
    exercises: [
      { name: "Deadlift", scheme: s(3, 5) },
      { name: "Pulldown", scheme: s(3, 8) },
      { name: "2H Rows", scheme: s(3, 8) },
      { name: "1H Rows", scheme: s(3, 8) },
      { name: "Korsrygg", scheme: s(3, 10) },
      { name: "Curl stang", scheme: s(3, 8) },
      { name: "Curl 1h", scheme: s(3, 8) },
      { name: "Abs", scheme: s(3, 8) },
      { name: "Crunches", scheme: s(3, "Max") },
    ],
  },
  {
    name: "Legs & Shoulder",
    order: 2,
    exercises: [
      { name: "Squat", scheme: s(3, 5) },
      { name: "Militarypress", scheme: s(3, 5) },
      { name: "Legpress", scheme: s(3, 8) },
      { name: "Shoulderpress", scheme: s(3, 8) },
      { name: "Calves", scheme: s(3, 10) },
      { name: "Shrugs", scheme: s(3, 8) },
      { name: "Hamstring", scheme: s(3, 8) },
      { name: "Quad", scheme: s(3, 10) },
    ],
  },
];

// Generic starter split for a fresh (public) install — universal names, editable.
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

  // Belt-and-suspenders: only seed when the tables are actually empty. Personal
  // build → my split; public build → a generic starter (both editable/deletable).
  if ((await db.templates.count()) === 0) {
    const starters = import.meta.env.VITE_SEED ? DEFAULT_TEMPLATES : GENERIC_TEMPLATES;
    await db.templates.bulkAdd(starters as DayTemplate[]);
  }

  // Personal history seed — ONLY in a personal build (VITE_SEED). A build-time
  // constant, so Vite tree-shakes the seed data out of the public bundle entirely.
  if (import.meta.env.VITE_SEED && (await db.workouts.where("source").startsWith("sheet:").count()) === 0) {
    const { parseWorkbook } = await import("./lib/sheet");
    const seed = (await import("./data/history-seed.json")).default as Record<string, string>;
    // Drop sessions dated in the future (sheet typos like a stray "33" year).
    const cutoff = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const parsed = parseWorkbook(seed).filter((w) => w.date <= cutoff);
    const rows: StoredWorkout[] = parsed.map((w) => ({
      date: w.date,
      dayName: w.dayName,
      exercises: w.exercises,
      note: w.note,
      source: `sheet:${w.source ?? "?"}`,
    }));
    await db.workouts.bulkAdd(rows);
  }

  await setSetting("bootstrapped", true);
}

// Last completed session of a given day type, for pre-filling weights.
export async function lastWorkoutForDay(dayName: string): Promise<StoredWorkout | undefined> {
  const all = await db.workouts.where("dayName").equals(dayName).toArray();
  all.sort((a, b) => b.date.localeCompare(a.date));
  return all[0];
}
