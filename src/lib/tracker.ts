// GPS route recorder for tracked cardio (a run/walk/ride). Uses the same
// background-geolocation foreground-service as the leave-area geofence, so it keeps
// logging with the screen off. Native only. Points are kept in memory and returned
// on stop so the caller can attach them to the finished workout.
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TrackPoint } from "../types";

interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}
interface BgError {
  code?: string;
  message: string;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: BgLocation, error?: BgError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

const MAX_ACCURACY_M = 40; // drop obviously-bad fixes

let watcherId: string | null = null;
let starting = false; // a start() is mid-await
let points: TrackPoint[] = [];
let getHr: (() => number | null) | null = null;

export function isTracking(): boolean {
  return watcherId != null;
}

// Start recording. getBpm lets us stamp each point with the live heart rate.
export async function startTracking(getBpm: () => number | null): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || watcherId || starting) return false;
  starting = true;
  points = [];
  getHr = getBpm;
  try {
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "NoBS – Workout Log",
        backgroundMessage: "Recording your route.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 5,
      },
      (position, error) => {
        if (error || !position || position.accuracy > MAX_ACCURACY_M) return;
        const hr = getHr?.() ?? undefined;
        points.push({ t: Date.now(), lat: position.latitude, lng: position.longitude, hr: hr ?? undefined });
      },
    );
    if (!starting) {
      // stopTracking() ran while we awaited the watcher → tear it back down.
      await BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      return false;
    }
    watcherId = id;
    return true;
  } catch {
    return false; // permission denied / plugin error — recording just stays off
  } finally {
    starting = false;
  }
}

export function currentTrack(): TrackPoint[] {
  return points.slice();
}

// Stop recording and return the collected track.
export async function stopTracking(): Promise<TrackPoint[]> {
  starting = false; // cancel any in-flight start
  const track = points.slice();
  if (watcherId) {
    const id = watcherId;
    watcherId = null;
    getHr = null;
    try {
      await BackgroundGeolocation.removeWatcher({ id });
    } catch {
      /* already gone */
    }
  }
  return track;
}
