// Native hardware step counter (StepCounterPlugin.java). Counts the active workout's
// steps via Android TYPE_STEP_COUNTER — keeps counting with the screen off, unlike the
// WebView's accelerometer. All calls are OTA-safe: they no-op (return 0 / false) on web
// or on an APK without the plugin, so a JS bundle can reach a device before it updates
// its native shell without breaking.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { getSetting, setSetting } from "../db";
import { breakSecWithin, computeRun, segmentTrack } from "./runStats";
import type { StepSample, TrackPoint, WorkoutBreak } from "../types";

interface StepCounterPlugin {
  available(): Promise<{ available: boolean }>;
  start(): Promise<void>;
  getCount(): Promise<{ steps: number }>;
  stop(): Promise<{ steps: number }>;
  getSamples?(): Promise<{ samples: StepSample[] }>; // patched APK only (1.72+); OTA-safe
}

const StepCounter = registerPlugin<StepCounterPlugin>("StepCounter");
const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("StepCounter");

// The native count restarts at 0 on every start(), and a reload mid-workout (an OTA
// apply, Android dropping the WebView) starts the JS fresh. So the session's steps so far
// (`offset`) and its drained samples (`kept`) are saved under SAVED_KEY every SAVE_MS
// and when the app goes to the background, and a start for the same session takes them
// back (audit DAT-3).
const SAVED_KEY = "activeSteps";
const SAVE_MS = 30_000;
type SavedSteps = { session: number; steps: number; samples: StepSample[] };
let session: number | null = null;
let offset = 0;
let kept: StepSample[] = [];
let saveTimer: ReturnType<typeof setInterval> | null = null;

// Move the native samples into `kept`, on the session's running count.
async function pullSamples(): Promise<void> {
  try {
    const got = (await StepCounter.getSamples?.())?.samples ?? [];
    for (const s of got) kept.push({ t: s.t, steps: s.steps + offset });
  } catch {
    /* old APK without getSamples */
  }
}
async function saveSteps(): Promise<void> {
  if (session == null) return;
  const s = session;
  await pullSamples();
  const steps = await currentSteps();
  // One sample per 2 s is plenty for cadence and keeps the row small.
  const thin = kept.filter((x, i) => i === 0 || i === kept.length - 1 || x.t - kept[i - 1].t >= 2000);
  const row: SavedSteps = { session: s, steps, samples: thin };
  await setSetting(SAVED_KEY, row).catch(() => {});
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && session != null) void saveSteps();
  });
}

// Begin counting for a session (marks the baseline). Returns whether it started —
// false on web, no plugin, no sensor, or a declined ACTIVITY_RECOGNITION permission.
export async function startSteps(sessionStart: number): Promise<boolean> {
  if (!native()) return false;
  if (session === sessionStart) {
    // Restarted within the same session: carry the count past the native reset.
    await pullSamples();
    offset = await currentSteps();
  } else {
    session = sessionStart;
    offset = 0;
    kept = [];
    const saved = await getSetting<SavedSteps | null>(SAVED_KEY, null).catch(() => null);
    if (saved?.session === sessionStart) {
      offset = saved.steps;
      kept = saved.samples ?? [];
    }
  }
  try {
    await StepCounter.start();
    if (!saveTimer) saveTimer = setInterval(() => void saveSteps(), SAVE_MS);
    return true;
  } catch {
    return false;
  }
}

// Steps since the session started. 0 when unavailable.
export async function currentSteps(): Promise<number> {
  if (!native()) return 0;
  try {
    return offset + (await StepCounter.getCount()).steps;
  } catch {
    return offset;
  }
}

// Drain the native timestamped cadence buffer (cumulative steps at each sensor event)
// collected this session. Empty on web, an un-updated APK (getSamples not implemented →
// the call rejects), or when the sensor reported nothing. Call before stopSteps() (the
// sensor must still be listening). Feeds cadence-based walk/run segmentation (segments.ts).
export async function drainStepSamples(): Promise<StepSample[]> {
  if (!native()) return [];
  await pullSamples(); // old APK without getSamples → no cadence stream, just the total
  const out = kept;
  kept = [];
  return out;
}

// Stop counting and release the sensor; returns the session total. 0 when unavailable.
export async function stopSteps(): Promise<number> {
  if (!native()) return 0;
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  const base = offset;
  session = null;
  offset = 0;
  kept = [];
  void setSetting(SAVED_KEY, null).catch(() => {});
  try {
    return base + (await StepCounter.stop()).steps;
  } catch {
    return base;
  }
}

// --- Stride: turn a step count into a distance, learned from the user's own data ---
// Stride length depends on SPEED, so we keep TWO learned strides — walking + running —
// and pick between them by CADENCE (steps/min), which is independent of stride length. A
// walk calibration no longer drags the run stride around, and vice-versa. Both fall back
// to the legacy single `strideM` (so an existing calibration carries over) then to a
// mode default; calibration writes the split keys, never the legacy one.
export const DEFAULT_STRIDE_M = 0.74; // legacy single-stride default + the migration seed
const DEFAULT_STRIDE_WALK_M = 0.72;
const DEFAULT_STRIDE_RUN_M = 1.1;
// Cadence at/above which a session counts as RUNNING (steps/min). Walking tops out ~130,
// running starts ~150. Tunable once real walk+run data exists (see docs/ToDo.md).
export const WALK_RUN_CADENCE_SPM = 135;

