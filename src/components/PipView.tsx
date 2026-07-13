// The stripped-down view rendered while the window is in Picture-in-Picture. Unlike
// the overlay bubble, PiP keeps the WebView alive, so timer AND HR update live here.
// Two rows: "WORK 12:30" / "BREAK 1:12" on top, "♥ 128 (131)" below.
import { useEffect, useState } from "react";
import { hhmmss, mmss } from "../lib/format";
import { wElapsedMs } from "../lib/useActiveWorkout";

type Props = {
  restEndsAt: number | null;
  // Pausable workout-timer state — same fields the in-app header ticks from,
  // so PiP and app can never disagree.
  timer: { wAccumMs: number; wRunning: boolean; wSegStart: number };
  bpm: number | null;
  avg: number | null;
};

export function PipView({ restEndsAt, timer, bpm, avg }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const restLeft = restEndsAt ? Math.max(0, Math.round((restEndsAt - Date.now()) / 1000)) : 0;
  const resting = restEndsAt != null && restLeft > 0;
  const workSecs = Math.max(0, Math.floor(wElapsedMs(timer) / 1000));
  const timeStr = resting ? mmss(restLeft) : hhmmss(workSecs);
  // "1:02:03" (hours) is wider than "12:34" — shrink so it fits the PiP width.
  const long = timeStr.length > 5;

  return (
    <div className={`pip-view ${resting ? "resting" : ""}`}>
      <span className="pip-row1">
        <span className="pip-label">{resting ? "BREAK" : <>WORK&#8209;<br />OUT</>}</span>
        <span className={`pip-time ${long ? "long" : ""}`}>{timeStr}</span>
      </span>
      {bpm != null && (
        <span className="pip-hr">
          ♥ {bpm}
          {avg != null && <span className="pip-hr-avg"> (avg {avg})</span>}
        </span>
      )}
    </div>
  );
}
