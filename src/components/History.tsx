// History: a table of past workouts (newest first). Tap a row to expand the
// exercises, sets, notes, duration and HR of that session.
import { Suspense, lazy, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type StoredWorkout } from "../db";
import { daysAgoLabel, hhmmss, niceDate } from "../lib/format";
import { computeRun, fmtDist, fmtPace } from "../lib/runStats";
import { ExerciseCard } from "./ExerciseCard";
// Lazy so Leaflet (+CSS) only loads when a run's map is actually shown.
const RunMap = lazy(() => import("./RunMap").then((m) => ({ default: m.RunMap })));

export function History() {
  const workouts = useLiveQuery(() => db.workouts.orderBy("date").reverse().toArray(), []);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<StoredWorkout | null>(null);
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
                                .map(
                                  (s) =>
                                    `${s.weight}${s.reps ? `×${s.reps}` : ""}${s.assist != null ? `(${s.assist})` : ""}`,
                                )
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
                      {w.avgHr ? ` · ♥ ${w.avgHr} avg / ${w.maxHr} max` : ""}
                      {w.moodBefore || w.moodAfter ? ` · 🙂 ${w.moodBefore ?? "–"}→${w.moodAfter ?? "–"}/10` : ""}
                    </div>
                  )}
                  <div className="row log-actions">
                    <button className="mini" onClick={() => setEditing(structuredClone(w))}>
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
        })}
      </div>

      {editing && <WorkoutEditor workout={editing} onClose={() => setEditing(null)} />}
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

function WorkoutEditor({ workout, onClose }: { workout: StoredWorkout; onClose: () => void }) {
  const [w, setW] = useState<StoredWorkout>(workout);

  const save = async () => {
    await db.workouts.update(w.id!, {
      dayName: w.dayName,
      exercises: w.exercises,
      note: w.note,
      moodBefore: w.moodBefore,
      moodAfter: w.moodAfter,
    });
    onClose();
  };

  return (
    <div className="hr-modal-backdrop">
      <div className="edit-modal">
        <header className="edit-head">
          <div>
            <div className="log-day">{w.dayName}</div>
            <div className="tiny muted">{niceDate(w.date)}</div>
          </div>
          <button className="mini" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="edit-body">
          {w.exercises.map((ex, i) => (
            <ExerciseCard
              key={i}
              exercise={ex}
              step={2.5}
              editableName
              onChange={(e) => setW((p) => ({ ...p, exercises: p.exercises.map((x, idx) => (idx === i ? e : x)) }))}
              onRemove={() => setW((p) => ({ ...p, exercises: p.exercises.filter((_, idx) => idx !== i) }))}
            />
          ))}
          <label className="field-label" style={{ marginTop: 12 }}>
            Day note
          </label>
          <textarea
            className="day-note"
            value={w.note ?? ""}
            onChange={(e) => setW((p) => ({ ...p, note: e.target.value || undefined }))}
          />
        </div>

        <footer className="edit-foot">
          <button
            className="mini danger"
            onClick={() => {
              if (confirm("Delete this workout? This can't be undone.")) db.workouts.delete(w.id!).then(onClose);
            }}
          >
            Delete
          </button>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
