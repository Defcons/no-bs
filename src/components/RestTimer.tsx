// Rest/break countdown. Shows a big remaining time; beeps + vibrates when the
// rest is over so you know you can start the next set. Survives reload because
// the target time (endsAt) is stored on the workout draft.
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { mmss } from "../lib/format";
import { showReminder } from "../lib/notify";

type Props = {
  endsAt: number | null; // epoch ms, or null when idle
  onChange: (endsAt: number | null) => void;
};

// One shared AudioContext for the whole app — creating a fresh one per beep leaks
// contexts and hits the browser's per-page limit (~6), after which alarms go silent.
let sharedCtx: AudioContext | null = null;
function audioCtx(): AudioContext {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!sharedCtx) sharedCtx = new Ctx();
  return sharedCtx;
}

// A more attention-grabbing 3-beep alarm (louder, ascending).
function alarm() {
  try {
    const ctx = audioCtx();
    if (ctx.state === "suspended") void ctx.resume();
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
    // Do NOT close — it's the shared context, reused for the next rest.
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
    let id = 0;
    const tick = () => {
      const rem = Math.round((endsAt - Date.now()) / 1000);
      setRemaining(rem);
      if (rem <= 0 && !firedRef.current) {
        firedRef.current = true;
        alarm();
        navigator.vibrate?.([300, 120, 300, 120, 300]);
        // Native pre-schedules a notification for this moment (fires in background),
        // so only fire the web SW notification here to avoid a duplicate.
        if (!Capacitor.isNativePlatform()) showReminder("Rest over — go! 💪", "Time for your next set.");
        window.clearInterval(id); // stop ticking once fired (no endless 250ms loop)
      }
    };
    tick();
    id = window.setInterval(tick, 250);
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
