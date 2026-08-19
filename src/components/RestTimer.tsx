// Rest/break countdown. Shows a big remaining time; beeps + vibrates when the
// rest is over so you know you can start the next set. Survives reload because
// the target time (endsAt) is stored on the workout draft.
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
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
  const dismissRef = useRef(0); // auto-dismiss timeout after the alarm fires
  // Pre-load the chosen alarm sound so it plays instantly when rest ends. The
  // setting is either a built-in id ("beep"…) or "custom:<id>" (a user's file,
  // pre-decoded into an AudioBuffer here). Read REACTIVELY (same pattern as the
  // 1.53.0 break-trigger toggles): RestTimer stays mounted for the app's lifetime,
  // so a mount-once load meant a Settings change never applied mid-session.
  const soundChoice = useLiveQuery(() => getSetting<string>("breakSound", "beep"), [], "beep");
  const soundRef = useRef<BreakSoundId>("beep");
  const customBufRef = useRef<AudioBuffer | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isCustom(soundChoice)) {
        try {
          const rec = await getCustomSound(customIdOf(soundChoice));
          const buf = rec ? await decodeSound(rec.blob) : null;
          if (!cancelled) customBufRef.current = buf;
        } catch {
          if (!cancelled) customBufRef.current = null; // fall back to the default beep
        }
      } else {
        soundRef.current = soundChoice as BreakSoundId;
        customBufRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [soundChoice]);

  // Optional faint 3-2-1 countdown before the break ends (default off) — reactive too.
  const breakCountdown = useLiveQuery(() => getSetting<boolean>("breakCountdown", false), [], false);
  const countdownRef = useRef(false);
  countdownRef.current = breakCountdown;
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
        // Clear itself away shortly after the alarm — no manual "Dismiss" needed.
        dismissRef.current = window.setTimeout(() => onChange(null), 5000);
      }
    };
    tick();
    id = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(dismissRef.current);
    };
    // onChange is stable enough here; re-running on every render would restart the tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  if (endsAt == null) return null;
  const over = remaining <= 0;
  // Nudge the running break by ±15/±30s (never below 0).
  const adjust = (delta: number) => onChange(Date.now() + Math.max(0, remaining + delta) * 1000);

  return (
    <div className={`rest-timer ${over ? "over" : ""}`} role="timer">
      <div className="rest-main">
        <span className="rest-label">{over ? "Rest over — go!" : "Rest"}</span>
        <span className="rest-time">{over ? "0:00" : mmss(remaining)}</span>
      </div>
      <div className="rest-controls">
        {/* Two rows: add on top, subtract below, aligned by size (15 | 30). */}
        <div className="rest-adjust">
          <button className="radj plus" onClick={() => adjust(15)}>+15s</button>
          <button className="radj plus" onClick={() => adjust(30)}>+30s</button>
          <button className="radj" onClick={() => adjust(-15)}>−15s</button>
          <button className="radj" onClick={() => adjust(-30)}>−30s</button>
        </div>
        <button className="rest-skip" onClick={() => onChange(null)}>
          {over ? "Dismiss" : "Skip"}
        </button>
      </div>
    </div>
  );
}
