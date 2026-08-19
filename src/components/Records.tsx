// Records: lifetime summary, activity heatmap (year × month), key lifts rated
// against strength standards, and per-muscle collapsible personal records.
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, type StoredWorkout } from "../db";
import { hhmmss, localDay, mmss, niceDate } from "../lib/format";
import { fmtDist, fmtPace } from "../lib/runStats";
import { paceLadder, paceMedals, runPBs, runsFrom } from "../lib/runStandards";
import { type BwEntry, KEY_LIFTS, REF_BW, type Sex, adjustThresholds, bodyweightForYear, levelClass, rateLift } from "../lib/standards";
import { type LiftRecord, currentForm, hasRecord, liftRecords, progression, sessionsPerWeek, summarize, weekNumbersForLast } from "../lib/stats";
import { MUSCLE_ORDER } from "../lib/exercises";
import { type WeightUnit, fmtWeight, toDisplayWeight, weightStr } from "../lib/units";
import { ProgressChart } from "./ProgressChart";

export function Records({
  bodyweightKg,
  age,
  sex,
  units,
  bwHistory,
}: {
  bodyweightKg: number;
  age: number;
  sex: Sex;
  units: WeightUnit;
  bwHistory: BwEntry[];
}) {
  const currentYear = new Date().getFullYear();
  const workouts = useLiveQuery(() => db.workouts.toArray(), []);
  // Whether free-form "Alternative" sessions count toward the weekly bars (default off).
  const includeAltInWeekly = useLiveQuery(() => getSetting("includeAltInWeekly", false), [], false);
  // Derived records are an O(n·exercises) scan — memoize so unrelated re-renders
  // (settings tweaks) don't recompute the whole history every time.
  const derived = useMemo(() => {
    if (!workouts || workouts.length === 0) return null;
    const summary = summarize(workouts)!;
    const records = liftRecords(workouts).filter(hasRecord);
    const byCat: Record<string, LiftRecord[]> = {};
    for (const r of records) (byCat[r.muscle] ??= []).push(r);
    for (const c of Object.keys(byCat)) byCat[c].sort((a, b) => b.count - a.count);
    const weekly = includeAltInWeekly ? workouts : workouts.filter((w) => !w.custom);
    return { summary, records, byCat, perWeek: sessionsPerWeek(weekly, 12) };
  }, [workouts, includeAltInWeekly]);
  const runs = useMemo(() => runsFrom(workouts ?? []), [workouts]);
  const form = useMemo(() => currentForm(workouts ?? []), [workouts]);
  if (!workouts) return <div className="pad">Loading…</div>;
  if (workouts.length === 0) return <div className="pad muted">No workouts yet — log your first one!</div>;

  const { summary, records, byCat, perWeek } = derived!;
  const maxWeek = Math.max(1, ...perWeek);
  const weekNums = weekNumbersForLast(perWeek.length);
  const pbs = runPBs(runs);
  const ladder = pbs ? paceLadder(pbs.fastestPace) : null;
  const medals = pbs ? paceMedals(runs, pbs.fastestPace) : null;

  return (
    <div className="pad history">
      <h2>Records</h2>
      <p className="muted tiny">
        {summary.total} sessions · {niceDate(summary.first)} → {niceDate(summary.last)}
      </p>

      {form && (
        <div className={`form-card tone-${form.tone}`}>
          <div className="form-main">
            <div className="form-eyebrow">Current form</div>
            <div className="form-title">
              {form.emoji} {form.label}
            </div>
            <div className="form-sub">
              {form.stale
                ? "No lifts logged in the last 90 days — jump back in."
                : `At ${form.pct}% of your all-time best across ${form.lifts} lift${form.lifts === 1 ? "" : "s"}.`}
            </div>
          </div>
          {!form.stale && (
            <div className="form-ring">
              {form.pct}
              <span>%</span>
            </div>
          )}
        </div>
      )}

      <div className="stat-grid">
        <Stat label="Workouts" value={String(summary.total)} />
        <Stat label="Training since" value={niceDate(summary.first)} />
        <Stat label="Current streak" value={`${summary.currentStreakWeeks} wk`} />
        <Stat label="Longest break" value={`${summary.longestBreakDays} d`} sub={`${niceDate(summary.longestBreakBetween[0])} → ${niceDate(summary.longestBreakBetween[1])}`} />
        <Stat label="Busiest month" value={summary.busiestMonth.month} sub={`${summary.busiestMonth.count} sessions`} />
        <Stat label="Best est. 1RM" value={fmtWeight(summary.bestE1rm.est, units)} sub={summary.bestE1rm.name} />
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
                const year = parseInt(localDay(rec.bestE1rm.date).slice(0, 4), 10);
                const bw = bodyweightForYear(year, bwHistory, bodyweightKg, currentYear);
                const r = rateLift(adjustThresholds(kl[sex], bw, age, REF_BW[sex]), e1rm, bw);
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
                      {fmtWeight(e1rm, units)} est-1RM · {r.ratio.toFixed(2)}× BW @ {fmtWeight(bw, units)} ({year})
                      {r.next ? ` · ${fmtWeight(Math.max(0, r.next.kg - Math.round(e1rm)), units)} to ${r.next.level}` : " · Elite 🏆"}
                      {kl.note ? ` · ${kl.note}` : ""}
                    </div>
                  </div>
                );
              })}
              <p className="muted tiny">
                Adjusted for your bodyweight{age > 0 ? " and age" : ""} ({sex}). Barbell lifts are reliable; machine
                lifts (leg press / pulldown) are approximate.
              </p>
            </div>
          )}
        </div>
      </details>

      {pbs && ladder && medals && (
        <>
          <h3 className="section">Running</h3>
          <div className="stat-grid">
            <Stat label="Runs" value={String(pbs.count)} />
            <Stat label="Furthest" value={fmtDist(pbs.furthestM)} />
            <Stat label="Fastest pace" value={fmtPace(pbs.fastestPace)} />
            <Stat label="Longest run" value={hhmmss(pbs.longestSec)} />
            <Stat label="Total distance" value={fmtDist(pbs.totalM)} />
          </div>
          <details className="cat rec-standards">
            <summary>
              <span className="cat-name">🏃 Pace standards</span>
              <span className="tiny muted">best pace vs tiers</span>
            </summary>
            <div className="rec-standards-body">
              <div className="standards">
                <div className="std-row">
                  <div className="std-top">
                    <span className="std-name">Best pace (absolute)</span>
                    <span className="lvl-badge">{ladder.tier}</span>
                  </div>
                  <div className="std-bar">
                    <div className="std-fill" style={{ width: `${ladder.journeyPct}%` }} />
                    {ladder.ticks.map((t, i) => (
                      <span key={i} className="std-tick" style={{ left: `${t}%` }} />
                    ))}
                  </div>
                  <div className="std-meta tiny muted">
                    {fmtPace(pbs.fastestPace)} best ·{" "}
                    {ladder.nextPace ? `${fmtPace(ladder.nextPace)} for next tier` : "top tier 🏆"}
                  </div>
                </div>
                <div className="std-row">
                  <div className="std-top">
                    <span className="std-name">Personal-best medals</span>
                    <span className="tiny muted">vs your fastest</span>
                  </div>
                  <div className="std-meta tiny muted">
                    🥇 {medals.gold} · 🥈 {medals.silver} · 🥉 {medals.bronze} — runs within 3% / 8% / 15% of your best pace.
                  </div>
                </div>
                <p className="muted tiny">
                  Absolute tiers are fixed pace targets (same for everyone); medals rank your runs against your own best.
                </p>
              </div>
            </div>
          </details>
        </>
      )}

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
              <RecordRow key={r.name} r={r} workouts={workouts} units={units} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function RecordRow({ r, workouts, units }: { r: LiftRecord; workouts: StoredWorkout[]; units: WeightUnit }) {
  const [open, setOpen] = useState(false);
  const isWeight = r.unit === "weight";
  const pts = useMemo(() => (open && isWeight ? progression(workouts, r.key) : []), [open, isWeight, workouts, r.key]);
  return (
    <div className={`record ${open ? "open" : ""}`}>
      <button className="record-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="record-name">
          {r.name}
          <span className="record-chev">{open ? "▴" : "▾"}</span>
        </div>
        <div className="record-nums">
          {r.unit === "distance" ? (
            <>
              <div className="rec-metric">
                <div className="rec-lbl">Longest</div>
                <span className="big">{Number((r.maxDistance.meters / 1000).toFixed(2))}<span className="rec-u"> km</span></span>
                {r.maxDistance.seconds > 0 && <span className="muted"> · {mmss(r.maxDistance.seconds)}</span>}
                <div className="tiny muted">{niceDate(r.maxDistance.date)}</div>
              </div>
              {r.bestPace.secPerKm > 0 && (
                <div className="rec-metric">
                  <div className="rec-lbl">Best pace</div>
                  <span className="big">{mmss(Math.round(r.bestPace.secPerKm))}<span className="rec-u"> /km</span></span>
                  <div className="tiny muted">{niceDate(r.bestPace.date)}</div>
                </div>
              )}
            </>
          ) : r.unit === "time" ? (
            <div className="rec-metric">
              <div className="rec-lbl">Best hold</div>
              <span className="big">{mmss(r.maxDuration.seconds)}</span>
              <div className="tiny muted">{niceDate(r.maxDuration.date)}</div>
            </div>
          ) : r.unit === "bodyweight" ? (
            <>
              {r.maxReps.reps > 0 && (
                <div className="rec-metric">
                  <div className="rec-lbl">Max reps</div>
                  <span className="big">{r.maxReps.reps}</span>
                  {r.maxReps.weight > 0 && <span className="muted"> +{weightStr(r.maxReps.weight, units)} {units}</span>}
                  <div className="tiny muted">{niceDate(r.maxReps.date)}</div>
                </div>
              )}
              {r.maxWeight.weight > 0 && (
                <div className="rec-metric">
                  <div className="rec-lbl">Max +{units}</div>
                  <span className="big">{weightStr(r.maxWeight.weight, units)}<span className="rec-u"> {units}</span></span>
                  <span className="muted"> ×{r.maxWeight.reps}</span>
                  <div className="tiny muted">{niceDate(r.maxWeight.date)}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rec-metric">
                <div className="rec-lbl">Max</div>
                <span className="big">{weightStr(r.maxWeight.weight, units)}<span className="rec-u"> {units}</span></span>
                <span className="muted"> ×{r.maxWeight.reps}</span>
                <div className="tiny muted">{niceDate(r.maxWeight.date)}</div>
              </div>
              {r.bestE1rm.est > 0 && (
                <div className="rec-metric">
                  <div className="rec-lbl">Est 1RM</div>
                  <span className="big">{Math.round(toDisplayWeight(r.bestE1rm.est, units))}<span className="rec-u"> {units}</span></span>
                  <div className="tiny muted">{niceDate(r.bestE1rm.date)}</div>
                </div>
              )}
            </>
          )}
        </div>
      </button>
      {open && isWeight && <ProgressChart points={pts} units={units} />}
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
      const day = localDay(w.date);
      const ym = day.slice(0, 7);
      counts.set(ym, (counts.get(ym) ?? 0) + 1);
      yearSet.add(+day.slice(0, 4));
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
