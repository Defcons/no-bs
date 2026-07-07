// The stripped-down view rendered while the window is in Picture-in-Picture. Unlike
// the overlay bubble, PiP keeps the WebView alive, so timer AND HR update live here.
// Two rows: "WORK 12:30" / "BREAK 1:12" on top, "♥ 128 (131)" below.
import { useEffect, useState } from "react";
import { hhmmss, mmss } from "../lib/format";

type Props = {
  restEndsAt: number | null;
  startEpoch: number; // workout start (ms) — WORK time ticks from here
  bpm: number | null;
  avg: number | null;
};

export function PipView({ restEndsAt, startEpoch, bpm, avg }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const restLeft = restEndsAt ? Math.max(0, Math.round((restEndsAt - Date.now()) / 1000)) : 0;
  const resting = restEndsAt != null && restLeft > 0;
  const workSecs = Math.max(0, Math.floor((Date.now() - startEpoch) / 1000));

  return (
    <div className={`pip-view ${resting ? "resting" : ""}`}>
      <span className="pip-row1">
        <span className="pip-label">{resting ? "BREAK" : "WORK"}</span>
        <span className="pip-time">{resting ? mmss(restLeft) : hhmmss(workSecs)}</span>
      </span>
      {bpm != null && (
        <span className="pip-hr">
          ♥ {bpm}
          {avg != null ? ` (${avg})` : ""}
        </span>
      )}
    </div>
  );
}
