// Leave-area auto-end. When a (non-Alternative) workout starts, we anchor to where
// you are on the first GPS fix; if you then move more than ~100 m away for 5 min
// while the workout is running, onLeave() fires so the session auto-saves. Uses a
// background foreground-service so it works with the screen off. Native only.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { getSetting } from "../db";

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

type LatLng = { lat: number; lng: number };

// Great-circle distance in metres.
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const RADIUS_M = 100; // how far counts as "left the area"
const EXIT_GRACE_MS = 5 * 60 * 1000; // ...sustained for this long
const ANCHOR_MAX_ACCURACY_M = 75; // ignore junk fixes when anchoring

let watcherId: string | null = null;
let starting = false; // a start() is mid-await (addWatcher not yet resolved)

// Begin watching for an active workout. Anchors to the first decent fix, then
// fires onLeave() once you've been >RADIUS_M away for EXIT_GRACE_MS. No-op when the
// toggle is off or not on native. Returns whether a watcher actually started.
export async function startGeofence(onLeave: () => void): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || watcherId || starting) return false;
  starting = true;
  try {
    if (!(await getSetting<boolean>("autoEndOnLeave", false))) return false;

    let anchor: LatLng | null = null;
    let outsideSince: number | null = null;
    let fired = false;

    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "NoBS – Workout Log",
        backgroundMessage: "Auto-saves your workout when you leave the area.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (position, error) => {
        if (error || !position || fired) return;
        const here = { lat: position.latitude, lng: position.longitude };
        if (!anchor) {
          if (position.accuracy <= ANCHOR_MAX_ACCURACY_M) anchor = here; // lock the start spot
          return;
        }
        const d = distanceM(anchor, here);
        const outside = d - position.accuracy > RADIUS_M;
        const inside = d + position.accuracy < RADIUS_M;
        if (inside) {
          outsideSince = null;
        } else if (outside) {
          outsideSince ??= Date.now();
          if (Date.now() - outsideSince >= EXIT_GRACE_MS) {
            fired = true;
            void stopGeofence(); // stop GPS immediately, don't wait on React cleanup
            onLeave();
          }
        }
      },
    );
    // stopGeofence() ran while we were awaiting the watcher → tear it right back down.
    if (!starting) {
      await BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      return false;
    }
    watcherId = id;
    return true;
  } catch {
    return false; // permission denied / plugin error — feature just stays off
  } finally {
    starting = false;
  }
}

export async function stopGeofence(): Promise<void> {
  starting = false; // cancel any in-flight start
  if (!watcherId) return;
  const id = watcherId;
  watcherId = null;
  try {
    await BackgroundGeolocation.removeWatcher({ id });
  } catch {
    /* already gone */
  }
}
