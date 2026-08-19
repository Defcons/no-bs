// Write finished workouts back to the Google Sheet via a bound Apps Script Web
// App (see apps-script/Code.gs). The app POSTs the session; the script finds the
// right year tab + day-block and writes a new dated column in the sheet's own
// transposed layout (see reference_gym_sheet). No OAuth / backend needed.
//
// CORS note: we send Content-Type text/plain so the browser makes a "simple"
// request (no preflight); Apps Script's redirected response carries ACAO:*.
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { db, getSetting, setSetting, type StoredWorkout } from "../db";
import { localDay } from "./format";
import { parseBodyweightTab, parseSheet } from "./sheet";
import { computeRun, fmtDist, fmtPace } from "./runStats";
import { downsample, encodePolyline } from "./polyline";
import type { BwEntry } from "./standards";
import type { ExercisePerf } from "../types";
import { APP_PUBLIC_URL } from "./syncConfig";

const BODYWEIGHT_TAB = "Bodyweight";
const PROFILE_TAB = "Profile";

export type SyncResult = {
  ok: boolean;
  error?: string;
  column?: number;
  written?: string[];
  skipped?: string[];
  noteWritten?: boolean;
  ping?: boolean;
  tabs?: Record<string, string[][]>; // "pull" response: each sheet tab's cells
};

// Norwegian decimal comma, matching how the sheet is written (72.5 -> "72,5").
const fmtNum = (n: number): string => String(n).replace(".", ",");

// Reconstruct a sheet cell like "72,5-70-70", "70(6)" (off-scheme reps) or
// "70(6+2)" (6 clean + 2 assisted) — the sheet's own historical conventions, and
// exactly what parseCell reads back, so a sheet round-trip is lossless.
export function cellFor(ex: ExercisePerf): string {
  if (ex.skipped) return "x";
  const schemeReps = typeof ex.scheme?.reps === "number" ? ex.scheme.reps : null;
  return ex.sets
    .filter((s) => s.weight != null || s.reps != null)
    .map((s) => {
      // Bodyweight set (reps only, no weight) → "(reps)", which parseCell reads back.
      if (s.weight == null) return s.reps != null ? `(${s.reps})` : "";
      let t = fmtNum(s.weight);
      // Annotate reps when they carry information: off-scheme reps or an assist.
      if (s.assist != null) t += `(${s.reps ?? schemeReps ?? ""}+${s.assist})`;
      else if (s.reps != null && s.reps !== schemeReps) t += `(${s.reps})`;
      return t;
    })
    .filter((t) => t !== "")
    .join("-");
}

// Dedup key for restore/import: day + date alone would collapse two genuine
// same-day sessions (e.g. a morning and an evening run), so include a cheap
// content signature — identical sessions still dedupe, distinct ones survive.
// Duration is rounded to minutes so formatting round-trips don't split keys.
// The signature counts only what the SHEET can carry (sets with a weight or reps,
// exercises with ≥1 such set — cellFor's own filter) so a local row and its sheet
// round-trip hash IDENTICALLY: since the 1.56.0 done-only save, undone sets stay in
// the local array nulled, and note-only / time-distance exercises produce an empty
// cell — raw lengths differ between the two copies, and every "Import from sheet"
// would re-add your own sessions as duplicates. The day is the LOCAL day (matches
// what fmtDate writes into the sheet header since 1.58.0).
type KeyableWorkout = {
  dayName: string;
  date: string;
  exercises: { name: string; sets: { weight?: number | null; reps?: number | null }[] }[];
  durationSec?: number;
};
function buildKey(w: KeyableWorkout, day: string): string {
  let nEx = 0;
  let nSets = 0;
  for (const e of w.exercises) {
    const content = e.sets.filter((s) => s.weight != null || s.reps != null).length;
    if (content > 0) nEx++;
    nSets += content;
  }
  const mins = w.durationSec ? Math.round(w.durationSec / 60) : 0;
  return `${w.dayName.trim().toLowerCase()}@@${day}@@${nEx}@@${nSets}@@${mins}`;
}
export function sessionKey(w: KeyableWorkout): string {
  return buildKey(w, localDay(w.date));
}
// Membership keys for an EXISTING local row: its canonical (local-day) key PLUS the
// legacy UTC-day key when they differ — sheet columns and backups written before
// 1.58.0 carry the UTC day, so a near-midnight session's old copy would otherwise
// re-import as a duplicate. Candidates (incoming rows) always use plain sessionKey.
export function sessionKeys(w: KeyableWorkout): string[] {
  const local = localDay(w.date);
  const utc = (w.date || "").slice(0, 10);
  return utc !== local ? [buildKey(w, local), buildKey(w, utc)] : [buildKey(w, local)];
}

