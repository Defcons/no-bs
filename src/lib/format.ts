// Small formatting helpers.
export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function hhmmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

// "2024-03-15" / ISO -> "15 Mar 2024"
export function niceDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// Local "HH:MM" clock time for an ISO datetime that carries a time component
// (app-logged sessions store a full timestamp); "" for a bare "yyyy-mm-dd" (e.g.
// sheet imports), so History doesn't show a meaningless 00:00 for those.
export function clockTime(iso: string): string {
  if (!iso || !iso.includes("T")) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Whole calendar days between that date and today, in LOCAL time. (Date.parse of a
// "yyyy-mm-dd" string is UTC midnight, so subtracting epochs and rounding gave an
// off-by-one in timezones ahead of UTC — e.g. yesterday reading as "2 days ago".)
export function daysAgo(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((today - then) / 86400000));
}

// "today" / "yesterday" / "N days ago"
export function daysAgoLabel(iso: string): string {
  const d = daysAgo(iso);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function ago(iso: string): string {
  const days = daysAgo(iso);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}
