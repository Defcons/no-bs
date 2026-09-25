// Native hardware step counter (StepCounterPlugin.java). Counts the active workout's
// steps via Android TYPE_STEP_COUNTER — keeps counting with the screen off, unlike the
// WebView's accelerometer. All calls are OTA-safe: they no-op (return 0 / false) on web
// or on an APK without the plugin, so a JS bundle can reach a device before it updates
// its native shell without breaking.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { getSetting, setSetting } from "../db";
import { computeRun, segmentTrack } from "./runStats";
import type { StepSample, TrackPoint } from "../types";

interface StepCounterPlugin {
  available(): Promise<{ available: boolean }>;
  start(): Promise<void>;
  getCount(): Promise<{ steps: number }>;
  stop(): Promise<{ steps: number }>;
  getSamples?(): Promise<{ samples: StepSample[] }>; // patched APK only (1.72+); OTA-safe
}

const StepCounter = registerPlugin<StepCounterPlugin>("StepCounter");
const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("StepCounter");

// Begin counting for a new session (marks the baseline). Returns whether it started —
// false on web, no plugin, no sensor, or a declined ACTIVITY_RECOGNITION permission.
export async function startSteps(): Promise<boolean> {
  if (!native()) return false;
  try {
    await StepCounter.start();
    return true;
  } catch {
    return false;
  }
}

// Steps since startSteps(). 0 when unavailable.
export async function currentSteps(): Promise<number> {
  if (!native()) return 0;
  try {
    return (await StepCounter.getCount()).steps;
  } catch {
    return 0;
  }
}

// Drain the native timestamped cadence buffer (cumulative steps at each sensor event)
// collected this session. Empty on web, an un-updated APK (getSamples not implemented →
// the call rejects), or when the sensor reported nothing. Call before stopSteps() (the
// sensor must still be listening). Feeds cadence-based walk/run segmentation (segments.ts).
export async function drainStepSamples(): Promise<StepSample[]> {
  if (!native()) return [];
  try {
    return (await StepCounter.getSamples?.())?.samples ?? [];
  } catch {
    return []; // old APK without getSamples → no cadence stream, just the total
  }
}

// Stop counting and release the sensor; returns the session total. 0 when unavailable.
export async function stopSteps(): Promise<number> {
  if (!native()) return 0;
  try {
    return (await StepCounter.stop()).steps;
  } catch {
    return 0;
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

// Learn the stride from a run/walk with RELIABLE GPS: stride = smoothed GPS distance ÷
// steps, folded into the matching (walk/run) average. Skipped when GPS gapped a lot (the
// distance would be an undercount → wrong stride), too few steps, or an implausible
// result. Fire-and-forget on finish. This is what lets `steps × stride` stand in as an
// independent distance the GPS dropouts can't undercount (shown alongside the run).
export async function calibrateStride(track: TrackPoint[] | undefined, steps: number): Promise<void> {
  if (!track || track.length < 2 || steps < 400) return;
  const run = computeRun(track);
  if (!run || run.distanceM < 300) return;
  const totalMs = track[track.length - 1].t - track[0].t;
  let gapMs = 0;
  for (const seg of segmentTrack(track)) {
    if (seg.gap && seg.points.length >= 2) gapMs += seg.points[seg.points.length - 1].t - seg.points[0].t;
  }
  if (totalMs <= 0 || gapMs / totalMs > 0.15) return; // GPS unreliable → don't trust distance÷steps
  const stride = run.distanceM / steps;
  if (stride < 0.4 || stride > 1.6) return; // implausible (bad steps or bad GPS)
  await foldStride(stride, steps, totalMs / 1000, 0.25);
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
