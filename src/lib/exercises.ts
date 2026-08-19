// Exercise identity + classification: the single source of truth for what muscle
// an exercise trains, how its records aggregate, its strength-standard link, and
// its unit. A built-in LIBRARY (+ the user's own catalog) is matched by name;
// unmatched names fall back to the legacy regex layer so behaviour never regresses.
// See docs/exercise-model.md.

export type MuscleGroup = "Chest" | "Back" | "Shoulder" | "Legs" | "Arms" | "Core" | "Other";
export type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "other";
export type ExerciseUnit = "weight" | "bodyweight" | "time" | "distance";

export interface Exercise {
  id: string; // stable slug
  name: string; // canonical display name
  aliases?: string[]; // alternate spellings / languages / abbreviations users type
  muscle: MuscleGroup; // primary
  secondary?: MuscleGroup[];
  equipment: Equipment;
  unit: ExerciseUnit; // "weight" unless stated
  compound?: boolean;
  standardKey?: string; // links to a strength standard (see standards.ts)
  builtin: boolean;
  fallback?: boolean; // true when synthesised by the regex fallback (no catalog match)
}

// Display order for the Records "by muscle" section. "Other" is the catch-all.
export const MUSCLE_ORDER: MuscleGroup[] = ["Chest", "Back", "Shoulder", "Legs", "Arms", "Core", "Other"];

// ── Legacy regex layer (FALLBACK ONLY) ──────────────────────────────────────
// Used when a logged name matches nothing in the catalog. Kept intact so
// unmatched names classify/aggregate exactly as they did pre-catalog.
const CANON: [RegExp, string][] = [
  [/rear.?delt|rear.?fl|back.?fl/i, "Rear delt flyes"],
  [/decline.?press|decline.?bench/i, "Decline press"],
  [/decline.?fl/i, "Decline flyes"],
  [/bench|benkpress/i, "Bench"],
  [/squat|knebøy/i, "Squat"],
  [/deadlift|\bmark/i, "Deadlift"],
  [/military|militarypress/i, "Military press"],
  [/shoulderpress|shoulder press/i, "Shoulder press"],
  [/incline|skråbenk|skråpress/i, "Incline"],
  [/legpress|leg press/i, "Legpress"],
  [/pulldown|nedtrekk/i, "Pulldown"],
  [/\bcurl stang|barbell curl/i, "Barbell curl"],
  [/side.?hev|side.?lift|lateral/i, "Lateral raise"],
  [/calves|calf/i, "Calves"],
  [/quad/i, "Quad"],
  [/hamstring/i, "Hamstring"],
  [/shrug/i, "Shrugs"],
];

export function canonName(name: string): string {
  for (const [re, c] of CANON) if (re.test(name)) return c;
  return name.trim();
}
export function canonKey(name: string): string {
  return norm(canonName(name));
}
export function muscleGroup(name: string): MuscleGroup {
  const n = name.toLowerCase();
  if (/extension|curl|tricep|bicep|skull|pushdown|pressdown/.test(n)) return "Arms";
  if (/shoulder|military|shrug|delt|\bohp\b|sidehev|sidelift|lateral|face ?pull|rear|back ?fl/.test(n)) return "Shoulder";
  if (/bench|incline|skråbenk|\bfly|decline|chest/.test(n)) return "Chest";
  if (/deadlift|row|pulldown|pull-?up|chin|\blat|korsrygg|nedtrekk|\bback\b|\bmark/.test(n)) return "Back";
  if (/squat|\bleg|calf|calves|quad|hamstring|lunge|utfall|glute|benhev/.test(n)) return "Legs";
  if (/abs|crunch|core|plank|sit-?up|situp/.test(n)) return "Core";
  return "Other";
}

// Normalise for exact catalog matching (no CANON rewriting — that would collapse
// distinct catalog entries like "Incline dumbbell press" → "Incline").
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_/]+/g, " ")
    .trim();
}

