// History: past workouts grouped into collapsible periods (week / month / year)
// with type + text filtering. Tap a workout row to expand its exercises, sets,
// notes, duration, HR and (for runs) the route map.
import { Suspense, lazy, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type StoredWorkout } from "../db";
import { clockTime, daysAgoLabel, hhmmss, mmss, niceDate } from "../lib/format";
import { computeRun, fmtDist, fmtPace } from "../lib/runStats";
import { resolveExercise } from "../lib/exercises";
import { liftRecords, workoutVolume } from "../lib/stats";
import { sessionKcal } from "../lib/calories";
import type { Sex } from "../lib/standards";
import { type WeightUnit, weightStr } from "../lib/units";
// Lazy so Leaflet (+CSS) only loads when a run's map is actually shown.
const RunMap = lazy(() => import("./RunMap").then((m) => ({ default: m.RunMap })));

type GroupBy = "week" | "month" | "year";

// Custom/"Alternative" sessions often keep the generic "Alternative" name — surface
// what the session actually was (a GPS run with its distance, or its exercises) so
// History reads "5.2 km run" / "Burpees, Box jumps" instead of just "Alternative".
function activityLabel(w: StoredWorkout): string {
  const dn = (w.dayName ?? "").trim();
  if (dn && dn.toLowerCase() !== "alternative") return dn;
  if (w.track && w.track.length > 1) {
    const run = computeRun(w.track);
    if (run) return `${fmtDist(run.distanceM)} run`;
  }
  const names = w.exercises.map((e) => e.name.trim()).filter(Boolean);
  if (names.length) return names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "");
  return dn || "Alternative";
}
const GROUPS: GroupBy[] = ["week", "month", "year"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const setsOf = (w: StoredWorkout) =>
  w.exercises.reduce(
    (a, e) => a + e.sets.filter((s) => s.weight != null || s.reps != null || s.seconds != null || s.distanceM != null).length,
    0,
  );

// A stable colour per split/activity so Push/Pull/Legs (or any custom split) are
// findable by colour when scrolling. Curated hues that read on the dark ground —
// picked by hashing the name, so the same split always gets the same colour.
const SPLIT_COLORS = ["#ff5a2c", "#2fbf71", "#6f86c9", "#c77dff", "#38bdf8", "#f5a623", "#ff6b9d", "#4ade80"];
function splitColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPLIT_COLORS[h % SPLIT_COLORS.length];
}

// Capitalise the first letter ("today" → "Today") for the session's relative date.
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

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

