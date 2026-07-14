// Create / edit a reusable workout ("day"): a name + an ordered list of exercises
// with a sets×reps scheme. Saved to db.templates so it shows in the day picker and
// can be repeated. Deleting a workout keeps its logged sessions in History.
import { useState } from "react";
import { db } from "../db";
import type { DayTemplate, Scheme } from "../types";
import { uid } from "../lib/uid";

type ExRow = { id: string; name: string; sets: string; reps: string; step: string };

function toRows(t: DayTemplate): ExRow[] {
  if (!t.exercises.length) return [{ id: uid(), name: "", sets: "3", reps: "8", step: "" }];
  return t.exercises.map((e) => ({
    id: uid(),
    name: e.name,
    sets: e.scheme.sets == null ? "" : String(e.scheme.sets),
    reps: e.scheme.reps == null ? "" : String(e.scheme.reps),
    step: e.step == null ? "" : String(e.step).replace(".", ","),
  }));
}

// "2,5" / "2.5" → 2.5; blank/invalid → undefined (use the Settings default).
function parseStep(s: string): number | undefined {
  const n = parseFloat(s.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseScheme(sets: string, reps: string): Scheme {
  const s = parseInt(sets, 10);
  const r = /^m/i.test(reps.trim()) ? "Max" : Number.isFinite(parseInt(reps, 10)) ? parseInt(reps, 10) : null;
  return { sets: Number.isFinite(s) ? s : null, reps: r };
}

export function TemplateEditor({ template, onClose }: { template: DayTemplate; onClose: () => void }) {
  const [name, setName] = useState(template.name);
  const [rows, setRows] = useState<ExRow[]>(toRows(template));
  const isNew = template.id == null;

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
    const exercises = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), scheme: parseScheme(r.sets, r.reps), step: parseStep(r.step) }));
    const cleanName = name.trim() || "Workout";
    if (isNew) {
      const last = await db.templates.orderBy("order").last();
      await db.templates.add({ name: cleanName, order: (last?.order ?? -1) + 1, exercises });
    } else {
      await db.templates.update(template.id!, { name: cleanName, exercises });
    }
    onClose();
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
            <span>Sets × Reps · ±kg</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.id} className="tmpl-row">
              <input
                className="tmpl-name"
                type="text"
                value={r.name}
                placeholder="exercise"
                onChange={(e) => setRow(r.id, { name: e.target.value })}
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
                placeholder="±kg"
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
          ))}
          <button className="mini" style={{ marginTop: 10 }} onClick={addRow}>
            ＋ Add exercise
          </button>
          <p className="muted tiny" style={{ marginTop: 10 }}>
            Reps can be a number or “Max”. <b>±kg</b> sets this exercise's +/- button step — leave blank to use the
            default from Settings. New sets start from last time's weight.
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
          <button className="primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
