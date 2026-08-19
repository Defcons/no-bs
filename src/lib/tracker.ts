// GPS route recorder for tracked cardio (a run/walk/ride). Uses the same
// background-geolocation foreground-service as the leave-area geofence, so it keeps
// logging with the screen off. Native only.
//
// Fixes are buffered NATIVELY (see the patch-package patch to the plugin's
// BackgroundGeolocationService): the FGS keeps receiving GPS fixes with the screen
// off, but the WebView JS is suspended then, so the per-fix JS callback would MISS
// those fixes and the map would show a straight "airline" line across the gap. We
// therefore DRAIN the native buffer — periodically while foregrounded (live map) and
// once more on stop — so the saved track includes every screen-off fix.
//
// OTA-safety: getBufferedLocations() only exists in the patched (new) APK. A JS
// bundle can reach a device via Capgo OTA BEFORE that device updates the native APK,
// so we probe the method at start and fall back to the old JS-callback recording on
// an un-patched native build (the screen-off gap simply remains there until the APK
// updates) — the OTA never breaks tracking on a not-yet-updated install. Screen-off
// fixes carry no HR (the BLE strap runs through the WebView too, likewise suspended).
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TrackPoint } from "../types";

interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  time: number; // epoch ms of the fix (from the native Location)
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
  // NoBS patch (new APK only): drain the native fix buffer for a watcher (fixes
  // collected while the WebView JS was suspended, e.g. screen off) and clear it.
  getBufferedLocations(options: { id: string }): Promise<{ locations: BgLocation[] }>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

const MAX_ACCURACY_M = 40; // drop obviously-bad fixes
const DRAIN_MS = 4000; // how often to pull the native buffer while foregrounded
const HR_FRESH_MS = 8000; // only stamp HR on fixes that just arrived (foreground)

let watcherId: string | null = null;
let starting = false; // a start() is mid-await
// Bumped by every start/stop. A start whose generation went stale across an await
// was superseded (stop, or stop→start) and must clean up its own watcher instead of
// claiming state — a bare boolean gets clobbered by overlapping cycles and leaves a
// live watcher wired to a dead recording session (same pattern as geofence.ts).
let gen = 0;
let points: TrackPoint[] = [];
let getHr: (() => number | null) | null = null;
let drainTimer: ReturnType<typeof setInterval> | null = null;
// "native": drain the buffer (patched APK). "legacy": record in the JS callback
// (old APK, screen-off gap remains). "pending": still probing at start.
let recordMode: "pending" | "native" | "legacy" = "pending";

export function isTracking(): boolean {
  return watcherId != null;
}

// Pull everything the native side has buffered since the last drain, filter bad
// fixes, and append. HR is stamped only on fixes fresh enough to be foreground
// (screen-off fixes have no live HR to attach anyway).
async function drain(id: string): Promise<void> {
  let batch: BgLocation[];
  try {
    ({ locations: batch } = await BackgroundGeolocation.getBufferedLocations({ id }));
  } catch {
    return; // plugin gone / watcher removed — nothing to add
  }
  const now = Date.now();
  for (const p of batch) {
    if (p.accuracy > MAX_ACCURACY_M) continue;
    const hr = now - p.time <= HR_FRESH_MS ? (getHr?.() ?? undefined) : undefined;
    points.push({ t: p.time, lat: p.latitude, lng: p.longitude, hr });
  }
}

// Start recording. getBpm lets us stamp fresh (foreground) points with the live HR.
export async function startTracking(getBpm: () => number | null): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || watcherId || starting) return false;
  const myGen = ++gen;
  starting = true;
  points = [];
  recordMode = "pending";
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
      // In "native" mode the buffer is the source of truth, so this no-ops; in
      // "legacy"/"pending" mode it records fixes the old way (foreground only).
      (position, error) => {
        if (recordMode === "native") return;
        if (error || !position || position.accuracy > MAX_ACCURACY_M) return;
        const hr = getHr?.() ?? undefined;
        points.push({ t: position.time ?? Date.now(), lat: position.latitude, lng: position.longitude, hr });
      },
    );
    if (gen !== myGen) {
      // stopTracking() (or a stop→start) ran while we awaited → tear it back down.
      await BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      return false;
    }

    // Probe native buffering; old native builds reject → legacy JS-callback mode.
    // Assigned to the shared recordMode only AFTER the staleness check — a stale
    // start must not clobber the mode a successor already established.
    let mode: "native" | "legacy";
    try {
      await BackgroundGeolocation.getBufferedLocations({ id }); // resolves (and clears) on the patched APK
      mode = "native";
    } catch {
      mode = "legacy";
    }
    if (gen !== myGen) {
      await BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      return false;
    }
    recordMode = mode;

    watcherId = id;
    if (recordMode === "native") {
      points = []; // drop pending-mode pushes; the native buffer (filled since addWatcher) is authoritative
      drainTimer = setInterval(() => void drain(id), DRAIN_MS);
    }
    return true;
  } catch {
    return false; // permission denied / plugin error — recording just stays off
  } finally {
    // Only the current generation may release the lock (a stale start clearing it
    // would let two starts run concurrently).
    if (gen === myGen) starting = false;
  }
}

export function currentTrack(): TrackPoint[] {
  return points.slice();
}

// Stop recording and return the collected track (final native drain included).
export async function stopTracking(): Promise<TrackPoint[]> {
  gen++; // invalidate any in-flight start (it cleans up after itself on resolve)
  starting = false;
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
  if (watcherId) {
    const id = watcherId;
    watcherId = null;
    if (recordMode === "native") await drain(id); // grab anything buffered since the last tick (incl. screen-off)
    getHr = null;
    recordMode = "pending";
    try {
      await BackgroundGeolocation.removeWatcher({ id });
    } catch {
      /* already gone */
    }
  }
  return points.slice();
}
