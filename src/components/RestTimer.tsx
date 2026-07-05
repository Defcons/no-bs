// Rest/break countdown. Shows a big remaining time; beeps + vibrates when the
// rest is over so you know you can start the next set. Survives reload because
// the target time (endsAt) is stored on the workout draft.
import { useEffect, useRef, useState } from "react";
import { mmss } from "../lib/format";
import { showReminder } from "../lib/notify";

type Props = {
  endsAt: number | null; // epoch ms, or null when idle
  onChange: (endsAt: number | null) => void;
};

// A more attention-grabbing 3-beep alarm (louder, ascending).
function alarm() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [0, 0.28, 0.56].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "square";
      o.frequency.value = 700 + i * 200;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.4, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.24);
      o.start(now + t);
      o.stop(now + t + 0.26);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* audio may be blocked; vibration + notification still fire */
  }
}

export function RestTimer({ endsAt, onChange }: Props) {
  const [remaining, setRemaining] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    if (endsAt == null) return;
    firedRef.current = false;
    const tick = () => {
      const rem = Math.round((endsAt - Date.now()) / 1000);
      setRemaining(rem);
      if (rem <= 0 && !firedRef.current) {
        firedRef.current = true;
        alarm();
        navigator.vibrate?.([300, 120, 300, 120, 300]);
        // Notification also surfaces the alert when the app is backgrounded.
        showReminder("Rest over — go! 💪", "Time for your next set.");
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (endsAt == null) return null;
  const over = remaining <= 0;

  return (
    <div className={`rest-timer ${over ? "over" : ""}`} role="timer">
      <div className="rest-main">
        <span className="rest-label">{over ? "Rest over — go!" : "Rest"}</span>
        <span className="rest-time">{over ? "0:00" : mmss(remaining)}</span>
      </div>
      <div className="rest-controls">
        <button onClick={() => onChange(Date.now() + Math.max(0, remaining) * 1000 + 30000)}>+30s</button>
        <button onClick={() => onChange(Date.now() + Math.max(0, remaining - 30) * 1000)}>−30s</button>
        <button className="rest-skip" onClick={() => onChange(null)}>
          {over ? "Dismiss" : "Skip"}
        </button>
      </div>
    </div>
  );
}