// ISO date -> "dd.mm.yy" (the sheet's header format). LOCAL day — an evening
// session must appear in the sheet under the day the user actually trained.
function fmtDate(iso: string): string {
  const [y, m, d] = localDay(iso).split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

// Local "HH:MM" the session started, for the sheet's "Time of day" row (so time-of-
// day vs mood/strength can be analysed later). "" for a bare date with no time
// component (imported sessions never re-sync, so app sessions always have one).
function timeOfDayStr(iso: string): string {
  if (!iso.includes("T")) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function config(): Promise<{ url: string; secret: string }> {
  // Per-device Settings are the only source — nothing is ever baked into the bundle.
  return {
    url: await getSetting<string>("sheetSyncUrl", ""),
    secret: await getSetting<string>("sheetSyncSecret", ""),
  };
}

// Google Sheets sync is OPTIONAL and off until the user configures it in Settings.
// Local + file backup is the default.
export async function syncEnabled(): Promise<boolean> {
  return getSetting<boolean>("syncEnabled", false);
}

async function post(url: string, payload: unknown): Promise<SyncResult> {
  const body = JSON.stringify(payload);
  // Native: use the OS HTTP stack (no WebView CORS, follows the Apps Script
  // redirect natively). Web: plain fetch with the text/plain "simple request".
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      data: body,
      connectTimeout: 15000, // don't hang Finish forever on a black-hole network
      readTimeout: 20000,
    });
    if (res.status >= 400) return { ok: false, error: `HTTP ${res.status}` };
    return (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as SyncResult;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000); // don't hang Finish on a dead network
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return (await res.json()) as SyncResult;
  } finally {
    clearTimeout(timer);
  }
}

export function syncConfigured(url: string): boolean {
  return !!url.trim();
}

