// Hardware buttons (Android). While armed, volume-up is captured and reported
// instead of changing the volume — used to start the break timer hands-free.
// Backed by the custom native HwButtons plugin (android/.../HwButtonsPlugin.java).
// No-op on the web and on APKs older than the plugin (calls just reject).
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface HwButtonsPlugin {
  setCapture(options: { enabled: boolean }): Promise<void>;
  addListener(event: "volumeUp", cb: () => void): Promise<PluginListenerHandle>;
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

export function onVolumeUp(cb: () => void): () => void {
  if (!native()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  HwButtons.addListener("volumeUp", cb)
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
