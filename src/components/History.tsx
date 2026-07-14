// History: past workouts grouped into collapsible periods (week / month / year)
// with type + text filtering. Tap a workout row to expand its exercises, sets,
// notes, duration, HR and (for runs) the route map.
import { Suspense, lazy, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type StoredWorkout } from "../db";
import { daysAgoLabel, hhmmss, niceDate } from "../lib/format";
import { computeRun, fmtDist, fmtPace } from "../lib/runStats";
import { type WeightUnit, weightStr } from "../lib/units";
// Lazy so Leaflet (+CSS) only loads when a run's map is actually shown.
const RunMap = lazy(() => import("./RunMap").then((m) => ({ default: m.RunMap })));

type GroupBy = "week" | "month" | "year";
const GROUPS: GroupBy[] = ["week", "month", "year"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const setsOf = (w: StoredWorkout) => w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.weight != null).length, 0);

// Monday-anchored key ("YYYY-MM-DD") for the week a date falls in — built from
// local Y/M/D parts to avoid UTC-parse drift.
function weekMondayKey(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // back to Monday
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

const groupKey = (iso: string, by: GroupBy) =>
  by === "year" ? iso.slice(0, 4) : by === "month" ? iso.slice(0, 7) : weekMondayKey(iso);

function groupLabel(key: string, by: GroupBy): string {
  if (by === "year") return key;
  if (by === "month") {
    const [y, m] = key.split("-");
    return `${MONTHS[+m - 1]} ${y}`;
  }
  return `Week of ${niceDate(key)}`;
}

export function History({ onEdit, units }: { onEdit: (w: StoredWorkout) => void; units: WeightUnit }) {
  const workouts = useLiveQuery(() => db.workouts.orderBy("date").reverse().toArray(), []);
  const [openId, setOpenId] = useState<number | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");

  const types = useMemo(
    () => (workouts ? [...new Set(workouts.map((w) => w.dayName))].sort() : []),
    [workouts],
  );

  const filtered = useMemo(() => {
    if (!workouts) return [];
    const q = query.trim().toLowerCase();
    return workouts.filter((w) => {
      if (type !== "all" && w.dayName !== type) return false;
      if (!q) return true;
      return (
        w.dayName.toLowerCase().includes(q) ||
        !!w.note?.toLowerCase().includes(q) ||
        w.exercises.some((e) => e.name.toLowerCase().includes(q))
      );
    });
  }, [workouts, type, query]);

  // Preserve newest-first order: `filtered` is already reversed, and Map keeps
  // insertion order, so groups come out newest-period-first.
  const groups = useMemo(() => {
    const map = new Map<string, StoredWorkout[]>();
    for (const w of filtered) {
      const k = groupKey(w.date, groupBy);
      const arr = map.get(k);
      if (arr) arr.push(w);
      else map.set(k, [w]);
    }
    return [...map].map(([key, items]) => ({
      key,
      label: groupLabel(key, groupBy),
      items,
      sets: items.reduce((a, w) => a + setsOf(w), 0),
    }));
  }, [filtered, groupBy]);

  if (!workouts) return <div className="pad">Loading…</div>;
  if (workouts.length === 0) return <div className="pad muted">No workouts yet — log your first one!</div>;

  const active = type !== "all" || query.trim() !== "";

  return (
    <div className="pad history">
      <h2>History</h2>
      <p className="muted tiny">
        {filtered.length}
        {active ? ` of ${workouts.length}` : ""} workout{filtered.length === 1 ? "" : "s"}
      </p>

      <div className="hist-controls">
        <div className="seg" role="group" aria-label="Group by">
          {GROUPS.map((g) => (
            <button key={g} className={groupBy === g ? "active" : ""} onClick={() => setGroupBy(g)}>
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
        <div className="hist-row2">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="all">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search exercise or note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {active && (
            <button
              className="mini"
              onClick={() => {
                setType("all");
                setQuery("");
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="muted pad">No workouts match your filters.</p>
      ) : (
        groups.map((g, gi) => (
          <details key={groupBy + g.key} className="hist-group" open={gi === 0}>
            <summary>
              <span className="hist-group-label">{g.label}</span>
              <span className="tiny muted">
                {g.items.length} session{g.items.length === 1 ? "" : "s"} · {g.sets} sets
              </span>
            </summary>
            <div className="log">
              {g.items.map((w) => (
                <LogRow
                  key={w.id}
                  w={w}
                  open={openId === w.id}
                  onToggle={() => setOpenId(openId === w.id ? null : w.id!)}
                  onEdit={onEdit}
                  units={units}
                />
              ))}
            </div>
          </details>
        ))
      )}
    </div>
  );
}

function LogRow({
  w,
  open,
  onToggle,
  onEdit,
  units,
}: {
  w: StoredWorkout;
  open: boolean;
  onToggle: () => void;
  onEdit: (w: StoredWorkout) => void;
  units: WeightUnit;
}) {
  const nSets = setsOf(w);
  return (
    <div className={`log-row ${open ? "open" : ""}`}>
      <button className="log-head" onClick={onToggle}>
        <span className="log-info">
          <span className="log-day">{w.dayName}</span>
          <span className="tiny muted">
            {niceDate(w.date)} · {daysAgoLabel(w.date)}
          </span>
        </span>
        <span className="tiny muted log-count">
          {w.exercises.length} ex · {nSets} sets
        </span>
      </button>

      {open && (
        <div className="log-detail">
          {w.track && w.track.length >= 2 && <RunDetail track={w.track} />}
          {w.note && <div className="log-note">📝 {w.note}</div>}
          {w.exercises.map((e, i) => {
            const sets = e.sets.filter((s) => s.weight != null);
            return (
              <div key={i} className="log-ex">
                <span className="log-ex-name">{e.name}</span>
                <span className="log-ex-sets">
                  {sets.length
                    ? sets
                        .map((s) => `${weightStr(s.weight as number, units)}${s.reps ? `×${s.reps}` : ""}${s.assist != null ? `(${s.assist})` : ""}`)
                        .join(" · ")
                    : e.skipped
                      ? "skipped"
                      : "—"}
                </span>
              </div>
            );
          })}
          {(w.durationSec || w.moodBefore || w.moodAfter) && (
            <div className="tiny muted log-meta">
              {w.durationSec ? `⏱ ${Math.round(w.durationSec / 60)} min` : ""}
              {w.avgHr ? ` · ♥ ${w.avgHr} avg${w.maxHr ? ` / ${w.maxHr} max` : ""}` : ""}
              {w.moodBefore || w.moodAfter ? ` · 🙂 ${w.moodBefore ?? "–"}→${w.moodAfter ?? "–"}/10` : ""}
            </div>
          )}
          <div className="row log-actions">
            <button className="mini" onClick={() => onEdit(w)}>
              ✎ Edit
            </button>
            <button
              className="mini danger"
              onClick={() => {
                if (confirm(`Delete this ${w.dayName} workout from ${niceDate(w.date)}? This can't be undone.`))
                  db.workouts.delete(w.id!);
              }}
            >
              🗑 Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RunDetail({ track }: { track: NonNullable<StoredWorkout["track"]> }) {
  const s = computeRun(track);
  if (!s) return null;
  return (
    <div className="run-detail">
      <Suspense fallback={<div className="run-map" />}>
        <RunMap track={track} />
      </Suspense>
      <div className="run-stats">
        <div className="run-stat">
          <span className="run-stat-v">{fmtDist(s.distanceM)}</span>
          <span className="run-stat-l">distance</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-v">{hhmmss(s.durationSec)}</span>
          <span className="run-stat-l">time</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-v">{fmtPace(s.avgPaceSecPerKm)}</span>
          <span className="run-stat-l">avg pace</span>
        </div>
        <div className="run-stat">
          <span className="run-stat-v">{s.avgSpeedKmh.toFixed(1)}</span>
          <span className="run-stat-l">km/h</span>
        </div>
        {s.avgHr != null && (
          <div className="run-stat">
            <span className="run-stat-v">♥ {s.avgHr}</span>
            <span className="run-stat-l">avg / {s.maxHr} max</span>
          </div>
        )}
      </div>
    </div>
  );
}