export async function testSync(): Promise<SyncResult> {
  const { url, secret } = await config();
  if (!url) return { ok: false, error: "No sync URL set" };
  try {
    return await post(url, { secret, ping: true });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// "6→8", "6→", "→8", or "" when neither is set.
function moodStr(row: StoredWorkout): string {
  if (row.moodBefore == null && row.moodAfter == null) return "";
  return `${row.moodBefore ?? ""}→${row.moodAfter ?? ""}`;
}

// Seconds → "1:05:00" (h:mm:ss, hours always shown for an unambiguous sheet cell).
function durationStr(sec?: number): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Serialize all workout pushes: the finish-time push and a concurrent "Sync now"
// (or double-tap) must not race — combined with the server's same-date column
// reuse this makes duplicate columns impossible.
let syncChain: Promise<unknown> = Promise.resolve();

export function syncWorkout(row: StoredWorkout): Promise<SyncResult | null> {
  const next = syncChain.then(() => syncWorkoutNow(row));
  syncChain = next.catch(() => {}); // keep the chain alive after failures
  return next;
}

async function syncWorkoutNow(row: StoredWorkout): Promise<SyncResult | null> {
  if (!(await syncEnabled())) return null; // sync turned off — local + file backup only
  const { url, secret } = await config();
  if (!url) return null; // sync not set up — silently skip
  // A queued push may have been superseded (the same row already synced by the
  // push ahead of it in the chain) — re-check the live row, don't push twice.
  if (row.id != null) {
    const live = await db.workouts.get(row.id);
    if (live?.synced) return { ok: true };
  }
  const run = computeRun(row.track); // GPS-tracked cardio → distance/pace/speed/route
  // Encode the whole path (thinned) into a link that opens our in-app map viewer.
  const routeLink =
    run && row.track && row.track.length >= 2
      ? `${APP_PUBLIC_URL}/#route=${encodeURIComponent(
          encodePolyline(downsample(row.track.map((p) => [p.lat, p.lng] as [number, number]), 250)),
        )}`
      : "";
  const payload = {
    secret,
    year: localDay(row.date).slice(0, 4), // local day decides the year TAB too
    dayName: row.dayName,
    date: fmtDate(row.date),
    note: row.note ?? "",
    mood: moodStr(row),
    time: durationStr(row.durationSec),
    timeOfDay: timeOfDayStr(row.date),
    hr: row.avgHr != null ? String(row.avgHr) : "",
    distance: run ? fmtDist(run.distanceM) : "",
    pace: run ? fmtPace(run.avgPaceSecPerKm) : "",
    speed: run ? `${run.avgSpeedKmh.toFixed(1)} km/h` : "",
    route: routeLink,
    allowCreate: true, // Alternative/free-form sessions → auto-create a named block
    exercises: row.exercises.map((e) => ({ name: e.name, cell: cellFor(e) })).filter((e) => e.cell !== ""),
  };
  try {
    const result = await post(url, payload);
    // Only mark synced if the sheet took ALL the exercises. A name mismatch returns
    // ok:true with that exercise in skipped:[] — a half-written session must stay
    // pending (and say so), or the skipped lift's history silently never reaches
    // the sheet again. Retries are safe: the server reuses the same-date column.
    const wroteExercises = (result.written?.length ?? 0) > 0;
    const nothingToWrite = payload.exercises.length === 0;
    const skipped = result.skipped ?? [];
    if (result.ok && (wroteExercises || nothingToWrite) && skipped.length === 0 && row.id != null) {
      await db.workouts.update(row.id, { synced: true });
    }
    if (result.ok && skipped.length > 0) {
      return {
        ...result,
        ok: false,
        error: `The sheet has no row for: ${skipped.join(", ")} — rename the sheet row (or the exercise) and retry from Settings → Sync now.`,
      };
    }
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Count app-logged sessions not yet written to the sheet (0 when sync is off).
export async function pendingCount(): Promise<number> {
  if (!(await syncEnabled())) return 0;
  const rows = await db.workouts.where("source").equals("app").toArray();
  return rows.filter((r) => !r.synced).length;
}

// Retry all unsynced app sessions (oldest first).
export async function syncPending(): Promise<{ done: number; failed: number }> {
  if (!(await syncEnabled())) return { done: 0, failed: 0 };
  const rows = (await db.workouts.where("source").equals("app").toArray())
    .filter((r) => !r.synced)
    .sort((a, b) => a.date.localeCompare(b.date));
  let done = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await syncWorkout(r);
    if (res?.ok) done++;
    else failed++;
  }
  return { done, failed };
}

// Pull every workout from the sheet and add any this device is missing
// (deduped by day + date), e.g. sessions logged elsewhere since the last import.
export async function importFromSheet(): Promise<{ added: number; bwYears?: number; error?: string }> {
  const { url, secret } = await config();
  if (!url) return { added: 0, error: "No sync URL set" };
  try {
    const res = await post(url, { secret, action: "pull" });
    if (!res.ok || !res.tabs) return { added: 0, error: res.error || "Import failed" };

    // Bodyweight lives in its own tab — parse it separately, not as a workout block.
    const bwYears = res.tabs[BODYWEIGHT_TAB] ? await mergeBodyweight(res.tabs[BODYWEIGHT_TAB]) : 0;
    // Profile (age/sex) likewise — pull it back so a reinstall restores it.
    if (res.tabs[PROFILE_TAB]) await mergeProfile(res.tabs[PROFILE_TAB]);

    const parsed = Object.entries(res.tabs)
      .filter(([name]) => name !== BODYWEIGHT_TAB)
      .flatMap(([name, rows]) => parseSheet(rows, name));
    const existing = await db.workouts.toArray();
    const have = new Set(existing.flatMap(sessionKeys)); // incl. legacy UTC-day keys
    const cutoff = localDay(new Date(Date.now() + 2 * 86400000).toISOString()); // drop future typos

    const toAdd: StoredWorkout[] = [];
    for (const w of parsed) {
      if (w.date > cutoff) continue;
      const k = sessionKey(w);
      if (have.has(k)) continue;
      have.add(k);
      toAdd.push({
        date: w.date,
        dayName: w.dayName,
        exercises: w.exercises,
        note: w.note,
        moodBefore: w.moodBefore,
        moodAfter: w.moodAfter,
        durationSec: w.durationSec,
        avgHr: w.avgHr,
        source: `sheet:${w.source ?? "?"}`,
        synced: true,
      });
    }
    if (toAdd.length) await db.workouts.bulkAdd(toAdd);
    return { added: toAdd.length, bwYears };
  } catch (e) {
    return { added: 0, error: (e as Error).message };
  }
}

// Read the Bodyweight tab and reconcile it into local settings: past years fill
// "bwHistory", the current year sets "bodyweightKg". Sheet values win on conflict.
async function mergeBodyweight(rows: string[][]): Promise<number> {
  const entries = parseBodyweightTab(rows);
  if (entries.length === 0) return 0;
  const thisYear = new Date().getFullYear();
  const current = entries.find((e) => e.year === thisYear);
  if (current) await setSetting("bodyweightKg", current.kg);
  // Merge sheet years over existing local history (sheet wins per year) instead of
  // replacing — a partial sheet must not wipe local years not yet pushed.
  const existing = await getSetting<BwEntry[]>("bwHistory", []);
  const byYear = new Map<number, number>(existing.map((e) => [e.year, e.kg]));
  for (const e of entries) if (e.year !== thisYear) byYear.set(e.year, e.kg);
  const history: BwEntry[] = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, kg]) => ({ year, kg }));
  await setSetting("bwHistory", history);
  return entries.length;
}

