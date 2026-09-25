// Hardware buttons (Android). While armed, volume-up is captured and reported
// instead of changing the volume — used to start the break timer hands-free.
// Backed by the custom native HwButtons plugin (android/.../HwButtonsPlugin.java).
// No-op on the web and on APKs older than the plugin (calls just reject).
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// Earbud volume-rocker event: direction of the press, and whether it was a double-press
// (only classified when `detectDouble` is armed; the phone-key path emits neither → break).
export type VolumeKeyEvent = { dir?: "up" | "down"; double?: boolean };

interface HwButtonsPlugin {
  setCapture(options: { enabled: boolean; detectDouble?: boolean }): Promise<void>;
  setPhoneKeyCapture(options: { enabled: boolean }): Promise<void>;
  duck(options: { durationMs: number }): Promise<void>;
  addListener(event: "volumeKey", cb: (data: VolumeKeyEvent) => void): Promise<PluginListenerHandle>;
}

const HwButtons = registerPlugin<HwButtonsPlugin>("HwButtons");

const native = () => Capacitor.isNativePlatform();

// Arm/disarm volume-key capture (both up and down). Arm ONLY while a workout is
// active — while armed the volume keys no longer change media volume. Only works
// while the app is in the FOREGROUND (Android doesn't deliver volume keys to a
// backgrounded/PiP app).
export async function setVolumeCapture(enabled: boolean, detectDouble = false): Promise<void> {
  if (!native()) return;
  try {
    await HwButtons.setCapture({ enabled, detectDouble });
  } catch {
    /* plugin missing (old APK) */
  }
}

// Arm/disarm the PHONE's own volume keys as a break trigger. While armed the phone
// volume buttons are CONSUMED (no volume change) and start/skip the break instead —
// opt-in, since it removes hardware volume control. Fires the same "volumeKey" event
// as the earbud path. Locked-screen support needs the extended accessibility service.
export async function setPhoneKeyCapture(enabled: boolean): Promise<void> {
  if (!native()) return;
  try {
    await HwButtons.setPhoneKeyCapture({ enabled });
  } catch {
    /* plugin missing (old APK) */
  }
}

// Duck a playing music app (dim, not pause) for ~durationMs while a break sound or
// countdown plays over it — via transient MAY_DUCK audio focus. No-op on web/old APKs.
export async function duckAudio(durationMs: number): Promise<void> {
  if (!native()) return;
  try {
    await HwButtons.duck({ durationMs });
  } catch {
    /* plugin missing (old APK) */
  }
}

function listen(event: "volumeKey", cb: (data: VolumeKeyEvent) => void): () => void {
  if (!native()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  HwButtons.addListener(event, cb)
    .then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    })
    .catch(() => {
      /* plugin missing (old APK) */
    });
  return () => {
    cancelled = true;
    handle?.remove();
  };
}

// The volumeKey callback receives {dir, double} for an earbud press; the phone-key path
// sends an empty object (treat as a single break).
export const onVolumeKey = (cb: (data: VolumeKeyEvent) => void): (() => void) => listen("volumeKey", cb);
