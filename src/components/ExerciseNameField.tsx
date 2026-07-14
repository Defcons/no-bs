// Exercise-name input with autocomplete (built-in library + the user's own past
// exercises) and an inline "create custom exercise" step that captures the muscle
// group and persists it to the catalog. Keeps names consistent and classification
// correct at the source. See docs/exercise-model.md (P1).
import { type MouseEvent, useMemo, useState } from "react";
import { type Exercise, MUSCLE_ORDER, type MuscleGroup, norm, resolveExercise, searchExercises, slug } from "../lib/exercises";
import { upsertExercise } from "../db";

type Props = {
  value: string;
  onChange: (name: string, ex?: Exercise) => void; // ex present when picked/created
  placeholder?: string;
  className?: string;
  history?: string[]; // the user's distinct past exercise names
};

export function ExerciseNameField({ value, onChange, placeholder, className, history = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<{ name: string; muscle: MuscleGroup } | null>(null);

  const q = value.trim();
  const { lib, hist, exact } = useMemo(() => {
    if (!q) return { lib: [] as Exercise[], hist: [] as { name: string; ex: Exercise }[], exact: true };
    const lib = searchExercises(q, 6);
    const libNames = new Set(lib.map((e) => norm(e.name)));
    const nq = norm(q);
    const hist = history
      .filter((h) => norm(h).includes(nq) && !libNames.has(norm(h)))
      .slice(0, 4)
      .map((h) => ({ name: h, ex: resolveExercise(h) }));
    const exact = lib.some((e) => norm(e.name) === nq) || history.some((h) => norm(h) === nq);
    return { lib, hist, exact };
  }, [q, history]);

  const pick = (name: string, ex?: Exercise) => {
    onChange(name, ex);
    setOpen(false);
    setCreating(null);
  };
  const saveCustom = async () => {
    if (!creating || !creating.name.trim()) return;
    const ex: Exercise = { id: slug(creating.name), name: creating.name.trim(), muscle: creating.muscle, equipment: "other", unit: "weight", builtin: false };
    await upsertExercise(ex); // App's live query re-registers it into the resolver
    pick(ex.name, ex);
  };
  // Keep focus on the input so onBlur doesn't close the menu before the click lands.
  const hold = (e: MouseEvent) => e.preventDefault();

  return (
    <div className="exname">
      <input
        className={className}
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setCreating(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && q && (
        <div className="exname-pop">
          {creating ? (
            <div className="exname-create">
              <div className="exname-create-h">Muscle group for “{creating.name}”</div>
              <div className="exname-chips">
                {MUSCLE_ORDER.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`exname-chip ${creating.muscle === m ? "on" : ""}`}
                    onMouseDown={hold}
                    onClick={() => setCreating((c) => c && { ...c, muscle: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button type="button" className="primary exname-save" onMouseDown={hold} onClick={saveCustom}>
                Create exercise
              </button>
            </div>
          ) : (
            <>
              {lib.map((e) => (
                <button key={e.id} type="button" className="exname-opt" onMouseDown={hold} onClick={() => pick(e.name, e)}>
                  <span className="exname-name">{e.name}</span>
                  <span className="exname-mus">{e.muscle}</span>
                </button>
              ))}
              {hist.map((h) => (
                <button key={h.name} type="button" className="exname-opt" onMouseDown={hold} onClick={() => pick(h.name, h.ex)}>
                  <span className="exname-name">{h.name}</span>
                  <span className="exname-mus">{h.ex.muscle}</span>
                </button>
              ))}
              {!exact && (
                <button
                  type="button"
                  className="exname-opt exname-new"
                  onMouseDown={hold}
                  onClick={() => setCreating({ name: q, muscle: resolveExercise(q).muscle })}
                >
                  ＋ Create “{q}”…
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
