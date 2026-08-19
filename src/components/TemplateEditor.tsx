// Create / edit a reusable workout ("day"): a name + an ordered list of exercises
// with a sets×reps scheme. Saved to db.templates so it shows in the day picker and
// can be repeated. Deleting a workout keeps its logged sessions in History.
import { useEffect, useState } from "react";
import { db, distinctExerciseNames } from "../db";
import type { DayTemplate, Scheme } from "../types";
import { uid } from "../lib/uid";
import { resolveExercise } from "../lib/exercises";
import { restForId, setRestForId } from "../lib/exerciseRest";
import { type WeightUnit, fromDisplayWeight, toDisplayWeight } from "../lib/units";
import { ExerciseNameField } from "./ExerciseNameField";

// Break-timer presets for the per-exercise rest picker (seconds). Rest is stored
// GLOBALLY per exercise (see lib/exerciseRest) — one value for e.g. "Bench",
// applied wherever it's used — so it's configured here in the workout editor, not
// on the live Today card.
const REST_PRESETS = [30, 60, 90, 120, 150, 180];
const fmtRest = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : `${s}s`);

type ExRow = { id: string; name: string; exerciseId?: string; sets: string; reps: string; step: string; rest?: number };

function toRows(t: DayTemplate, units: WeightUnit): ExRow[] {
  if (!t.exercises.length) return [{ id: uid(), name: "", sets: "3", reps: "8", step: "" }];
  return t.exercises.map((e) => ({
    id: uid(),
    name: e.name,
    exerciseId: e.exerciseId,
    sets: e.scheme.sets == null ? "" : String(e.scheme.sets),
    reps: e.scheme.reps == null ? "" : String(e.scheme.reps),
    step: e.step == null ? "" : String(toDisplayWeight(e.step, units)).replace(".", ","),
    rest: restForId(resolveExercise(e.name, e.exerciseId).id),
  }));
}

// A step entered in the user's unit → kg to store; blank/invalid → undefined.
function parseStepKg(s: string, units: WeightUnit): number | undefined {
  const n = parseFloat(s.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? fromDisplayWeight(n, units) : undefined;
}

function parseScheme(sets: string, reps: string): Scheme {
  const s = parseInt(sets, 10);
  const r = /^m/i.test(reps.trim()) ? "Max" : Number.isFinite(parseInt(reps, 10)) ? parseInt(reps, 10) : null;
  return { sets: Number.isFinite(s) ? s : null, reps: r };
}

export function TemplateEditor({ template, units, onClose }: { template: DayTemplate; units: WeightUnit; onClose: () => void }) {
  const [name, setName] = useState(template.name);
  const [rows, setRows] = useState<ExRow[]>(toRows(template, units));
  const [history, setHistory] = useState<string[]>([]);
  const [saving, setSaving] = useState(false); // double-tap on Save = two identical day templates
  const isNew = template.id == null;

  useEffect(() => {
    distinctExerciseNames().then(setHistory);
  }, []);

  const setRow = (id: string, patch: Partial<ExRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { id: uid(), name: "", sets: "3", reps: "8", step: "" }]);
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));
  const move = (id: string, dir: -1 | 1) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const save = async () => {
    if (saving) return; // the awaits below leave the button live — a double-tap added the template twice
    setSaving(true);
    try {
      const named = rows.filter((r) => r.name.trim());
      const exercises = named.map((r) => ({
        name: r.name.trim(),
        exerciseId: r.exerciseId,
        scheme: parseScheme(r.sets, r.reps),
        step: parseStepKg(r.step, units),
      }));
      // Persist each exercise's rest (global per exercise, by resolved id). Sequential
      // — setRestForId copies+rewrites the shared map, so concurrent writes would drop
      // each other's changes.
      for (const r of named) {
        await setRestForId(resolveExercise(r.name.trim(), r.exerciseId).id, r.rest ?? null);
      }
      const cleanName = name.trim() || "Workout";
      if (isNew) {
        const last = await db.templates.orderBy("order").last();
        await db.templates.add({ name: cleanName, order: (last?.order ?? -1) + 1, exercises });
      } else {
        await db.templates.update(template.id!, { name: cleanName, exercises });
      }
      onClose();
    } finally {
      setSaving(false); // release on error too, or Save dead-ends
    }
  };

  const del = async () => {
    if (template.id != null && confirm(`Delete the "${name}" workout? Your logged sessions are kept.`)) {
      await db.templates.delete(template.id);
      onClose();
    }
  };

  return (
    <div className="hr-modal-backdrop">
      <div className="edit-modal">
        <header className="edit-head">
          <input
            className="tmpl-title"
            type="text"
            value={name}
            placeholder="Workout name (e.g. Push, Legs)"
            onChange={(e) => setName(e.target.value)}
          />
          <button className="mini" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="edit-body">
          <div className="tmpl-cols tiny muted">
            <span>Exercise</span>
            <span>Sets × Reps · ±{units}</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.id} className="tmpl-ex">
              <div className="tmpl-row">
                <ExerciseNameField
                  className="tmpl-name"
                  value={r.name}
                  placeholder="exercise"
                  history={history}
                  onChange={(name, ex) => setRow(r.id, { name, exerciseId: ex?.id })}
                />
                <input
                  className="tmpl-num"
                  type="text"
                  inputMode="numeric"
                  value={r.sets}
                  onChange={(e) => setRow(r.id, { sets: e.target.value })}
                />
                <span className="tmpl-x">×</span>
                <input
                  className="tmpl-num"
                  type="text"
                  inputMode="numeric"
                  value={r.reps}
                  placeholder="reps"
                  onChange={(e) => setRow(r.id, { reps: e.target.value })}
                />
                <input
                  className="tmpl-num tmpl-step"
                  type="text"
                  inputMode="decimal"
                  value={r.step}
                  placeholder={`±${units}`}
                  title="Weight step for this exercise (blank = Settings default)"
                  onChange={(e) => setRow(r.id, { step: e.target.value })}
                />
                <button className="hbtn" aria-label="move up" disabled={i === 0} onClick={() => move(r.id, -1)}>
                  ↑
                </button>
                <button className="hbtn" aria-label="move down" disabled={i === rows.length - 1} onClick={() => move(r.id, 1)}>
                  ↓
                </button>
                <button className="hbtn" aria-label="remove" onClick={() => removeRow(r.id)}>
                  🗑
                </button>
              </div>
              <div className="tmpl-rest">
                <label htmlFor={`rest-${r.id}`}>⏱ Break</label>
                <select
                  id={`rest-${r.id}`}
                  value={r.rest == null ? "" : String(r.rest)}
                  title="Break timer for this exercise (blank = global default)"
                  onChange={(e) => setRow(r.id, { rest: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">Default</option>
                  {REST_PRESETS.map((s) => (
                    <option key={s} value={s}>
                      {fmtRest(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          <button className="mini" style={{ marginTop: 10 }} onClick={addRow}>
            ＋ Add exercise
          </button>
          <p className="muted tiny" style={{ marginTop: 10 }}>
            Reps can be a number or “Max”. <b>±{units}</b> sets this exercise's +/- button step — leave blank to use the
            default from Settings. <b>⏱ Break</b> sets this exercise's rest timer (blank = global default). New sets start
            from last time's weight.
          </p>
        </div>

        <footer className="edit-foot">
          {!isNew && (
            <button className="mini danger" onClick={del}>
              Delete
            </button>
          )}
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
