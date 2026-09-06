// Native hardware step counter (StepCounterPlugin.java). Counts the active workout's
// steps via Android TYPE_STEP_COUNTER — keeps counting with the screen off, unlike the
// WebView's accelerometer. All calls are OTA-safe: they no-op (return 0 / false) on web
// or on an APK without the plugin, so a JS bundle can reach a device before it updates
// its native shell without breaking.
import { Capacitor, registerPlugin } from "@capacitor/core";

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