// steps/min over MOVING time. false when we can't tell (no time) → treat as walking.
export function isRunningCadence(steps: number, movingSec: number): boolean {
  return movingSec > 0 && steps / (movingSec / 60) >= WALK_RUN_CADENCE_SPM;
}

// The two learned strides, read at display time. Each falls back to the legacy single
// `strideM` (existing calibration carries over) then to its mode default.
export async function strideWalkM(): Promise<number> {
  const v = await getSetting<number | null>("strideWalkM", null);
  return v ?? (await getSetting<number>("strideM", DEFAULT_STRIDE_WALK_M));
}
export async function strideRunM(): Promise<number> {
  const v = await getSetting<number | null>("strideRunM", null);
  return v ?? (await getSetting<number>("strideM", DEFAULT_STRIDE_RUN_M));
}
// Pick the stride for a session/moment by its cadence (steps over moving seconds).
export async function strideFor(steps: number, movingSec: number): Promise<number> {
  return isRunningCadence(steps, movingSec) ? strideRunM() : strideWalkM();
}

// Fold a freshly-measured stride into the WALK or RUN rolling average, chosen by cadence.
async function foldStride(measured: number, steps: number, movingSec: number, weight: number): Promise<void> {
  const run = isRunningCadence(steps, movingSec);
  const cur = run ? await strideRunM() : await strideWalkM();
  await setSetting(run ? "strideRunM" : "strideWalkM", Math.round((cur * (1 - weight) + measured * weight) * 1000) / 1000);
}

// Steps taken between two instants, read off the cumulative samples (linear between
// samples, clamped at the ends). 0 without at least two samples.
export function stepsBetween(samples: StepSample[] | undefined, t0: number, t1: number): number {
  if (!samples || samples.length < 2) return 0;
  const at = (t: number): number => {
    if (t <= samples[0].t) return samples[0].steps;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (t <= b.t) return b.t === a.t ? b.steps : a.steps + ((b.steps - a.steps) * (t - a.t)) / (b.t - a.t);
    }
    return samples[samples.length - 1].steps;
  };
  return Math.max(0, Math.round(at(t1) - at(t0)));
}

// The stride one track measures: smoothed GPS distance ÷ the steps taken WHILE it was
// recorded, plus the moving seconds that pick walk vs run. Null when GPS gapped a lot (the
// distance would be an undercount → wrong stride), too few steps, or an implausible
// result. The session's step total would count the lifting and the walk to the gym too,
// and the whole span would count the rests (audit LOG-7: a 0.72 m walk stride read 0.48
// and was folded in as a run).
export function strideSample(
  track: TrackPoint[] | undefined,
  samples: StepSample[] | undefined,
  breaks?: WorkoutBreak[],
): { stride: number; steps: number; movingSec: number } | null {
  if (!track || track.length < 2) return null;
  const t0 = track[0].t;
  const t1 = track[track.length - 1].t;
  const steps = stepsBetween(samples, t0, t1);
  if (steps < 400) return null;
  const run = computeRun(track);
  if (!run || run.distanceM < 300) return null;
  const totalMs = track[track.length - 1].t - track[0].t;
  let gapMs = 0;
  for (const seg of segmentTrack(track)) {
    if (seg.gap && seg.points.length >= 2) gapMs += seg.points[seg.points.length - 1].t - seg.points[0].t;
  }
  if (totalMs <= 0 || gapMs / totalMs > 0.15) return null; // GPS unreliable → don't trust distance÷steps
  const stride = run.distanceM / steps;
  if (stride < 0.4 || stride > 1.6) return null; // implausible (bad steps or bad GPS)
  return { stride, steps, movingSec: Math.max(1, totalMs / 1000 - breakSecWithin(breaks, t0, t1)) };
}

// Learn the stride from a run/walk with RELIABLE GPS (`strideSample`), folded into the
// matching (walk/run) average. Fire-and-forget on finish. This is what lets
// `steps × stride` stand in as an independent distance the GPS dropouts can't undercount.
export async function calibrateStride(track: TrackPoint[] | undefined, samples: StepSample[], breaks?: WorkoutBreak[]): Promise<void> {
  const m = strideSample(track, samples, breaks);
  if (m) await foldStride(m.stride, m.steps, m.movingSec, 0.25);
}

// Learn the stride from a treadmill's OWN displayed distance (ground truth the user types
// in) ÷ steps. More reliable than a GPS-learned stride, so weighted a bit heavier. Same
// plausibility guards; `movingSec` classifies walk vs run by cadence. Called from History.
export async function calibrateStrideFromDistance(distanceM: number, steps: number, movingSec: number): Promise<void> {
  if (!(distanceM > 0) || steps < 200) return;
  const stride = distanceM / steps;
  if (stride < 0.4 || stride > 1.6) return; // implausible (bad steps or a mistyped distance)
  await foldStride(stride, steps, movingSec, 0.4);
}