// Push the full bodyweight-by-year table to its own sheet tab (upsert).
export async function syncBodyweight(): Promise<SyncResult | null> {
  const { url, secret } = await config();
  if (!url) return null;
  const history = await getSetting<BwEntry[]>("bwHistory", []);
  const currentKg = await getSetting<number>("bodyweightKg", 0);
  const thisYear = new Date().getFullYear();
  const map = new Map<number, number>(history.map((e) => [e.year, e.kg]));
  if (currentKg > 0) map.set(thisYear, currentKg);
  const entries = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, kg]) => ({ year, kg }));
  if (entries.length === 0) return null;
  try {
    return await post(url, { secret, action: "bodyweight", tab: BODYWEIGHT_TAB, entries });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Push the user's profile (age/sex) to its own sheet tab (upsert). Mirrors
// syncBodyweight; call it whenever age/sex change.
export async function syncProfile(): Promise<SyncResult | null> {
  const { url, secret } = await config();
  if (!url) return null;
  const age = await getSetting<number>("age", 0);
  const sex = await getSetting<string>("sex", "");
  if (!age && !sex) return null;
  try {
    return await post(url, { secret, action: "profile", tab: PROFILE_TAB, age: age || "", sex });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Read the Profile tab (Key | Value) and set age/sex locally (sheet wins).
async function mergeProfile(rows: string[][]): Promise<void> {
  for (const r of rows.slice(1)) {
    const key = String(r?.[0] ?? "").trim().toLowerCase();
    const val = String(r?.[1] ?? "").trim();
    if (!val) continue;
    if (key === "age") {
      const n = parseInt(val, 10);
      if (Number.isFinite(n) && n > 0) await setSetting("age", n);
    } else if (key === "sex") {
      const s = val.toLowerCase();
      if (s === "male" || s === "female") await setSetting("sex", s);
    }
  }
}
