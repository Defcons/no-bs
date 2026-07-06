// Picture-in-Picture (Android). Floats the rest timer over other apps. Backed by
// the custom native Pip plugin (android/.../PipPlugin.java). No-op on the web.
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface PipPlugin {
  isSupported(): Promise<{ supported: boolean }>;
  enter(options?: { width?: number; height?: number }): Promise<void>;
  setAutoEnter(options: { enabled: boolean }): Promise<void>;
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
export async function setPipAutoEnter(enabled: boolean): Promise<void> {
  if (!native()) return;
  try {
    await Pip.setAutoEnter({ enabled });
  } catch {
    /* unsupported */
  }
}

// Fires true when the window enters PiP, false when it leaves.
export function onPipChange(cb: (inPip: boolean) => void): () => void {
  if (!native()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  Pip.addListener("pipChange", (d) => cb(d.pip)).then((h) => {
    if (cancelled) h.remove(); // unsubscribed before the listener resolved
    else handle = h;
  });
  return () => {
    cancelled = true;
    handle?.remove();
  };
}
