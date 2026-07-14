// A small, dependency-free est-1RM progression chart for one lift. Line + faint
// area fill, endpoint dot, and a one-line caption with the total change.
import type { ProgressPoint } from "../lib/stats";
import { type WeightUnit, fmtWeight } from "../lib/units";

export function ProgressChart({ points, units = "kg" }: { points: ProgressPoint[]; units?: WeightUnit }) {
  if (points.length < 2) {
    return <p className="muted tiny pc-empty">Log this lift a couple more times to see your progress.</p>;
  }

  const W = 300;
  const H = 84;
  const pad = 8;
  const vals = points.map((p) => p.e1rm);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.e1rm).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;

  const last = points[points.length - 1].e1rm;

  return (
    <div className="progress-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="pc-svg" role="img" aria-label="Estimated 1RM over time">
        <path d={area} className="pc-area" />
        <path d={line} className="pc-line" />
        <circle cx={x(points.length - 1)} cy={y(last)} r="3.5" className="pc-dot" />
      </svg>
      <div className="tiny muted pc-cap">
        est-1RM · peak <b>{fmtWeight(max, units)}</b> · latest {fmtWeight(last, units)} · {points.length} sessions
      </div>
    </div>
  );
}