// ── Built-in catalog ────────────────────────────────────────────────────────
// Muscle = primary trained group (the Records bucket). standardKey only on the
// canonical barbell/main variant. Aliases are realistic full names users type,
// including common abbreviations and Norwegian (back-compat with existing logs).
const W = "weight" as const;
export const LIBRARY: Exercise[] = [
  // ── Chest ──
  { id: "bench-press", name: "Bench Press", aliases: ["bench", "benkpress", "flat bench", "barbell bench press", "flat barbell bench", "bb bench"], muscle: "Chest", secondary: ["Arms", "Shoulder"], equipment: "barbell", unit: W, compound: true, standardKey: "bench", builtin: true },
  { id: "incline-bench-press", name: "Incline Bench Press", aliases: ["incline", "incline bench", "skråbenk", "skråpress", "incline barbell press"], muscle: "Chest", secondary: ["Shoulder"], equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "decline-bench-press", name: "Decline Bench Press", aliases: ["decline", "decline press", "decline bench"], muscle: "Chest", equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "dumbbell-bench-press", name: "Dumbbell Bench Press", aliases: ["db bench", "dumbbell press", "dumbbell chest press", "flat dumbbell press"], muscle: "Chest", secondary: ["Arms", "Shoulder"], equipment: "dumbbell", unit: W, compound: true, builtin: true },
  { id: "incline-dumbbell-press", name: "Incline Dumbbell Press", aliases: ["incline db press", "incline dumbbell bench", "incline dumbbell"], muscle: "Chest", secondary: ["Shoulder"], equipment: "dumbbell", unit: W, compound: true, builtin: true },
  { id: "machine-chest-press", name: "Machine Chest Press", aliases: ["chest press", "chest press machine", "seated chest press"], muscle: "Chest", equipment: "machine", unit: W, builtin: true },
  { id: "pec-deck", name: "Pec Deck", aliases: ["pec deck fly", "machine fly", "butterfly", "chest fly machine"], muscle: "Chest", equipment: "machine", unit: W, builtin: true },
  { id: "cable-crossover", name: "Cable Crossover", aliases: ["cable fly", "crossover", "cable chest fly"], muscle: "Chest", equipment: "cable", unit: W, builtin: true },
  { id: "dumbbell-fly", name: "Dumbbell Fly", aliases: ["db fly", "chest fly", "dumbbell flyes", "flyes", "fly"], muscle: "Chest", equipment: "dumbbell", unit: W, builtin: true },
  { id: "push-up", name: "Push-up", aliases: ["pushup", "pushups", "push ups", "press up"], muscle: "Chest", secondary: ["Arms", "Core"], equipment: "bodyweight", unit: "bodyweight", compound: true, builtin: true },
  { id: "chest-dip", name: "Chest Dip", aliases: ["dips", "dip", "chest dips"], muscle: "Chest", secondary: ["Arms"], equipment: "bodyweight", unit: "bodyweight", compound: true, builtin: true },

  // ── Back ──
  { id: "deadlift", name: "Deadlift", aliases: ["conventional deadlift", "markløft", "mark", "bb deadlift"], muscle: "Back", secondary: ["Legs"], equipment: "barbell", unit: W, compound: true, standardKey: "deadlift", builtin: true },
  { id: "sumo-deadlift", name: "Sumo Deadlift", aliases: ["sumo"], muscle: "Back", secondary: ["Legs"], equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "barbell-row", name: "Barbell Row", aliases: ["bent over row", "bb row", "pendlay row", "barbell bent-over row", "stangroing"], muscle: "Back", secondary: ["Arms"], equipment: "barbell", unit: W, compound: true, standardKey: "row", builtin: true },
  { id: "dumbbell-row", name: "Dumbbell Row", aliases: ["db row", "one arm row", "single arm row", "one-arm dumbbell row"], muscle: "Back", secondary: ["Arms"], equipment: "dumbbell", unit: W, compound: true, builtin: true },
  { id: "seated-cable-row", name: "Seated Cable Row", aliases: ["cable row", "seated row", "low row"], muscle: "Back", secondary: ["Arms"], equipment: "cable", unit: W, compound: true, builtin: true },
  { id: "t-bar-row", name: "T-Bar Row", aliases: ["t bar row", "tbar row"], muscle: "Back", secondary: ["Arms"], equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "chest-supported-row", name: "Chest-Supported Row", aliases: ["chest supported row", "machine row", "seal row"], muscle: "Back", secondary: ["Arms"], equipment: "machine", unit: W, builtin: true },
  { id: "lat-pulldown", name: "Lat Pulldown", aliases: ["pulldown", "nedtrekk", "cable pulldown", "lat pull down", "wide grip pulldown"], muscle: "Back", secondary: ["Arms"], equipment: "cable", unit: W, compound: true, standardKey: "pulldown", builtin: true },
  { id: "pull-up", name: "Pull-up", aliases: ["pullup", "pullups", "pull ups", "pull-ups"], muscle: "Back", secondary: ["Arms"], equipment: "bodyweight", unit: "bodyweight", compound: true, builtin: true },
  { id: "chin-up", name: "Chin-up", aliases: ["chinup", "chinups", "chin ups", "chin-ups"], muscle: "Back", secondary: ["Arms"], equipment: "bodyweight", unit: "bodyweight", compound: true, builtin: true },
  { id: "face-pull", name: "Face Pull", aliases: ["face pulls", "cable face pull"], muscle: "Shoulder", secondary: ["Back"], equipment: "cable", unit: W, builtin: true },
  { id: "back-extension", name: "Back Extension", aliases: ["hyperextension", "hyper extension", "korsrygg", "45 degree back extension"], muscle: "Back", secondary: ["Legs"], equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "good-morning", name: "Good Morning", aliases: ["good mornings"], muscle: "Legs", secondary: ["Back"], equipment: "barbell", unit: W, compound: true, builtin: true },

  // ── Shoulder ──
  { id: "overhead-press", name: "Overhead Press", aliases: ["ohp", "military press", "militarypress", "military", "standing press", "shoulder press barbell", "strict press"], muscle: "Shoulder", secondary: ["Arms"], equipment: "barbell", unit: W, compound: true, standardKey: "ohp", builtin: true },
  { id: "dumbbell-shoulder-press", name: "Dumbbell Shoulder Press", aliases: ["shoulder press", "db shoulder press", "seated dumbbell press", "dumbbell overhead press", "shoulderpress"], muscle: "Shoulder", secondary: ["Arms"], equipment: "dumbbell", unit: W, compound: true, builtin: true },
  { id: "arnold-press", name: "Arnold Press", aliases: ["arnold"], muscle: "Shoulder", secondary: ["Arms"], equipment: "dumbbell", unit: W, builtin: true },
  { id: "machine-shoulder-press", name: "Machine Shoulder Press", aliases: ["shoulder press machine", "seated shoulder press machine"], muscle: "Shoulder", equipment: "machine", unit: W, builtin: true },
  { id: "lateral-raise", name: "Lateral Raise", aliases: ["side raise", "sidehev", "side lift", "lateral raises", "db lateral raise", "cable lateral raise"], muscle: "Shoulder", equipment: "dumbbell", unit: W, builtin: true },
  { id: "front-raise", name: "Front Raise", aliases: ["front raises", "db front raise"], muscle: "Shoulder", equipment: "dumbbell", unit: W, builtin: true },
  { id: "rear-delt-fly", name: "Rear Delt Fly", aliases: ["rear delt flyes", "reverse fly", "rear delt raise", "bent over fly", "rear fly"], muscle: "Shoulder", equipment: "dumbbell", unit: W, builtin: true },
  { id: "upright-row", name: "Upright Row", aliases: ["upright rows"], muscle: "Shoulder", secondary: ["Back"], equipment: "barbell", unit: W, builtin: true },
  { id: "shrug", name: "Shrug", aliases: ["shrugs", "barbell shrug", "dumbbell shrug", "trap shrug"], muscle: "Shoulder", secondary: ["Back"], equipment: "barbell", unit: W, builtin: true },

  // ── Legs ──
  { id: "squat", name: "Squat", aliases: ["back squat", "barbell squat", "knebøy", "high bar squat", "low bar squat"], muscle: "Legs", secondary: ["Back", "Core"], equipment: "barbell", unit: W, compound: true, standardKey: "squat", builtin: true },
  { id: "front-squat", name: "Front Squat", aliases: ["front squats"], muscle: "Legs", secondary: ["Core"], equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "hack-squat", name: "Hack Squat", aliases: ["hack squat machine"], muscle: "Legs", equipment: "machine", unit: W, compound: true, builtin: true },
  { id: "goblet-squat", name: "Goblet Squat", aliases: ["goblet squats"], muscle: "Legs", equipment: "dumbbell", unit: W, compound: true, builtin: true },
  { id: "leg-press", name: "Leg Press", aliases: ["legpress", "leg press machine", "45 degree leg press", "sled press"], muscle: "Legs", equipment: "machine", unit: W, compound: true, standardKey: "legpress", builtin: true },
  { id: "romanian-deadlift", name: "Romanian Deadlift", aliases: ["rdl", "romanian dl", "stiff leg deadlift", "stiff-legged deadlift"], muscle: "Legs", secondary: ["Back"], equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "leg-extension", name: "Leg Extension", aliases: ["leg extensions", "quad extension", "knee extension"], muscle: "Legs", equipment: "machine", unit: W, builtin: true },
  { id: "leg-curl", name: "Leg Curl", aliases: ["hamstring curl", "lying leg curl", "seated leg curl", "leg curls"], muscle: "Legs", equipment: "machine", unit: W, builtin: true },
  { id: "lunge", name: "Lunge", aliases: ["lunges", "walking lunge", "utfall", "dumbbell lunge"], muscle: "Legs", secondary: ["Core"], equipment: "dumbbell", unit: W, compound: true, builtin: true },
  { id: "bulgarian-split-squat", name: "Bulgarian Split Squat", aliases: ["split squat", "bss", "rear foot elevated split squat"], muscle: "Legs", secondary: ["Core"], equipment: "dumbbell", unit: W, compound: true, builtin: true },
  { id: "hip-thrust", name: "Hip Thrust", aliases: ["barbell hip thrust", "glute bridge", "hip thrusts"], muscle: "Legs", equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "calf-raise", name: "Calf Raise", aliases: ["calf raises", "calves", "calf", "standing calf raise", "seated calf raise", "tåhev"], muscle: "Legs", equipment: "machine", unit: W, builtin: true },
  { id: "nordic-curl", name: "Nordic Curl", aliases: ["nordic hamstring curl", "nordic ham curl"], muscle: "Legs", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "step-up", name: "Step-up", aliases: ["step ups", "box step up"], muscle: "Legs", equipment: "dumbbell", unit: W, builtin: true },

  // ── Arms ──
  { id: "barbell-curl", name: "Barbell Curl", aliases: ["bb curl", "curl stang", "biceps curl barbell", "ez bar curl"], muscle: "Arms", equipment: "barbell", unit: W, builtin: true },
  { id: "dumbbell-curl", name: "Dumbbell Curl", aliases: ["db curl", "bicep curl", "biceps curl", "dumbbell biceps curl", "alternating curl"], muscle: "Arms", equipment: "dumbbell", unit: W, builtin: true },
  { id: "hammer-curl", name: "Hammer Curl", aliases: ["hammer curls", "db hammer curl"], muscle: "Arms", equipment: "dumbbell", unit: W, builtin: true },
  { id: "preacher-curl", name: "Preacher Curl", aliases: ["preacher curls", "ez preacher curl"], muscle: "Arms", equipment: "barbell", unit: W, builtin: true },
  { id: "cable-curl", name: "Cable Curl", aliases: ["cable bicep curl", "cable curls"], muscle: "Arms", equipment: "cable", unit: W, builtin: true },
  { id: "concentration-curl", name: "Concentration Curl", aliases: ["concentration curls"], muscle: "Arms", equipment: "dumbbell", unit: W, builtin: true },
  { id: "tricep-pushdown", name: "Tricep Pushdown", aliases: ["triceps pushdown", "pushdown", "cable pushdown", "rope pushdown", "pressdown"], muscle: "Arms", equipment: "cable", unit: W, builtin: true },
  { id: "tricep-extension", name: "Tricep Extension", aliases: ["triceps extension", "overhead tricep extension", "overhead extension", "french press"], muscle: "Arms", equipment: "dumbbell", unit: W, builtin: true },
  { id: "skullcrusher", name: "Skullcrusher", aliases: ["skull crusher", "skullcrushers", "lying tricep extension"], muscle: "Arms", equipment: "barbell", unit: W, builtin: true },
  { id: "close-grip-bench-press", name: "Close-Grip Bench Press", aliases: ["close grip bench", "cgbp"], muscle: "Arms", secondary: ["Chest"], equipment: "barbell", unit: W, compound: true, builtin: true },
  { id: "tricep-dip", name: "Tricep Dip", aliases: ["bench dip", "tricep dips"], muscle: "Arms", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "tricep-kickback", name: "Tricep Kickback", aliases: ["kickback", "triceps kickback"], muscle: "Arms", equipment: "dumbbell", unit: W, builtin: true },
  { id: "wrist-curl", name: "Wrist Curl", aliases: ["forearm curl", "wrist curls"], muscle: "Arms", equipment: "dumbbell", unit: W, builtin: true },

  // ── Core ──
  { id: "plank", name: "Plank", aliases: ["planks", "front plank"], muscle: "Core", equipment: "bodyweight", unit: "time", builtin: true },
  { id: "crunch", name: "Crunch", aliases: ["crunches", "ab crunch"], muscle: "Core", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "sit-up", name: "Sit-up", aliases: ["situp", "sit ups", "situps"], muscle: "Core", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "leg-raise", name: "Leg Raise", aliases: ["leg raises", "lying leg raise"], muscle: "Core", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "hanging-leg-raise", name: "Hanging Leg Raise", aliases: ["hanging leg raises", "hanging knee raise"], muscle: "Core", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "russian-twist", name: "Russian Twist", aliases: ["russian twists"], muscle: "Core", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "cable-crunch", name: "Cable Crunch", aliases: ["kneeling cable crunch"], muscle: "Core", equipment: "cable", unit: W, builtin: true },
  { id: "ab-wheel", name: "Ab Wheel", aliases: ["ab rollout", "ab wheel rollout"], muscle: "Core", equipment: "bodyweight", unit: "bodyweight", builtin: true },
  { id: "dead-bug", name: "Dead Bug", aliases: ["dead bugs"], muscle: "Core", equipment: "bodyweight", unit: "bodyweight", builtin: true },

  // ── Cardio / other ──
  { id: "running", name: "Running", aliases: ["run", "treadmill", "jog", "løping"], muscle: "Other", equipment: "other", unit: "distance", builtin: true },
  { id: "cycling", name: "Cycling", aliases: ["bike", "spin", "stationary bike", "sykling"], muscle: "Other", equipment: "other", unit: "distance", builtin: true },
  { id: "rowing-machine", name: "Rowing Machine", aliases: ["erg", "rower", "row erg", "concept2"], muscle: "Other", equipment: "machine", unit: "distance", builtin: true },
  { id: "elliptical", name: "Elliptical", aliases: ["cross trainer"], muscle: "Other", equipment: "machine", unit: "time", builtin: true },
  { id: "walking", name: "Walking", aliases: ["walk", "incline walk"], muscle: "Other", equipment: "other", unit: "distance", builtin: true },
  { id: "swimming", name: "Swimming", aliases: ["swim"], muscle: "Other", equipment: "other", unit: "distance", builtin: true },
];