export function History({
  onEdit,
  units,
  bodyweightKg,
  age,
  sex,
}: {
  onEdit: (w: StoredWorkout) => void;
  units: WeightUnit;
  bodyweightKg: number;
  age: number;
  sex: Sex;
}) {
  const workouts = useLiveQuery(() => db.workouts.orderBy("date").reverse().toArray(), []);
  const [openId, setOpenId] = useState<number | null>(null); // expanded to the card view
  const [fullOpen, setFullOpen] = useState(false); // the open card is further expanded to its full detail
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");

  const types = useMemo(
    () => (workouts ? [...new Set(workouts.map((w) => w.dayName))].sort() : []),
    [workouts],
  );
  // Assign each distinct split a colour by its position in the (sorted) list, so
  // splits are always DISTINCT from each other (a name hash can collide — e.g.
  // Pull and Legs landing on the same colour).
  const splitColorMap = useMemo(() => {
    const m = new Map<string, string>();
    types.forEach((t, i) => m.set(t, SPLIT_COLORS[i % SPLIT_COLORS.length]));
    return m;
  }, [types]);

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

  // Largest session by volume (kg lifted) — scales each card's volume bar.
  const maxVol = useMemo(() => Math.max(1, ...filtered.map(workoutVolume)), [filtered]);
  // Days that currently hold an all-time-best est-1RM → which lift(s), for the PR chip
  // + its tap-tooltip ("PR: Bench Press").
  const prByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    if (workouts?.length) {
      for (const r of liftRecords(workouts)) {
        if (r.bestE1rm.est <= 0) continue;
        const d = r.bestE1rm.date.slice(0, 10);
        m.set(d, [...(m.get(d) ?? []), r.name]);
      }
    }
    return m;
  }, [workouts]);

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
                  full={openId === w.id && fullOpen}
                  onToggleCard={() => {
                    const isOpen = openId === w.id;
                    setOpenId(isOpen ? null : w.id!);
                    setFullOpen(false);
                  }}
                  onToggleFull={() => setFullOpen((v) => !v)}
                  onEdit={onEdit}
                  units={units}
                  color={splitColorMap.get(w.dayName) ?? splitColor(w.dayName)}
                  volPct={Math.round((workoutVolume(w) / maxVol) * 100)}
                  prLifts={prByDay.get(w.date.slice(0, 10)) ?? []}
                  kcal={sessionKcal(w.avgHr, w.durationSec, bodyweightKg, age, sex)}
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
  full,
  onToggleCard,
  onToggleFull,
  onEdit,
  units,
  color,
  volPct,
  prLifts,
  kcal,
}: {
  w: StoredWorkout;
  open: boolean;
  full: boolean;
  onToggleCard: () => void;
  onToggleFull: () => void;
  onEdit: (w: StoredWorkout) => void;
  units: WeightUnit;
  color: string;
  volPct: number;
  prLifts: string[];
  kcal: number | null;
}) {
  const nSets = setsOf(w);
  const [prTip, setPrTip] = useState(false); // reveal which lift the PR was in
  return (
    <div className={`sess ${open ? "open" : ""}`} style={{ ["--split" as string]: color }}>
      {!open ? (
        // Compact (default, tidy) — the old one-line look, now colour-coded by split.
        <button className="sess-compact" onClick={onToggleCard}>
          <span className="sc-info">
            <span className="sc-day">{activityLabel(w)}</span>
            <span className="tiny muted">
              {niceDate(w.date)}
              {clockTime(w.date) && ` · ${clockTime(w.date)}`} · {daysAgoLabel(w.date)}
            </span>
          </span>
          <span className="tiny muted sc-count">
            {w.exercises.length} ex · {nSets} sets
          </span>
        </button>
      ) : (
        // Card — stat chips + volume bar; tap the header again to collapse.
        <>
          <button className="sess-head" onClick={onToggleCard}>
            <span className="sess-top">
              <span className="split-title">{activityLabel(w)}</span>
              <span className="when">
                <span className="rel">{capFirst(daysAgoLabel(w.date))}</span>
                <span className="abs">
                  {niceDate(w.date)}
                  {clockTime(w.date) && ` · ${clockTime(w.date)}`}
                </span>
              </span>
            </span>
          </button>
          <div className="chips">
            <span className="chip">
              <span className="num">{w.exercises.length}</span> ex
            </span>
            <span className="chip">
              <span className="num">{nSets}</span> sets
            </span>
            {w.durationSec ? (
              <span className="chip">
                ⏱ <span className="num">{Math.round(w.durationSec / 60)}</span> min
              </span>
            ) : null}
            {prLifts.length ? (
              <button
                type="button"
                className="chip pr"
                title={`PR: ${prLifts.join(", ")}`}
                onClick={() => setPrTip((v) => !v)}
              >
                ★ PR
              </button>
            ) : null}
            {w.avgHr ? (
              <span className="chip hr">
                ♥ <span className="num">{w.avgHr}</span>
              </span>
            ) : null}
            {kcal != null && kcal > 0 ? (
              <span className="chip kcal">
                🔥 <span className="num">{kcal}</span> kcal
              </span>
            ) : null}
            {w.moodBefore || w.moodAfter ? (
              <span className="chip">
                🙂{" "}
                <span className="num">
                  {w.moodBefore ?? "–"}→{w.moodAfter ?? "–"}
                </span>
              </span>
            ) : null}
            {w.breaks?.length ? (
              <span className="chip">
                ⏸ <span className="num">{w.breaks.length}</span>
              </span>
            ) : null}
          </div>
          {prTip && prLifts.length > 0 && <div className="pr-tip-line">★ PR in {prLifts.join(", ")}</div>}
          {volPct > 0 && (
            <div className="volbar">
              <i style={{ width: `${volPct}%` }} />
            </div>
          )}
          <button className="sess-expand" onClick={onToggleFull}>
            {full ? "⌃ Hide exercises" : "⌄ Show exercises"}
          </button>
        </>
      )}

      {full && (
        <div className="log-detail">
          {w.track && w.track.length >= 2 && <RunDetail track={w.track} breaks={w.breaks} />}
          {w.note && <div className="log-note">📝 {w.note}</div>}
          {w.exercises.map((e, i) => {
            const unit = resolveExercise(e.name, e.exerciseId).unit;
            const fmt = (s: (typeof e.sets)[number]) => {
              if (unit === "distance") {
                const km = s.distanceM != null ? `${Number((s.distanceM / 1000).toFixed(2))} km` : "";
                const t = s.seconds != null ? mmss(s.seconds) : "";
                return [km, t].filter(Boolean).join(" · ");
              }
              if (unit === "time") return s.seconds != null ? mmss(s.seconds) : "";
              const a = s.assist != null ? `(${s.assist})` : "";
              if (unit === "bodyweight") {
                if (s.reps != null) return `${s.weight != null ? `+${weightStr(s.weight, units)}×` : ""}${s.reps}${a}`;
                return s.weight != null ? `+${weightStr(s.weight, units)}` : "";
              }
              return s.weight != null ? `${weightStr(s.weight, units)}${s.reps ? `×${s.reps}` : ""}${a}` : "";
            };
            const sets = e.sets.filter((s) =>
              unit === "time"
                ? s.seconds != null
                : unit === "distance"
                  ? s.distanceM != null || s.seconds != null
                  : s.weight != null || s.reps != null,
            );
            return (
              <div key={i} className="log-ex">
                <span className="log-ex-name">{e.name}</span>
                <span className="log-ex-sets">
                  {sets.length ? sets.map(fmt).filter(Boolean).join(" · ") : e.skipped ? "skipped" : "—"}
                </span>
              </div>
            );
          })}
          {(w.durationSec || w.moodBefore || w.moodAfter || w.breaks?.length) && (
            <div className="tiny muted log-meta">
              {w.durationSec ? `⏱ ${Math.round(w.durationSec / 60)} min` : ""}
              {w.avgHr ? ` · ♥ ${w.avgHr} avg${w.maxHr ? ` / ${w.maxHr} max` : ""}` : ""}
              {w.breaks?.length
                ? ` · ⏸ ${w.breaks.length} break${w.breaks.length === 1 ? "" : "s"} (${mmss(w.breaks.reduce((a, b) => a + b.sec, 0))})`
                : ""}
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

function RunDetail({ track, breaks }: { track: NonNullable<StoredWorkout["track"]>; breaks?: StoredWorkout["breaks"] }) {
  const s = computeRun(track);
  if (!s) return null;
  return (
    <div className="run-detail">
      <Suspense fallback={<div className="run-map" />}>
        <RunMap track={track} breaks={breaks} />
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
