// Hardware buttons (Android). While armed, volume-up is captured and reported
// instead of changing the volume — used to start the break timer hands-free.
// Backed by the custom native HwButtons plugin (android/.../HwButtonsPlugin.java).
// No-op on the web and on APKs older than the plugin (calls just reject).
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface HwButtonsPlugin {
  setCapture(options: { enabled: boolean }): Promise<void>;
  setMediaCapture(options: { enabled: boolean }): Promise<void>;
  addListener(event: "volumeUp" | "mediaButton", cb: () => void): Promise<PluginListenerHandle>;
}

const HwButtons = registerPlugin<HwButtonsPlugin>("HwButtons");

const native = () => Capacitor.isNativePlatform();

// Arm/disarm volume-up capture. Arm ONLY while a workout is active — while armed
// the volume-up key no longer changes media volume.
export async function setVolumeUpCapture(enabled: boolean): Promise<void> {
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

function listen(event: "volumeUp" | "mediaButton", cb: () => void): () => void {
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

export const onVolumeUp = (cb: () => void): (() => void) => listen("volumeUp", cb);
export const onMediaButton = (cb: () => void): (() => void) => listen("mediaButton", cb);
