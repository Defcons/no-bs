// Parser for the owner's "Trening" Google Sheet (see reference_gym_sheet).
// The sheet is transposed: dates run across columns, exercises are rows grouped
// under a day-block header. Two historical layouts exist and both are handled:
//   - 2018-2019: label split over two cols ("3x5" | "Benkpress"), dates from col 2,
//                reps as "110x3", Norwegian decimal commas ("107,5").
//   - 2021+:     combined label ("3x5 Bench"), dates from col 1, reps as "(7)"/"(4+1)".

import type { ExercisePerf, Scheme, SetEntry, Workout } from "../types";

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // ignore
      } else cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// dd.mm.yy or dd.mm.yyyy, tolerating trailing text like "12.02.24(post)".
const DATE_RE = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;

export function parseDate(s: string): string | null {
  const m = s.match(DATE_RE);
  if (!m) return null;
  const d = +m[1];
  const mo = +m[2];
  let y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isDateCell(s: string): boolean {
  return parseDate(s) != null;
}

// Split a leading scheme like "3x5", "3x8", "3xMax", "3x10 Bench" from the name.
const SCHEME_RE = /^\s*(\d+)\s*[xX]\s*(\d+|Max|max|MAX)\b\s*(.*)$/;

export function parseScheme(label: string): { scheme: Scheme; name: string } {
  const m = label.match(SCHEME_RE);
  if (!m) return { scheme: { sets: null, reps: null }, name: label.trim() };
  const reps: number | "Max" = /max/i.test(m[2]) ? "Max" : +m[2];
  return { scheme: { sets: +m[1], reps }, name: m[3].trim() };
}

function num(s: string): number | null {
  // Norwegian decimal comma -> dot. Extract the first number in the token.
  const cleaned = s.replace(",", ".");
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Parse one cell (one session's performance for one exercise) into sets.
// Returns { sets, skipped }. Sets are dash-separated tokens like "70(6)", "110x3".
export function parseCell(raw: string): { sets: SetEntry[]; skipped: boolean } {
  const t = (raw ?? "").trim();
  if (t === "") return { sets: [], skipped: false };
  if (/^x+$/i.test(t)) return { sets: [], skipped: true };

  // Whole-cell rep override like "60-65-70 (3x8)" -> reps 8 for all sets.
  let wholeReps: number | null = null;
  const whole = t.match(/\((\d+)\s*[xX]\s*(\d+)\)/);
  const body = whole ? t.replace(whole[0], "").trim() : t;
  if (whole) wholeReps = +whole[2];

  const tokens = body.split("-").map((x) => x.trim()).filter((x) => x.length > 0);
  const sets: SetEntry[] = [];
  for (const tok of tokens) {
    const weight = num(tok);
    let reps: number | null = wholeReps;
    // "(7)" or "(4+1)" -> reps 7 / 4 (first number is the clean reps)
    const paren = tok.match(/\((\d+)(?:\+\d+)?\)/);
    if (paren) reps = +paren[1];
    // trailing "xN" reps, e.g. "110x3" (but not part of a "(3x8)" already stripped)
    const xr = tok.match(/[xX](\d+)\b(?!\s*\))/);
    if (xr) reps = +xr[1];
    sets.push({ weight, reps, raw: tok });
  }
  return { sets, skipped: false };
}

const NOTE_LABELS = new Set(["note", "notes", "notat", "notater"]);
const MOOD_LABELS = new Set(["mood", "feeling", "humør", "form"]);
const TIME_LABELS = new Set(["time", "tid", "duration", "varighet"]);
const HR_LABELS = new Set(["avg hr", "hr", "puls", "avg puls", "heart rate", "snittpuls"]);

// "6→8" / "6->8" / "6-8" → { before: 6, after: 8 }. Single number → before only.
function parseMood(txt: string): { before?: number; after?: number } {
  const m = txt.match(/(\d+)\s*(?:→|->|-|\/)\s*(\d+)/);
  if (m) return { before: +m[1], after: +m[2] };
  const one = txt.match(/\d+/);
  return one ? { before: +one[0] } : {};
}

// "1:05:00" / "45:30" / "65 min" → seconds.
function parseDuration(txt: string): number | null {
  const parts = txt.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (parts) {
    const a = +parts[1];
    const b = +parts[2];
    const c = parts[3] != null ? +parts[3] : null;
    return c != null ? a * 3600 + b * 60 + c : a * 60 + b; // h:mm:ss or mm:ss
  }
  const min = txt.match(/(\d+)\s*min/i);
  return min ? +min[1] * 60 : null;
}

// Parse one year's sheet (rows) into a list of workouts (one per block-column session).
export function parseSheet(rows: string[][], source: string): Workout[] {
  // A "workout key" = dayName + date column; accumulate exercises under it.
  const workouts = new Map<string, Workout>();
  const key = (day: string, date: string) => `${day}@@${date}`;

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    // Detect a block header: the row containing date cells.
    const dateCols: number[] = [];
    row.forEach((c, idx) => {
      if (isDateCell(c)) dateCols.push(idx);
    });
    if (dateCols.length === 0) {
      i++;
      continue;
    }
    const dateStart = dateCols[0];
    // Day name = non-empty label cells before the first date, minus "Dag N".
    const dayName =
      row
        .slice(0, dateStart)
        .map((c) => c.trim())
        .filter((c) => c && !/^dag\s*\d+$/i.test(c))
        .join(" ") || "Workout";
    const colDate = new Map<number, string>();
    for (const c of dateCols) {
      const d = parseDate(row[c]);
      if (d) colDate.set(c, d);
    }

    // Consume following rows until the next header (row with date cells) or EOF.
    let j = i + 1;
    for (; j < rows.length; j++) {
      const r = rows[j];
      if (r.some((c) => isDateCell(c))) break; // next block header
      const label0 = (r[0] ?? "").trim();
      const label1 = (r[1] ?? "").trim();
      const low0 = label0.toLowerCase();

      if (NOTE_LABELS.has(low0)) {
        for (const [col, date] of colDate) {
          const txt = (r[col] ?? "").trim();
          if (!txt) continue;
          const w = workouts.get(key(dayName, date));
          if (w) w.note = w.note ? `${w.note}\n${txt}` : txt;
        }
        continue;
      }

      if (MOOD_LABELS.has(low0)) {
        for (const [col, date] of colDate) {
          const txt = (r[col] ?? "").trim();
          if (!txt) continue;
          const w = workouts.get(key(dayName, date));
          if (!w) continue;
          const { before, after } = parseMood(txt);
          if (before != null) w.moodBefore = before;
          if (after != null) w.moodAfter = after;
        }
        continue;
      }

      if (TIME_LABELS.has(low0)) {
        for (const [col, date] of colDate) {
          const secs = parseDuration((r[col] ?? "").trim());
          const w = workouts.get(key(dayName, date));
          if (w && secs != null) w.durationSec = secs;
        }
        continue;
      }

      if (HR_LABELS.has(low0)) {
        for (const [col, date] of colDate) {
          const n = parseInt((r[col] ?? "").trim(), 10);
          const w = workouts.get(key(dayName, date));
          if (w && Number.isFinite(n)) w.avgHr = n;
        }
        continue;
      }

      // Exercise row. Label may be one col ("3x5 Bench") or two ("3x5"|"Benkpress").
      let label = label0;
      if (dateStart >= 2 && label1) label = `${label0} ${label1}`.trim();
      if (!label) continue;
      const { scheme, name } = parseScheme(label);
      if (!name) continue;

      for (const [col, date] of colDate) {
        const cell = r[col] ?? "";
        const { sets, skipped } = parseCell(cell);
        if (!skipped && sets.length === 0 && !cell.trim()) continue; // nothing logged
        const wkey = key(dayName, date);
        let w = workouts.get(wkey);
        if (!w) {
          w = { date, dayName, exercises: [], source };
          workouts.set(wkey, w);
        }
        const perf: ExercisePerf = { name, scheme, sets, skipped };
        w.exercises.push(perf);
      }
    }
    i = j;
  }

  return [...workouts.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Parse the "Bodyweight" tab: rows of [year, kg], header row(s) ignored.
export function parseBodyweightTab(rows: string[][]): { year: number; kg: number }[] {
  const out: { year: number; kg: number }[] = [];
  for (const r of rows) {
    const year = parseInt((r[0] ?? "").trim(), 10);
    const kg = num((r[1] ?? "").trim());
    if (year >= 1990 && year < 2100 && kg != null) out.push({ year, kg });
  }
  return out;
}

export function parseWorkbook(byYear: Record<string, string>): Workout[] {
  const out: Workout[] = [];
  for (const [year, csv] of Object.entries(byYear)) {
    out.push(...parseSheet(parseCSV(csv), year));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
