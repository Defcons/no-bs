// A 1–10 "how did it feel" slider, shared by the active-workout mood sheet, the
// finish-prompt, and the auto-end mood-logging modal.
// The handle rests at 5 (neutral) but the value stays UNSET until you actually
// touch it — so an un-rated session still reads as un-rated (muted "5/10") and the
// "rate your feeling" nudge + finish-prompt can fire. Any drag OR a plain tap
// (pointer-up) commits the current value, so you can lock in 5 without moving off it.
export function MoodSlider({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  const set = value != null;
  const shown = value ?? 5;
  return (
    <div className="mood">
      <div className="mood-head">
        <span className="field-label">{label}</span>
        <span className={`mood-val ${set ? "" : "unset"}`}>{shown}/10</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        className={set ? "" : "unset"}
        value={shown}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        onPointerUp={(e) => onChange(parseInt((e.target as HTMLInputElement).value, 10))}
      />
    </div>
  );
}
