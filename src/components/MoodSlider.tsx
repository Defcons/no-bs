// A 1–10 "how did it feel" slider, shared by the active-workout mood sheet, the
// finish-prompt, and the auto-end mood-logging modal.
export function MoodSlider({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div className="mood">
      <div className="mood-head">
        <span className="field-label">{label}</span>
        <span className="mood-val">{value ? `${value}/10` : "—"}</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value ?? 5}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
    </div>
  );
}
