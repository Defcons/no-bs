// Hardware buttons (Android). While armed, volume-up is captured and reported
// instead of changing the volume — used to start the break timer hands-free.
// Backed by the custom native HwButtons plugin (android/.../HwButtonsPlugin.java).
// No-op on the web and on APKs older than the plugin (calls just reject).
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface HwButtonsPlugin {
  setCapture(options: { enabled: boolean }): Promise<void>;
  setMediaCapture(options: { enabled: boolean }): Promise<void>;
  addListener(event: "volumeKey" | "mediaButton", cb: () => void): Promise<PluginListenerHandle>;
}

const HwButtons = registerPlugin<HwButtonsPlugin>("HwButtons");

const native = () => Capacitor.isNativePlatform();

// Arm/disarm volume-key capture (both up and down). Arm ONLY while a workout is
// active — while armed the volume keys no longer change media volume. Only works
// while the app is in the FOREGROUND (Android doesn't deliver volume keys to a
// backgrounded/PiP app).
export async function setVolumeCapture(enabled: boolean): Promise<void> {
  if (!native()) return;
  try {
    await HwButtons.setCapture({ enabled });
  } catch {
    /* plugin missing (old APK) */
  }
}

// Arm/disarm headphone/media-button capture. While armed, the headset button
// starts the break INSTEAD of controlling music — a deliberate, opt-in trade-off.
export async function setMediaButtonCapture(enabled: boolean): Promise<void> {
  if (!native()) return;
  try {
    await HwButtons.setMediaCapture({ enabled });
  } catch {
    /* plugin missing (old APK) */
  }
}

function listen(event: "volumeKey" | "mediaButton", cb: () => void): () => void {
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

export const onVolumeKey = (cb: () => void): (() => void) => listen("volumeKey", cb);
export const onMediaButton = (cb: () => void): (() => void) => listen("mediaButton", cb);
