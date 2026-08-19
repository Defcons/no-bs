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
const REFINE_BY_M = 15; // upgrade the anchor to a fix at least this much more accurate
// Flip to true + rebuild the OTA bundle to trace anchor/distance/accuracy in logcat
// (Capacitor forwards console.log). This feature fails SILENTLY, so it needs a trace.
const DEBUG_GEO = false;
const glog = (m: string): void => {
  if (DEBUG_GEO) console.log("[geofence] " + m);
};

let watcherId: string | null = null;
let starting = false; // a start() is mid-await (addWatcher not yet resolved)
// Bumped by every start() and stop(). A start() whose generation went stale across
// an await was superseded (stop, or stop→start) — it must tear down anything it
// created and claim nothing. A bare boolean can't express this: overlapping
// stop→start cycles clobbered it, leaving a watcher alive whose callback belonged
// to a DEAD React effect (FGS notification up, leave-detection silently gone).
let gen = 0;

// Begin watching for an active workout. Anchors to the first decent fix, then
// fires onLeave() once you've been >RADIUS_M away for EXIT_GRACE_MS. No-op when the
// toggle is off or not on native. Returns whether a watcher actually started.
export async function startGeofence(onLeave: () => void): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || watcherId || starting) return false;
  const myGen = ++gen;
  starting = true;
  try {
    if (!(await getSetting<boolean>("autoEndOnLeave", false))) {
      glog("not started — 'Auto-end when I leave' is OFF");
      return false;
    }
    if (gen !== myGen) return false; // stopped/superseded while reading the setting
    glog("starting leave-area watcher");

    let anchor: LatLng | null = null;
    let anchorAcc = Infinity;
    let outsideSince: number | null = null;
    let fired = false;

    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "NoBS – Workout Log",
        backgroundMessage: "Finishing up — saves your workout when you leave.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (position, error) => {
        if (error || !position || fired) return;
        const here = { lat: position.latitude, lng: position.longitude };
        glog(`fix acc=${Math.round(position.accuracy)} anchor=${anchor ? `acc${Math.round(anchorAcc)}` : "none"}`);
        // Anchor to the FIRST fix. (The old ≤75 m accuracy gate meant an indoor gym
        // — where fixes are routinely 100 m+ — often never anchored, so the watcher
        // silently never fired, or anchored at the exit once you got a clean fix.)
        // Poor accuracy is handled by the accuracy-aware exit test below; and while
        // we're still inside, upgrade the anchor to any clearly-better fix so it
        // converges on the true start spot.
        if (!anchor) {
          anchor = here;
          anchorAcc = position.accuracy;
          return;
        }
        if (outsideSince == null && position.accuracy + REFINE_BY_M < anchorAcc && distanceM(anchor, here) < RADIUS_M) {
          anchor = here;
          anchorAcc = position.accuracy;
          return;
        }
        const d = distanceM(anchor, here);
        const outside = d - position.accuracy > RADIUS_M;
        const inside = d + position.accuracy < RADIUS_M;
        glog(`  d=${Math.round(d)} outside=${outside} inside=${inside} out=${outsideSince ? Math.round((Date.now() - outsideSince) / 1000) + "s" : "-"}`);
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
    // Stopped or superseded while awaiting the watcher → this one isn't ours to
    // keep; tear it right back down.
    if (gen !== myGen) {
      await BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      return false;
    }
    watcherId = id;
    return true;
  } catch {
    return false; // permission denied / plugin error — feature just stays off
  } finally {
    // Only the CURRENT generation may release the lock — a stale start clearing it
    // would let a second start() run concurrently with the one that superseded it.
    if (gen === myGen) starting = false;
  }
}

export async function stopGeofence(): Promise<void> {
  gen++; // invalidate any in-flight start (it cleans up after itself on resolve)
  starting = false;
  if (!watcherId) return;
  const id = watcherId;
  watcherId = null;
  try {
    await BackgroundGeolocation.removeWatcher({ id });
  } catch {
    /* already gone */
  }
}
