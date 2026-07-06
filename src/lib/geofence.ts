// Leave-gym auto-end. When a (non-Alternative) workout is running, watch location
// via a background foreground-service (so it fires even with the screen off); when
// you've been outside the gym radius for a sustained period, call onLeave() so the
// session auto-finishes. Native (Android) only — a no-op on the web build.
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
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

export type GymLocation = { lat: number; lng: number };

// Great-circle distance in metres.
export function distanceM(a: GymLocation, b: GymLocation): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function getGym(): Promise<{ gym: GymLocation | null; radius: number; enabled: boolean }> {
  const lat = await getSetting<number>("gymLat", NaN);
  const lng = await getSetting<number>("gymLng", NaN);
  return {
    gym: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    radius: await getSetting<number>("gymRadiusM", 150),
    enabled: await getSetting<boolean>("autoEndOnLeave", false),
  };
}

// One-shot: grab the current position (to save as the gym location). Resolves on
// the first fix; rejects on permission denial or timeout.
export function captureLocation(): Promise<GymLocation> {
  if (!Capacitor.isNativePlatform()) return Promise.reject(new Error("Native only"));
  return new Promise((resolve, reject) => {
    let id = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        if (id) BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
        reject(new Error("Timed out getting a GPS fix — try again outdoors."));
      }
    }, 30000);
    BackgroundGeolocation.addWatcher(
      { requestPermissions: true, stale: false, distanceFilter: 0 },
      (position, error) => {
        if (settled) return;
        if (error) {
          settled = true;
          clearTimeout(timeout);
          if (id) BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
          reject(new Error(error.code === "NOT_AUTHORIZED" ? "Location permission denied." : error.message));
          return;
        }
        if (position) {
          settled = true;
          clearTimeout(timeout);
          if (id) BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
          resolve({ lat: position.latitude, lng: position.longitude });
        }
      },
    ).then((wid) => {
      id = wid;
      if (settled) BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
    });
  });
}

const EXIT_GRACE_MS = 2 * 60 * 1000; // must be clearly gone, not a GPS blip

let watcherId: string | null = null;

// Begin watching. Fires onLeave() at most once, after you've been confirmed at the
// gym and then outside the radius for EXIT_GRACE_MS. Safe to call when not
// configured (does nothing). Returns whether a watcher actually started.
export async function startGeofence(onLeave: () => void): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || watcherId) return false;
  const { gym, radius, enabled } = await getGym();
  if (!enabled || !gym) return false;

  let wasInside = false; // don't auto-end until we've actually detected being there
  let outsideSince: number | null = null;
  let fired = false;

  watcherId = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: "Gym Tracker",
      backgroundMessage: "Watching so your workout auto-saves when you leave the gym.",
      requestPermissions: true,
      stale: false,
      distanceFilter: 25,
    },
    (position, error) => {
      if (error || !position || fired) return;
      const d = distanceM(gym, { lat: position.latitude, lng: position.longitude });
      // Count as "outside" only when clearly beyond the radius given GPS accuracy.
      const outside = d - position.accuracy > radius;
      const inside = d + position.accuracy < radius;
      if (inside) {
        wasInside = true;
        outsideSince = null;
      } else if (outside && wasInside) {
        outsideSince ??= Date.now();
        if (Date.now() - outsideSince >= EXIT_GRACE_MS) {
          fired = true;
          onLeave();
        }
      }
    },
  );
  return true;
}

export async function stopGeofence(): Promise<void> {
  if (!watcherId) return;
  const id = watcherId;
  watcherId = null;
  try {
    await BackgroundGeolocation.removeWatcher({ id });
  } catch {
    /* already gone */
  }
}
