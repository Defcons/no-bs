// Records: lifetime summary, key lifts rated against strength standards, and
// per-muscle collapsible personal records.
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { niceDate } from "../lib/format";
import { KEY_LIFTS, adjustThresholds, levelClass, rateLift } from "../lib/standards";
import { type LiftRecord, MUSCLE_ORDER, liftRecords, muscleGroup, summarize } from "../lib/stats";

export function Records({ bodyweightKg, age }: { bodyweightKg: number; age: number }) {
  const workouts = useLiveQuery(() => db.workouts.toArray(), []);
  if (!workouts) return <div className="pad">Loading…</div>;
  if (workouts.length === 0) return <div className="pad muted">No workouts yet — log your first one!</div>;

  const summary = summarize(workouts)!;
  const records = liftRecords(workouts).filter((r) => r.maxWeight.weight > 0);

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
        <Stat label="Best est. 1RM" value={`${summary.bestE1rm.est.toFixed(0)} kg`} sub={summary.bestE1rm.name} />
      </div>

      <h3 className="section">💪 Strength standards</h3>
      {bodyweightKg <= 0 ? (
        <p className="muted tiny">Set your bodyweight in Settings to rate your key lifts against strength standards.</p>
      ) : (
        <div className="standards">
          {KEY_LIFTS.map((kl) => {
            const rec = records.find((r) => r.name === kl.canon);
            if (!rec) return null;
            const e1rm = rec.bestE1rm.est;
            const r = rateLift(adjustThresholds(kl.std, bodyweightKg, age), e1rm, bodyweightKg);
            return (
              <div key={kl.canon} className="std-row">
                <div className="std-top">
                  <span className="std-name">{kl.canon}</span>
                  <span className={`lvl-badge ${levelClass(r.level)}`}>{r.level ?? "Below beginner"}</span>
                </div>
                <div className="std-bar">
                  <div className="std-fill" style={{ width: `${r.journeyPct}%` }} />
                  {r.ticks.map((t, i) => (
                    <span key={i} className="std-tick" style={{ left: `${t}%` }} />
                  ))}
                </div>
                <div className="std-meta tiny muted">
                  {e1rm.toFixed(0)} kg est-1RM · {r.ratio.toFixed(2)}× bodyweight
                  {r.next ? ` · ${Math.max(0, r.next.kg - Math.round(e1rm))} kg to ${r.next.level}` : " · Elite 🏆"}
                  {kl.note ? ` · ${kl.note}` : ""}
                </div>
              </div>
            );
          })}
          <p className="muted tiny">
            Adjusted for your bodyweight{age > 0 ? " and age" : ""} (male). Barbell lifts are reliable; machine lifts
            (leg press / pulldown) are approximate.
          </p>
        </div>
      )}

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
