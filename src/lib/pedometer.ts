// Native hardware step counter (StepCounterPlugin.java). Counts the active workout's
// steps via Android TYPE_STEP_COUNTER — keeps counting with the screen off, unlike the
// WebView's accelerometer. All calls are OTA-safe: they no-op (return 0 / false) on web
// or on an APK without the plugin, so a JS bundle can reach a device before it updates
// its native shell without breaking.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { getSetting, setSetting } from "../db";
import { computeRun, segmentTrack } from "./runStats";
import type { TrackPoint } from "../types";

interface StepCounterPlugin {
  available(): Promise<{ available: boolean }>;
  start(): Promise<void>;
  getCount(): Promise<{ steps: number }>;
  stop(): Promise<{ steps: number }>;
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

// Stop counting and release the sensor; returns the session total. 0 when unavailable.
export async function stopSteps(): Promise<number> {
  if (!native()) return 0;
  try {
    return (await StepCounter.stop()).steps;
  } catch {
    return 0;
  }
}

// --- Stride: turn a step count into a distance, learned from the user's GPS runs ---
// A default adult stride (m/step) until the user's own is learned.
export const DEFAULT_STRIDE_M = 0.74;

// The stored, GPS-learned stride (rolling average). Read at display time.
export async function strideM(): Promise<number> {
  return getSetting<number>("strideM", DEFAULT_STRIDE_M);
}

// Learn the stride from a run with RELIABLE GPS: stride = smoothed GPS distance ÷ steps,
// folded into a rolling average. Skipped when GPS gapped a lot (the distance would be an
// undercount → wrong stride), too few steps, or an implausible result. Fire-and-forget
// on finish. This is what lets `steps × stride` stand in as an independent distance the
// GPS dropouts can't undercount (shown alongside the run in History).
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
  if (stride < 0.4 || stride > 1.2) return; // implausible (bad steps or bad GPS)
  const cur = await getSetting<number>("strideM", DEFAULT_STRIDE_M);
  await setSetting("strideM", Math.round((cur * 0.75 + stride * 0.25) * 1000) / 1000);
}

// Learn the stride from a treadmill's OWN displayed distance (ground truth the user
// types in) ÷ steps. More reliable than a GPS-learned stride, so weighted a bit heavier
// in the rolling average. Same plausibility guards. Called when the user enters a
// treadmill session's real distance in History.
export async function calibrateStrideFromDistance(distanceM: number, steps: number): Promise<void> {
  if (!(distanceM > 0) || steps < 200) return;
  const stride = distanceM / steps;
  if (stride < 0.4 || stride > 1.2) return; // implausible (bad steps or a mistyped distance)
  const cur = await getSetting<number>("strideM", DEFAULT_STRIDE_M);
  await setSetting("strideM", Math.round((cur * 0.6 + stride * 0.4) * 1000) / 1000);
}
