// Records: personal records, lifetime summary, and the biggest-lifts scoreboard.
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { niceDate } from "../lib/format";
import { type LiftRecord, MUSCLE_ORDER, liftRecords, muscleGroup, summarize } from "../lib/stats";

export function Records() {
  const workouts = useLiveQuery(() => db.workouts.toArray(), []);
  if (!workouts) return <div className="pad">Loading…</div>;
  if (workouts.length === 0) return <div className="pad muted">No workouts yet — log your first one!</div>;

  const summary = summarize(workouts)!;
  const records = liftRecords(workouts).filter((r) => r.maxWeight.weight > 0);
  const scoreboard = [...records].sort((a, b) => b.maxWeight.weight - a.maxWeight.weight).slice(0, 10);
  const medal = ["🥇", "🥈", "🥉"];

  // Group records by muscle for the collapsible sections.
  const byCat: Record<string, LiftRecord[]> = {};
  for (const r of records) (byCat[muscleGroup(r.name)] ??= []).push(r);
  for (const c of Object.keys(byCat)) byCat[c].sort((a, b) => b.maxWeight.weight - a.maxWeight.weight);

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
        <Stat label="Heaviest lift" value={`${summary.heaviest.weight} kg`} sub={`${summary.heaviest.name} ×${summary.heaviest.reps}`} />
        <Stat label="Best est. 1RM" value={`${summary.bestE1rm.est.toFixed(0)} kg`} sub={summary.bestE1rm.name} />
      </div>

      <h3 className="section">🏆 Biggest lifts</h3>
      <div className="scoreboard">
        {scoreboard.map((r, i) => (
          <div key={r.name} className={`score-row ${i < 3 ? "podium" : ""}`}>
            <span className="rank">{medal[i] ?? i + 1}</span>
            <span className="score-name">{r.name}</span>
            <span className="score-weight">
              {r.maxWeight.weight} kg <span className="muted tiny">×{r.maxWeight.reps}</span>
            </span>
          </div>
        ))}
      </div>

      <h3 className="section">Records by muscle</h3>
      {MUSCLE_ORDER.filter((cat) => byCat[cat]?.length).map((cat) => (
        <details key={cat} className="cat">
          <summary>
            <span className="cat-name">{cat}</span>
            <span className="tiny muted">{byCat[cat].length} exercises</span>
          </summary>
          <div className="records">
            {byCat[cat].map((r) => (
              <div key={r.name} className="record">
                <div className="record-name">{r.name}</div>
                <div className="record-nums">
                  <div>
                    <span className="big">{r.maxWeight.weight} kg</span>
                    <span className="muted"> ×{r.maxWeight.reps}</span>
                    <div className="tiny muted">max · {niceDate(r.maxWeight.date)}</div>
                  </div>
                  <div>
                    <span className="big">{r.bestE1rm.est.toFixed(0)} kg</span>
                    <div className="tiny muted">est 1RM · {niceDate(r.bestE1rm.date)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
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
