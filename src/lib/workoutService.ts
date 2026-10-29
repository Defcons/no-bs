// Workout foreground service (standard build). On a locked phone Android can freeze a
// backgrounded app, so the earbud break may miss; NoBS Extended stays alive through its
// accessibility service. While this service runs, the app stays alive behind one quiet
// "Workout in progress" notification. Backed by WorkoutServicePlugin.java; a no-op on
// the web and on APKs older than the plugin.
import { Capacitor, registerPlugin } from "@capacitor/core";

interface WorkoutServicePlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const WorkoutService = registerPlugin<WorkoutServicePlugin>("WorkoutService");

const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("WorkoutService");

export async function setWorkoutService(on: boolean): Promise<void> {
  if (!native()) return;
  try {
    await (on ? WorkoutService.start() : WorkoutService.stop());
  } catch {
    /* not allowed right now (no activity permission, or started from the background) */
  }
}
