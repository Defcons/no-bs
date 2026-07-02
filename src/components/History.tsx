// History: a table of past workouts (newest first). Tap a row to expand the
// exercises, sets, notes, duration and HR of that session.
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { daysAgoLabel, niceDate } from "../lib/format";

export function History() {
  const workouts = useLiveQuery(() => db.workouts.orderBy("date").reverse().toArray(), []);
  const [open, setOpen] = useState<number | null>(null);
  if (!workouts) return <div className="pad">Loading…</div>;
  if (workouts.length === 0) return <div className="pad muted">No workouts yet — log your first one!</div>;

  return (
    <div className="pad history">
      <h2>History</h2>
      <p className="muted tiny">{workouts.length} workouts · tap a row for details</p>

      <div className="log">
        {workouts.map((w) => {
          const nSets = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.weight != null).length, 0);
          const isOpen = open === w.id;
          return (
            <div key={w.id} className={`log-row ${isOpen ? "open" : ""}`}>
              <button className="log-head" onClick={() => setOpen(isOpen ? null : w.id!)}>
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

              {isOpen && (
                <div className="log-detail">
                  {w.note && <div className="log-note">📝 {w.note}</div>}
                  {w.exercises.map((e, i) => {
                    const sets = e.sets.filter((s) => s.weight != null);
                    return (
                      <div key={i} className="log-ex">
                        <span className="log-ex-name">{e.name}</span>
                        <span className="log-ex-sets">
                          {sets.length
                            ? sets.map((s) => `${s.weight}${s.reps ? `×${s.reps}` : ""}`).join(" · ")
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
                      {w.avgHr ? ` · ♥ ${w.avgHr} avg / ${w.maxHr} max` : ""}
                      {w.moodBefore || w.moodAfter ? ` · 🙂 ${w.moodBefore ?? "–"}→${w.moodAfter ?? "–"}/10` : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
