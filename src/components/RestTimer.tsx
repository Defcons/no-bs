// Rest/break countdown. Shows a big remaining time; beeps + vibrates when the
// rest is over so you know you can start the next set. Survives reload because
// the target time (endsAt) is stored on the workout draft.
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { mmss } from "../lib/format";
import { showReminder } from "../lib/notify";
import { getCustomSound, getSetting } from "../db";
import { type BreakSoundId, customIdOf, decodeSound, isCustom, playBreakSound, playBuffer, playCountdownTick } from "../lib/sounds";

type Props = {
  endsAt: number | null; // epoch ms, or null when idle
  onChange: (endsAt: number | null) => void;
};

export function RestTimer({ endsAt, onChange }: Props) {
  const [remaining, setRemaining] = useState(0);
  const firedRef = useRef(false);
  // Pre-load the chosen alarm sound so it plays instantly when rest ends. The
  // setting is either a built-in id ("beep"…) or "custom:<id>" (a user's file,
  // pre-decoded into an AudioBuffer here).
  const soundRef = useRef<BreakSoundId>("beep");
  const customBufRef = useRef<AudioBuffer | null>(null);
  useEffect(() => {
    getSetting<string>("breakSound", "beep").then(async (s) => {
      if (isCustom(s)) {
        try {
          const rec = await getCustomSound(customIdOf(s));
          customBufRef.current = rec ? await decodeSound(rec.blob) : null;
        } catch {
          customBufRef.current = null; // fall back to the default beep on decode failure
        }
      } else {
        soundRef.current = s as BreakSoundId;
        customBufRef.current = null;
      }
    });
  }, []);

  // Optional faint 3-2-1 countdown before the break ends (default off).
  const countdownRef = useRef(false);
  useEffect(() => {
    getSetting<boolean>("breakCountdown", false).then((v) => (countdownRef.current = v));
  }, []);
  const tickedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (endsAt == null) return;
    // Mounting onto an ALREADY-expired timer (tab switch back, reopening the app
    // on a forgotten draft) must not replay the alarm — it fired when it expired.
    if (endsAt - Date.now() < -5000) {
      firedRef.current = true;
      setRemaining(0);
      return;
    }
    firedRef.current = false;
    tickedRef.current.clear();
    let id = 0;
    const tick = () => {
      const rem = Math.round((endsAt - Date.now()) / 1000);
      setRemaining(rem);
      // Faint countdown ticks at 3/2/1s remaining (once each), if enabled.
      if (countdownRef.current && !firedRef.current && rem >= 1 && rem <= 3 && !tickedRef.current.has(rem)) {
        tickedRef.current.add(rem);
        playCountdownTick(rem === 1);
      }
      if (rem <= 0 && !firedRef.current) {
        firedRef.current = true;
        if (customBufRef.current) playBuffer(customBufRef.current);
        else playBreakSound(soundRef.current);
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
