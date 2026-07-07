// Excel (.xlsx) backup of the whole history, laid out like the Google Sheet you
// already use — one tab per year (transposed: dates across columns, exercises as
// rows, Note/Mood/Time/Avg HR/Distance/Pace/Speed meta rows) + a Bodyweight tab.
//
// A HIDDEN "_data" tab carries the lossless JSON (incl. GPS tracks) so restore is
// perfect; the visible tabs stay human-readable/editable and parse back through the
// existing sheet.ts parser. SheetJS is imported lazily so it stays out of the main
// bundle.
import { db, getSetting, setSetting, type StoredWorkout } from "../db";
import type { BwEntry } from "./standards";
import type { Scheme } from "../types";
import { cellFor } from "./sheetSync";
import { computeRun, fmtDist, fmtPace } from "./runStats";
import { parseBodyweightTab, parseSheet } from "./sheet";

export type SheetTab = { name: string; rows: string[][] };

const DATA_TAB = "_data";

const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y.slice(2)}`;
};

const schemeLabel = (name: string, scheme?: Scheme): string =>
  scheme && scheme.sets != null && scheme.reps != null ? `${scheme.sets}x${scheme.reps} ${name}` : name;

const moodStr = (w: StoredWorkout): string =>
  w.moodBefore == null && w.moodAfter == null ? "" : `${w.moodBefore ?? ""}→${w.moodAfter ?? ""}`;

const durationStr = (sec?: number): string => {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

// A meta row, added only if at least one session has a value.
function metaRow(label: string, cells: string[]): string[] | null {
  return cells.some((c) => c !== "") ? [label, ...cells] : null;
}

function yearRows(list: StoredWorkout[]): string[][] {
  const rows: string[][] = [];
  const byDay = new Map<string, StoredWorkout[]>();
  for (const w of list) {
    const arr = byDay.get(w.dayName) ?? [];
    arr.push(w);
    byDay.set(w.dayName, arr);
  }
  let first = true;
  for (const [dayName, sessions] of byDay) {
    sessions.sort((a, b) => a.date.localeCompare(b.date));
    if (!first) rows.push([]); // spacer between blocks
    first = false;

    rows.push([dayName, ...sessions.map((s) => fmtDate(s.date))]);

    // Exercises in first-seen order across the block's sessions.
    const order: string[] = [];
    const schemeByName = new Map<string, Scheme>();
    for (const s of sessions)
      for (const e of s.exercises)
        if (!schemeByName.has(e.name)) {
          order.push(e.name);
          schemeByName.set(e.name, e.scheme);
        }
    for (const name of order) {
      const cells = sessions.map((s) => {
        const e = s.exercises.find((x) => x.name === name);
        return e ? cellFor(e) : "";
      });
      rows.push([schemeLabel(name, schemeByName.get(name)), ...cells]);
    }

    for (const r of [
      metaRow("Note", sessions.map((s) => s.note ?? "")),
      metaRow("Mood", sessions.map(moodStr)),
      metaRow("Time", sessions.map((s) => durationStr(s.durationSec))),
      metaRow("Avg HR", sessions.map((s) => (s.avgHr != null ? String(s.avgHr) : ""))),
    ])
      if (r) rows.push(r);

    // Cardio rows only if any session in the block has a GPS track.
    const runs = sessions.map((s) => computeRun(s.track));
    if (runs.some(Boolean)) {
      rows.push(["Distance", ...runs.map((r) => (r ? fmtDist(r.distanceM) : ""))]);
      rows.push(["Pace", ...runs.map((r) => (r ? fmtPace(r.avgPaceSecPerKm) : ""))]);
      rows.push(["Speed", ...runs.map((r) => (r ? `${r.avgSpeedKmh.toFixed(1)} km/h` : ""))]);
    }
  }
  return rows;
}

export function workbookTabs(workouts: StoredWorkout[], bwHistory: BwEntry[]): SheetTab[] {
  const byYear = new Map<string, StoredWorkout[]>();
  for (const w of workouts) {
    const y = w.date.slice(0, 4);
    const arr = byYear.get(y) ?? [];
    arr.push(w);
    byYear.set(y, arr);
  }
  const tabs: SheetTab[] = [];
  for (const y of [...byYear.keys()].sort()) tabs.push({ name: y, rows: yearRows(byYear.get(y)!) });
  const bw = [...bwHistory].sort((a, b) => a.year - b.year);
  if (bw.length) {
    tabs.push({
      name: "Bodyweight",
      rows: [["Year", "Kg"], ...bw.map((e) => [String(e.year), String(e.kg).replace(".", ",")])],
    });
  }
  return tabs;
}

// Build the .xlsx (visible tabs + hidden lossless _data tab).
export async function exportXlsx(workouts: StoredWorkout[], bwHistory: BwEntry[]): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const tab of workbookTabs(workouts, bwHistory)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tab.rows), tab.name.slice(0, 31));
  }
  const json = JSON.stringify({ v: 1, workouts, bwHistory });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["gym-tracker backup — do not edit"], [json]]), DATA_TAB);
  wb.Workbook = { Sheets: wb.SheetNames.map((n) => (n === DATA_TAB ? { Hidden: 1 } : {})) };
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export type ImportedBackup = { workouts: Partial<StoredWorkout>[]; bwHistory?: BwEntry[] };

// Read a backup. Prefers the lossless _data tab; falls back to parsing the visible
// tabs (so a hand-made / Google-exported .xlsx still imports).
export async function importXlsx(buf: ArrayBuffer): Promise<ImportedBackup> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const aoa = (name: string): string[][] =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" }) as string[][];

  if (wb.SheetNames.includes(DATA_TAB)) {
    const rows = aoa(DATA_TAB);
    const json = rows?.[1]?.[0];
    if (json) {
      try {
        const parsed = JSON.parse(json) as { workouts?: StoredWorkout[]; bwHistory?: BwEntry[] };
        if (parsed.workouts) return { workouts: parsed.workouts, bwHistory: parsed.bwHistory };
      } catch {
        /* fall through to parsing visible tabs */
      }
    }
  }

  const workouts = wb.SheetNames.filter((n) => n !== DATA_TAB && n !== "Bodyweight").flatMap((n) => parseSheet(aoa(n), n));
  const bwHistory = wb.SheetNames.includes("Bodyweight")
    ? parseBodyweightTab(aoa("Bodyweight")).map((e) => ({ year: e.year, kg: e.kg }))
    : undefined;
  return { workouts, bwHistory };
}

// Apply a restore: add only workouts this device is missing (deduped by day+date),
// and merge bodyweight years (imported wins per year). Never overwrites or deletes.
export async function applyBackup(imported: ImportedBackup): Promise<{ added: number; bwYears: number }> {
  const existing = await db.workouts.toArray();
  const key = (day: string, iso: string) => `${day}@@${iso.slice(0, 10)}`;
  const have = new Set(existing.map((w) => key(w.dayName, w.date)));
  const toAdd: StoredWorkout[] = [];
  for (const w of imported.workouts) {
    if (!w.dayName || !w.date) continue;
    const k = key(w.dayName, w.date);
    if (have.has(k)) continue;
    have.add(k);
    const { id: _id, ...rest } = w as StoredWorkout;
    void _id;
    toAdd.push({ ...rest, source: rest.source ?? "restore", synced: rest.synced ?? true } as StoredWorkout);
  }
  if (toAdd.length) await db.workouts.bulkAdd(toAdd);

  let bwYears = 0;
  if (imported.bwHistory?.length) {
    const thisYear = new Date().getFullYear();
    const existingBw = await getSetting<BwEntry[]>("bwHistory", []);
    const byYear = new Map<number, number>(existingBw.map((e) => [e.year, e.kg]));
    for (const e of imported.bwHistory) byYear.set(e.year, e.kg);
    const cur = imported.bwHistory.find((e) => e.year === thisYear);
    if (cur) await setSetting("bodyweightKg", cur.kg);
    const hist = [...byYear.entries()]
      .filter(([y]) => y !== thisYear)
      .sort((a, b) => a[0] - b[0])
      .map(([year, kg]) => ({ year, kg }));
    await setSetting("bwHistory", hist);
    bwYears = imported.bwHistory.length;
  }
  return { added: toAdd.length, bwYears };
}
