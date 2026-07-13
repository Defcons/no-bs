// Break-over alarm sounds — synthesized with Web Audio so there are no audio files
// to bundle (and they play instantly, offline). Pick one in Settings.

// One shared AudioContext for the whole app — a fresh one per play leaks contexts
// and hits the browser's ~6-per-page limit, after which alarms go silent.
let sharedCtx: AudioContext | null = null;
function ctx(): AudioContext {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!sharedCtx) sharedCtx = new Ctx();
  return sharedCtx;
}

export type BreakSoundId = "beep" | "bell" | "airhorn" | "powerup" | "alarm" | "chime";
export const BREAK_SOUNDS: { id: BreakSoundId; label: string }[] = [
  { id: "beep", label: "Triple beep" },
  { id: "bell", label: "Boxing bell" },
  { id: "airhorn", label: "Air horn" },
  { id: "powerup", label: "Power-up" },
  { id: "alarm", label: "Urgent alarm" },
  { id: "chime", label: "Chime" },
];

// A single enveloped tone.
function tone(c: AudioContext, type: OscillatorType, freq: number, start: number, dur: number, gain = 0.4): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.connect(g);
  g.connect(c.destination);
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.start(start);
  o.stop(start + dur + 0.02);
}

// A metallic strike: inharmonic partials with a long decay (bell / gong).
function strike(c: AudioContext, base: number, start: number, dur: number, gain = 0.3): void {
  [1, 2.76, 5.4, 8.9].forEach((ratio, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    o.type = "sine";
    o.frequency.value = base * ratio;
    const peak = gain / (i + 1);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.start(start);
    o.stop(start + dur + 0.02);
  });
}

export function playBreakSound(id: BreakSoundId): void {
  try {
    const c = ctx();
    if (c.state === "suspended") void c.resume();
    const t = c.currentTime;
    switch (id) {
      case "bell":
        strike(c, 520, t, 1.1);
        strike(c, 520, t + 0.32, 1.2);
        break;
      case "airhorn":
        [0, 0.42].forEach((d) => {
          tone(c, "sawtooth", 180, t + d, 0.34, 0.35);
          tone(c, "sawtooth", 226, t + d, 0.34, 0.28);
        });
        break;
      case "powerup": // fast rising arpeggio (8-bit)
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, "square", f, t + i * 0.075, 0.09, 0.32));
        break;
      case "alarm": // alternating two-tone urgency
        [0, 1, 2, 3, 4].forEach((i) => tone(c, "square", i % 2 ? 660 : 880, t + i * 0.16, 0.14, 0.34));
        break;
      case "chime": // pleasant descending triad
        [988, 784, 659].forEach((f, i) => tone(c, "sine", f, t + i * 0.14, 0.5, 0.32));
        break;
      case "beep":
      default: // three ascending square beeps
        [700, 900, 1100].forEach((f, i) => tone(c, "square", f, t + i * 0.28, 0.22, 0.4));
        break;
    }
  } catch {
    /* audio blocked — vibration + notification still fire */
  }
}
