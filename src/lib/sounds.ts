// Break-over alarm sounds — synthesized with Web Audio so there are no audio files
// to bundle (and they play instantly, offline). Pick one in Settings.
import { duckAudio } from "./hwButtons";
import { getCustomSound } from "../db";

// One shared AudioContext for the whole app — a fresh one per play leaks contexts
// and hits the browser's ~6-per-page limit, after which alarms go silent.
let sharedCtx: AudioContext | null = null;
function ctx(): AudioContext {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!sharedCtx) sharedCtx = new Ctx();
  return sharedCtx;
}

export type BreakSoundId =
  | "beep"
  | "bell"
  | "airhorn"
  | "powerup"
  | "alarm"
  | "chime"
  | "wardrums"
  | "powerkick"
  | "drumroll";
export const BREAK_SOUNDS: { id: BreakSoundId; label: string }[] = [
  { id: "beep", label: "Triple beep" },
  { id: "wardrums", label: "War drums" },
  { id: "powerkick", label: "Power kick" },
  { id: "drumroll", label: "Drum roll" },
  { id: "bell", label: "Boxing bell" },
  { id: "airhorn", label: "Air horn" },
  { id: "powerup", label: "Power-up" },
  { id: "alarm", label: "Urgent alarm" },
  { id: "chime", label: "Chime" },
];

// --- Drum synthesis ---------------------------------------------------------
// Reused white-noise buffer for the "skin slap" transient on each hit.
let noiseBuf: AudioBuffer | null = null;
function noiseSource(c: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

// One membrane drum hit: a pitch-dropping body (f0→f1) + a short filtered
// noise burst for the attack. Higher f0/shorter dur = tight kick; lower/longer = taiko.
function drum(c: AudioContext, t: number, f0: number, f1: number, dur: number, gain: number, noise = 0.25): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.connect(g);
  g.connect(c.destination);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.5);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
  if (noise > 0) {
    const n = noiseSource(c);
    const ng = c.createGain();
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    n.connect(hp);
    hp.connect(ng);
    ng.connect(c.destination);
    ng.gain.setValueAtTime(noise, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.start(t);
    n.stop(t + 0.07);
  }
}

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

// --- Custom (user-uploaded) sounds ------------------------------------------
// The break value is either a built-in BreakSoundId or "custom:<dbId>".
export const CUSTOM_PREFIX = "custom:";
export const isCustom = (v: string): boolean => v.startsWith(CUSTOM_PREFIX);
export const customIdOf = (v: string): number => Number(v.slice(CUSTOM_PREFIX.length));

// Decode an uploaded audio blob into a ready-to-play buffer (mp3/wav/ogg/m4a).
// Pre-decode when the sound is selected so playback at break-end is instant.
export async function decodeSound(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer();
  return ctx().decodeAudioData(buf);
}

export function playBuffer(buffer: AudioBuffer): void {
  try {
    const c = ctx();
    if (c.state === "suspended") void c.resume();
    void duckAudio(Math.min(6000, Math.round(buffer.duration * 1000) + 300));
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buffer;
    src.connect(g);
    g.connect(c.destination);
    src.start();
  } catch {
    /* audio blocked */
  }
}

// A very faint short tick for the optional "3..2..1" pre-end countdown. The final
// tick (isFinal) is a touch higher/brighter so "1 → go" reads clearly.
export function playCountdownTick(isFinal = false): void {
  try {
    const c = ctx();
    if (c.state === "suspended") void c.resume();
    // Duck a bit past one second so music stays dimmed across the 3-2-1 ticks
    // instead of bobbing back up between them.
    void duckAudio(1200);
    tone(c, "sine", isFinal ? 1320 : 880, c.currentTime, 0.09, isFinal ? 0.18 : 0.12);
  } catch {
    /* audio blocked */
  }
}

// A short, subtle rising blip confirming a break just STARTED — feedback for
// hardware-button (volume/headset) starts where there's nothing on screen to see.
export function playBreakStart(): void {
  try {
    const c = ctx();
    if (c.state === "suspended") void c.resume();
    void duckAudio(900);
    const t = c.currentTime;
    tone(c, "sine", 660, t, 0.08, 0.25);
    tone(c, "sine", 990, t + 0.07, 0.1, 0.25);
  } catch {
    /* audio blocked */
  }
}

export function playBreakSound(id: BreakSoundId): void {
  try {
    const c = ctx();
    if (c.state === "suspended") void c.resume();
    void duckAudio(2600); // longest alarm patterns run ~2s; dim music over them
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
      case "wardrums": // deep taiko pattern building to a final boom
        drum(c, t + 0.0, 150, 50, 0.45, 0.5);
        drum(c, t + 0.28, 150, 50, 0.45, 0.55);
        drum(c, t + 0.56, 165, 55, 0.4, 0.6);
        drum(c, t + 0.78, 190, 60, 0.9, 0.85, 0.4); // the big hit
        break;
      case "powerkick": // four hard electronic kicks
        [0, 0.22, 0.44, 0.66].forEach((d, i) => drum(c, t + d, 170, 42, 0.2, i === 3 ? 0.9 : 0.7, 0.35));
        break;
      case "drumroll": {
        // accelerating roll of taps into one big boom
        let d = 0;
        let gap = 0.11;
        for (let i = 0; i < 12; i++) {
          drum(c, t + d, 220, 90, 0.12, 0.35, 0.3);
          d += gap;
          gap *= 0.86; // speed up
        }
        drum(c, t + d + 0.04, 190, 55, 0.9, 0.9, 0.45); // final boom
        break;
      }
      case "beep":
      default: // three ascending square beeps
        [700, 900, 1100].forEach((f, i) => tone(c, "square", f, t + i * 0.28, 0.22, 0.4));
        break;
    }
  } catch {
    /* audio blocked — vibration + notification still fire */
  }
}

// Play a chosen sound — a preset id ("beep"…) or "custom:<dbId>" (loads the user's
// blob). Shared by the Settings sound pickers and the low-heart-rate warning.
export async function playSoundChoice(v: string): Promise<void> {
  if (isCustom(v)) {
    const rec = await getCustomSound(customIdOf(v));
    if (rec) playBuffer(await decodeSound(rec.blob));
  } else {
    playBreakSound(v as BreakSoundId);
  }
}
