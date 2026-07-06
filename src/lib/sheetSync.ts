// Write finished workouts back to the Google Sheet via a bound Apps Script Web
// App (see apps-script/Code.gs). The app POSTs the session; the script finds the
// right year tab + day-block and writes a new dated column in the sheet's own
// transposed layout (see reference_gym_sheet). No OAuth / backend needed.
//
// CORS note: we send Content-Type text/plain so the browser makes a "simple"
// request (no preflight); Apps Script's redirected response carries ACAO:*.
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { db, getSetting, type StoredWorkout } from "../db";
import type { ExercisePerf } from "../types";
import { DEFAULT_SYNC_SECRET, DEFAULT_SYNC_URL } from "./syncConfig";

export type SyncResult = {
  ok: boolean;
  error?: string;
  column?: number;
  written?: string[];
  skipped?: string[];
  noteWritten?: boolean;
  ping?: boolean;
};

// Norwegian decimal comma, matching how the sheet is written (72.5 -> "72,5").
const fmtNum = (n: number): string => String(n).replace(".", ",");

// Reconstruct a sheet cell like "72,5-70-70" or "70-70-70(2)".
// Assisted/extra reps are written in parentheses, matching the owner's sheet style.
export function cellFor(ex: ExercisePerf): string {
  if (ex.skipped) return "x";
  return ex.sets
    .filter((s) => s.weight != null)
    .map((s) => {
      let t = fmtNum(s.weight as number);
      if (s.assist != null) t += `(${s.assist})`;
      return t;
    })
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
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
    redirect: "follow",
  });
  return (await res.json()) as SyncResult;
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

export async function syncWorkout(row: StoredWorkout): Promise<SyncResult | null> {
  const { url, secret } = await config();
  if (!url) return null; // sync not set up — silently skip
  const payload = {
    secret,
    year: row.date.slice(0, 4),
    dayName: row.dayName,
    date: fmtDate(row.date),
    note: row.note ?? "",
    exercises: row.exercises.map((e) => ({ name: e.name, cell: cellFor(e) })).filter((e) => e.cell !== ""),
  };
  try {
    const result = await post(url, payload);
    if (result.ok && row.id != null) await db.workouts.update(row.id, { synced: true });
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
