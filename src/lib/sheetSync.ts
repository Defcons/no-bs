// Write finished workouts back to the Google Sheet via a bound Apps Script Web
// App (see apps-script/Code.gs). The app POSTs the session; the script finds the
// right year tab + day-block and writes a new dated column in the sheet's own
// transposed layout (see reference_gym_sheet). No OAuth / backend needed.
//
// CORS note: we send Content-Type text/plain so the browser makes a "simple"
// request (no preflight); Apps Script's redirected response carries ACAO:*.
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { db, getSetting, setSetting, type StoredWorkout } from "../db";
import { parseBodyweightTab, parseSheet } from "./sheet";
import { computeRun, fmtDist, fmtPace } from "./runStats";
import { downsample, encodePolyline } from "./polyline";
import type { BwEntry } from "./standards";
import type { ExercisePerf } from "../types";
import { APP_PUBLIC_URL, DEFAULT_SYNC_SECRET, DEFAULT_SYNC_URL } from "./syncConfig";

const BODYWEIGHT_TAB = "Bodyweight";

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

// Reconstruct a sheet cell like "72,5-70-70" or "70-70-70(2)".
// Assisted/extra reps are written in parentheses, matching the owner's sheet style.
export function cellFor(ex: ExercisePerf): string {
  if (ex.skipped) return "x";
  return ex.sets
    .filter((s) => s.weight != null || s.reps != null)
    .map((s) => {
      // Bodyweight set (reps only, no weight) → "(reps)", which parseCell reads back.
      if (s.weight == null) return s.reps != null ? `(${s.reps})` : "";
      let t = fmtNum(s.weight);
      if (s.assist != null) t += `(${s.assist})`;
      return t;
    })
    .filter((t) => t !== "")
    .join("-");
}

// ISO date -> "dd.mm.yy" (the sheet's header format).
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

async function config(): Promise<{ url: string; secret: string }> {
  // Per-device Settings override the built-in defaults.
  return {
    url: (await getSetting<string>("sheetSyncUrl", "")) || DEFAULT_SYNC_URL,
    secret: (await getSetting<string>("sheetSyncSecret", "")) || DEFAULT_SYNC_SECRET,
  };
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

export async function syncWorkout(row: StoredWorkout): Promise<SyncResult | null> {
  const { url, secret } = await config();
  if (!url) return null; // sync not set up — silently skip
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
    year: row.date.slice(0, 4),
    dayName: row.dayName,
    date: fmtDate(row.date),
    note: row.note ?? "",
    mood: moodStr(row),
    time: durationStr(row.durationSec),
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
    // Only mark synced if the sheet actually took the exercises (a name mismatch
    // returns ok:true with written:[] — don't silently claim success then).
    const wroteExercises = (result.written?.length ?? 0) > 0;
    const nothingToWrite = payload.exercises.length === 0;
    if (result.ok && (wroteExercises || nothingToWrite) && row.id != null) {
      await db.workouts.update(row.id, { synced: true });
    }
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Count app-logged sessions not yet written to the sheet.
export async function pendingCount(): Promise<number> {
  const rows = await db.workouts.where("source").equals("app").toArray();
  return rows.filter((r) => !r.synced).length;
}

// Retry all unsynced app sessions (oldest first).
export async function syncPending(): Promise<{ done: number; failed: number }> {
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

    const parsed = Object.entries(res.tabs)
      .filter(([name]) => name !== BODYWEIGHT_TAB)
      .flatMap(([name, rows]) => parseSheet(rows, name));
    const existing = await db.workouts.toArray();
    const key = (dayName: string, iso: string) => `${dayName}@@${iso.slice(0, 10)}`;
    const have = new Set(existing.map((w) => key(w.dayName, w.date)));
    const cutoff = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10); // drop future typos

    const toAdd: StoredWorkout[] = [];
    for (const w of parsed) {
      if (w.date > cutoff) continue;
      const k = key(w.dayName, w.date);
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
