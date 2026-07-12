// Picture-in-Picture (Android). Floats the rest timer over other apps. Backed by
// the custom native Pip plugin (android/.../PipPlugin.java). No-op on the web.
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface PipPlugin {
  isSupported(): Promise<{ supported: boolean }>;
  isInPip(): Promise<{ inPip: boolean }>;
  enter(options?: { width?: number; height?: number }): Promise<void>;
  setAutoEnter(options: { enabled: boolean; width?: number; height?: number }): Promise<void>;
  addListener(event: "pipChange", cb: (data: { pip: boolean }) => void): Promise<PluginListenerHandle>;
}

const Pip = registerPlugin<PipPlugin>("Pip");

const native = () => Capacitor.isNativePlatform();

export async function pipSupported(): Promise<boolean> {
  if (!native()) return false;
  try {
    return (await Pip.isSupported()).supported;
  } catch {
    return false;
  }
}

export async function isInPip(): Promise<boolean> {
  if (!native()) return false;
  try {
    return (await Pip.isInPip()).inPip;
  } catch {
    return false;
  }
}

// Enter PiP now (a tall 2:3 window suits the stacked timer view).
export async function enterPip(): Promise<void> {
  if (!native()) return;
  try {
    await Pip.enter({ width: 2, height: 3 });
  } catch {
    /* unsupported */
  }
}

// Arm/disarm auto-PiP: when armed, leaving the app (Home/recents) floats the timer.
// width:height sets the PiP window's aspect ratio (kept close to the content so the
// window is compact).
export async function setPipAutoEnter(enabled: boolean, width = 1, height = 1): Promise<void> {
  if (!native()) return;
  try {
    await Pip.setAutoEnter({ enabled, width, height });
  } catch {
    /* unsupported */
  }
}

// Fires true when the window enters PiP, false when it leaves.
export function onPipChange(cb: (inPip: boolean) => void): () => void {
  if (!native()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  Pip.addListener("pipChange", (d) => cb(d.pip))
    .then((h) => {
      if (cancelled) h.remove(); // unsubscribed before the listener resolved
      else handle = h;
    })
    .catch(() => {
      /* plugin missing (old APK) — no PiP events, no unhandled rejection */
    });
  return () => {
    cancelled = true;
    handle?.remove();
  };
}
