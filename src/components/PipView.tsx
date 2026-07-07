// The stripped-down view rendered while the window is in Picture-in-Picture: just
// the break countdown (or the running workout time) + HR, sized huge for the tiny
// floating window. Replaces the whole UI while PiP is active.
import { useEffect, useState } from "react";
import { hhmmss, mmss } from "../lib/format";

type Props = {
  restEndsAt: number | null;
  elapsedSec: number;
  bpm: number | null;
};

export function PipView({ restEndsAt, elapsedSec, bpm }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const restLeft = restEndsAt ? Math.max(0, Math.round((restEndsAt - Date.now()) / 1000)) : 0;
  const resting = restEndsAt != null && restLeft > 0;

  return (
    <div className={`pip-view ${resting ? "resting" : ""}`}>
      {resting && <span className="pip-label">REST</span>}
      <span className="pip-time">{resting ? mmss(restLeft) : hhmmss(elapsedSec)}</span>
      {bpm != null && <span className="pip-hr">♥{bpm}</span>}
    </div>
  );
}