// A URL-safe slug id for a user-created exercise.
export function slug(name: string): string {
  return norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
}

// ── Resolver ────────────────────────────────────────────────────────────────
const builtinIndex = new Map<string, Exercise>(); // norm(name/alias) → exercise
const builtinById = new Map<string, Exercise>(); // id → exercise
for (const ex of LIBRARY) {
  builtinById.set(ex.id, ex);
  builtinIndex.set(norm(ex.name), ex);
  for (const a of ex.aliases ?? []) if (!builtinIndex.has(norm(a))) builtinIndex.set(norm(a), ex);
}

// User-created exercises, registered from the Dexie catalog at app start. Kept in
// module-level indexes so the resolver stays synchronous.
let customIndex = new Map<string, Exercise>();
let customById = new Map<string, Exercise>();
export function registerCustomExercises(list: Exercise[]): void {
  const byName = new Map<string, Exercise>();
  const byId = new Map<string, Exercise>();
  for (const ex of list) {
    byId.set(ex.id, ex);
    byName.set(norm(ex.name), ex);
    for (const a of ex.aliases ?? []) if (!byName.has(norm(a))) byName.set(norm(a), ex);
  }
  customIndex = byName;
  customById = byId;
}

// The single source of truth. A stamped exerciseId (survives renames) wins; then
// the user catalog by name, then built-ins; on a miss, the legacy regex layer
// synthesises a result so unmatched names never regress.
export function resolveExercise(name: string, exerciseId?: string): Exercise {
  if (exerciseId) {
    const byId = customById.get(exerciseId) ?? builtinById.get(exerciseId);
    if (byId) return byId;
  }
  const k = norm(name);
  const hit = customIndex.get(k) ?? builtinIndex.get(k);
  if (hit) return hit;
  // A fused/variant spelling can miss the alias index while its CANON rewrite IS a
  // catalog name/alias (e.g. "Militarypress" → "Military press" → overhead-press).
  // Re-probe with the rewrite so the old-sheet era and the app era share one
  // identity — but ONLY when the rule consumed the WHOLE name: a partial match
  // ("Incline curl" → "Incline") must NOT collapse into the catalog's incline
  // bench entry; those keep the legacy fallback below, exactly as before.
  for (const [re, canon] of CANON) {
    if (!re.test(name)) continue;
    if (norm(name.replace(re, " ")) !== "") break; // partial match → legacy fallback
    const canonHit = customIndex.get(norm(canon)) ?? builtinIndex.get(norm(canon));
    if (canonHit) return canonHit;
    break;
  }
  return {
    id: canonKey(name), // == old liftRecords key for unmatched names
    name: canonName(name),
    muscle: muscleGroup(name),
    equipment: "other",
    unit: "weight",
    builtin: false,
    fallback: true,
  };
}

// Autocomplete/search over the built-in catalog + the user's own history (P1 UI).
// `extra` = the user's previously-logged names, deduped in by the caller.
export function searchExercises(query: string, limit = 8): Exercise[] {
  const q = norm(query);
  if (!q) return [];
  const starts: Exercise[] = [];
  const contains: Exercise[] = [];
  const seen = new Set<string>();
  for (const ex of LIBRARY) {
    const hay = [ex.name, ...(ex.aliases ?? [])].map(norm);
    if (hay.some((h) => h === q || h.startsWith(q))) {
      if (!seen.has(ex.id)) (starts.push(ex), seen.add(ex.id));
    } else if (hay.some((h) => h.includes(q))) {
      if (!seen.has(ex.id)) (contains.push(ex), seen.add(ex.id));
    }
  }
  return [...starts, ...contains].slice(0, limit);
}
