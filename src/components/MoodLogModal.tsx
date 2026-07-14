// Opened when the user taps the "workout auto-saved" notification: a lightweight
// modal to log how a past (auto-ended) session felt. Patches just that workout's
// mood in place — no full editor, no re-sync (edits stay local, like History).
import { useEffect, useState } from "react";
import { db } from "../db";
import { niceDate } from "../lib/format";
import { MoodSlider } from "./MoodSlider";

export function MoodLogModal({ workoutId, onClose }: { workoutId: number; onClose: () => void }) {
  const [before, setBefore] = useState<number | undefined>();
  const [after, setAfter] = useState<number | undefined>();
  const [label, setLabel] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    db.workouts.get(workoutId).then((w) => {
      if (!live) return;
      if (!w) {
        onClose(); // workout gone (deleted) — nothing to log
        return;
      }
      setBefore(w.moodBefore);
      setAfter(w.moodAfter);
      setLabel(`${w.dayName} · ${niceDate(w.date)}`);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [workoutId]);

  const save = async () => {
    await db.workouts.update(workoutId, { moodBefore: before, moodAfter: after });
    onClose();
  };

  if (!loaded) return null;

  return (
    <div className="hr-modal-backdrop">
      <div className="hr-modal">
        <h3>How did that session feel?</h3>
        <p className="muted tiny">{label} — auto-ended, so log it now for your records.</p>
        <MoodSlider label="Feeling before" value={before} onChange={setBefore} />
        <MoodSlider label="Feeling after" value={after} onChange={setAfter} />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" onClick={save}>
            Save
          </button>
          <button className="ghost" onClick={onClose}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
