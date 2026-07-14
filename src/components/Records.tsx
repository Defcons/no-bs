// Records: lifetime summary, activity heatmap (year × month), key lifts rated
// against strength standards, and per-muscle collapsible personal records.
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type StoredWorkout } from "../db";
import { niceDate } from "../lib/format";
import { type BwEntry, KEY_LIFTS, adjustThresholds, bodyweightForYear, levelClass, rateLift } from "../lib/standards";
import { type LiftRecord, liftRecords, progression, sessionsPerWeek, summarize, weekNumbersForLast } from "../lib/stats";
import { MUSCLE_ORDER } from "../lib/exercises";
import { ProgressChart } from "./ProgressChart";

export function Records({
  bodyweightKg,
  age,
  bwHistory,
}: {
  bodyweightKg: number;
  age: number;
  bwHistory: BwEntry[];
}) {
  const currentYear = new Date().getFullYear();
  const workouts = useLiveQuery(() => db.workouts.toArray(), []);
  // Derived records are an O(n·exercises) scan — memoize so unrelated re-renders
  // (settings tweaks) don't recompute the whole history every time.
  const derived = useMemo(() => {
    if (!workouts || workouts.length === 0) return null;
    const summary = summarize(workouts)!;
    const records = liftRecords(workouts).filter((r) => r.maxWeight.weight > 0);
    const byCat: Record<string, LiftRecord[]> = {};
    for (const r of records) (byCat[r.muscle] ??= []).push(r);
    for (const c of Object.keys(byCat)) byCat[c].sort((a, b) => b.maxWeight.weight - a.maxWeight.weight);
    return { summary, records, byCat, perWeek: sessionsPerWeek(workouts, 12) };
  }, [workouts]);
  if (!workouts) return <div className="pad">Loading…</div>;
  if (workouts.length === 0) return <div className="pad muted">No workouts yet — log your first one!</div>;

  const { summary, records, byCat, perWeek } = derived!;
  const maxWeek = Math.max(1, ...perWeek);
  const weekNums = weekNumbersForLast(perWeek.length);

  return (
    <div className="pad history">
      <h2>Records</h2>
      <p className="muted tiny">
        {summary.total} sessions · {niceDate(summary.first)} → {niceDate(summary.last)}
      </p>

      <div className="stat-grid">
        <Stat label="Workouts" value={String(summary.total)} />
        <Stat label="Training since" value={niceDate(summary.first)} />
        <Stat label="Current streak" value={`${summary.currentStreakWeeks} wk`} />
        <Stat label="Longest break" value={`${summary.longestBreakDays} d`} sub={`${niceDate(summary.longestBreakBetween[0])} → ${niceDate(summary.longestBreakBetween[1])}`} />
        <Stat label="Busiest month" value={summary.busiestMonth.month} sub={`${summary.busiestMonth.count} sessions`} />
        <Stat label="Best est. 1RM" value={`${summary.bestE1rm.est.toFixed(0)} kg`} sub={summary.bestE1rm.name} />
      </div>

      <h3 className="section">Consistency</h3>
      <div className="weekbars">
        {perWeek.map((c, i) => (
          <div key={i} className="weekcol" title={`Week ${weekNums[i]}: ${c} workout${c === 1 ? "" : "s"}`}>
            <div className="weekbar">
              <div className="weekbar-fill" style={{ height: `${(c / maxWeek) * 100}%` }} />
            </div>
            <span className="weeklabel">{weekNums[i]}</span>
          </div>
        ))}
      </div>
      <p className="muted tiny">Workouts per week — last 12 weeks (week number below · right = this week).</p>

      <h3 className="section">Activity by year</h3>
      <ActivityHeatmap workouts={workouts} />

      <details className="cat rec-standards">
        <summary>
          <span className="cat-name"><span className="mask-icon bicep" aria-hidden="true" /> Strength standards</span>
          <span className="tiny muted">key lifts vs standards</span>
        </summary>
        <div className="rec-standards-body">
          {bodyweightKg <= 0 ? (
            <p className="muted tiny">
              Set your bodyweight in Settings to rate your key lifts against strength standards.
            </p>
          ) : (
            <div className="standards">
              {KEY_LIFTS.map((kl) => {
                const rec = records.find((r) => r.standardKey === kl.key);
                if (!rec) return null;
                const e1rm = rec.bestE1rm.est;
                const year = parseInt(rec.bestE1rm.date.slice(0, 4), 10);
                const bw = bodyweightForYear(year, bwHistory, bodyweightKg, currentYear);
                const r = rateLift(adjustThresholds(kl.std, bw, age), e1rm, bw);
                return (
                  <div key={kl.key} className="std-row">
                    <div className="std-top">
                      <span className="std-name">{kl.name}</span>
                      <span className={`lvl-badge ${levelClass(r.level)}`}>{r.level ?? "Below beginner"}</span>
                    </div>
                    <div className="std-bar">
                      <div className="std-fill" style={{ width: `${r.journeyPct}%` }} />
                      {r.ticks.map((t, i) => (
                        <span key={i} className="std-tick" style={{ left: `${t}%` }} />
                      ))}
                    </div>
                    <div className="std-meta tiny muted">
                      {e1rm.toFixed(0)} kg est-1RM · {r.ratio.toFixed(2)}× BW @ {bw}kg ({year})
                      {r.next ? ` · ${Math.max(0, r.next.kg - Math.round(e1rm))} kg to ${r.next.level}` : " · Elite 🏆"}
                      {kl.note ? ` · ${kl.note}` : ""}
                    </div>
                  </div>
                );
              })}
              <p className="muted tiny">
                Adjusted for your bodyweight{age > 0 ? " and age" : ""} (male). Barbell lifts are reliable; machine
                lifts (leg press / pulldown) are approximate.
              </p>
            </div>
          )}
        </div>
      </details>

      <h3 className="section">Records by muscle</h3>
      {MUSCLE_ORDER.filter((cat) => byCat[cat]?.length).map((cat) => (
        <details key={cat} className="cat">
          <summary>
            {MUSCLE_ICON[cat] ? (
              <span
                className="mask-icon cat-icon"
                aria-hidden="true"
                style={{
                  maskImage: `url(/icons/${MUSCLE_ICON[cat]}.png)`,
                  WebkitMaskImage: `url(/icons/${MUSCLE_ICON[cat]}.png)`,
                  backgroundColor: MUSCLE_COLOR[cat] ?? "var(--muted)",
                }}
              />
            ) : (
              <span className="cat-dot" style={{ background: MUSCLE_COLOR[cat] ?? "var(--muted)" }} />
            )}
            <span className="cat-name">{cat}</span>
            <span className="cat-count">{byCat[cat].length}</span>
          </summary>
          <div className="records">
            {byCat[cat].map((r) => (
              <RecordRow key={r.name} r={r} workouts={workouts} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function RecordRow({ r, workouts }: { r: LiftRecord; workouts: StoredWorkout[] }) {
  const [open, setOpen] = useState(false);
  const pts = useMemo(() => (open ? progression(workouts, r.key) : []), [open, workouts, r.key]);
  return (
    <div className={`record ${open ? "open" : ""}`}>
      <button className="record-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="record-name">
          {r.name}
          <span className="record-chev">{open ? "▴" : "▾"}</span>
        </div>
        <div className="record-nums">
          <div className="rec-metric">
            <div className="rec-lbl">Max</div>
            <span className="big">{r.maxWeight.weight}<span className="rec-u"> kg</span></span>
            <span className="muted"> ×{r.maxWeight.reps}</span>
            <div className="tiny muted">{niceDate(r.maxWeight.date)}</div>
          </div>
          <div className="rec-metric">
            <div className="rec-lbl">Est 1RM</div>
            <span className="big">{r.bestE1rm.est.toFixed(0)}<span className="rec-u"> kg</span></span>
            <div className="tiny muted">{niceDate(r.bestE1rm.date)}</div>
          </div>
        </div>
      </button>
      {open && <ProgressChart points={pts} />}
    </div>
  );
}

// Per-muscle hues for quick scanning (also tints the muscle icon). Accent stays molten.
const MUSCLE_COLOR: Record<string, string> = {
  Chest: "#e8695b",
  Back: "#5b8def",
  Shoulder: "#e0a83b",
  Legs: "#46b98a",
  Arms: "#b57be0",
  Core: "#e06a9e",
};
// Muscle-group icons (public/icons/*.png, tinted via CSS mask). "Other" → dot fallback.
const MUSCLE_ICON: Record<string, string> = {
  Chest: "chest",
  Back: "back",
  Shoulder: "shoulder",
  Legs: "legs",
  Arms: "bicep",
  Core: "core",
};

// Year × month heatmap: rows = years (newest first), cells shaded by session count
// relative to the busiest month IN VIEW — active periods pop out at a glance.
const RANGE_CHOICES = [3, 5, 0] as const; // 0 = all years
function ActivityHeatmap({ workouts }: { workouts: StoredWorkout[] }) {
  const [range, setRange] = useState<number>(5);
  const { years, counts } = useMemo(() => {
    const counts = new Map<string, number>(); // "YYYY-MM" → sessions
    const yearSet = new Set<number>();
    for (const w of workouts) {
      const ym = w.date.slice(0, 7);
      counts.set(ym, (counts.get(ym) ?? 0) + 1);
      yearSet.add(+w.date.slice(0, 4));
    }
    return { years: [...yearSet].sort((a, b) => b - a), counts };
  }, [workouts]);

  const shown = range ? years.slice(0, range) : years;
  const max = Math.max(1, ...shown.flatMap((y) => Array.from({ length: 12 }, (_, m) => counts.get(`${y}-${String(m + 1).padStart(2, "0")}`) ?? 0)));

  return (
    <div className="heatmap-wrap">
      {years.length > 3 && (
        <div className="seg heatmap-seg">
          {RANGE_CHOICES.map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
              {r ? `${r} yrs` : `All (${years.length})`}
            </button>
          ))}
        </div>
      )}
      <div className="heatmap">
        <div className="heatmap-row heatmap-head">
          <span className="heatmap-year" />
          {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m, i) => (
            <span key={i} className="heatmap-m tiny muted">
              {m}
            </span>
          ))}
          <span className="heatmap-total-h tiny muted">Year</span>
        </div>
        {shown.map((y) => {
          const total = Array.from({ length: 12 }, (_, m) => counts.get(`${y}-${String(m + 1).padStart(2, "0")}`) ?? 0).reduce((a, b) => a + b, 0);
          return (
            <div key={y} className="heatmap-row">
              <span className="heatmap-year tiny muted">{y}</span>
              {Array.from({ length: 12 }, (_, m) => {
                const c = counts.get(`${y}-${String(m + 1).padStart(2, "0")}`) ?? 0;
                const pct = Math.round((c / max) * 88);
                return (
                  <span
                    key={m}
                    className="heatmap-cell"
                    title={`${y}-${String(m + 1).padStart(2, "0")}: ${c} workout${c === 1 ? "" : "s"}`}
                    style={c ? { background: `color-mix(in srgb, var(--accent) ${pct}%, var(--surface))` } : undefined}
                  >
                    {c > 0 && <span className={`heatmap-n ${pct > 50 ? "hi" : ""}`}>{c}</span>}
                  </span>
                );
              })}
              <span className="heatmap-total num" title={`${total} workouts in ${y}`}>{total}</span>
            </div>
          );
        })}
      </div>
      <p className="muted tiny">Sessions per month — more orange = more active. Right column is the year's total.</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
