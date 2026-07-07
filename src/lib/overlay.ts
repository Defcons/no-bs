// Floating-timer overlay bubble (Android). A small always-on-top window the app
// fully controls (draggable, position saved, size chosen in-app). Backed by the
// custom native Overlay plugin. No-op on the web. Needs the "Display over other
// apps" permission, requested only when the user turns it on.
import { Capacitor, registerPlugin } from "@capacitor/core";

export type OverlayState = {
  restEndsAt?: number; // epoch ms of the running rest timer (0/none = show workout time)
  startEpoch?: number; // workout start (ms); native ticks WORK time from this
  bpm?: number; // last heart rate (0 = hide)
  sizeSp?: number; // text size
};

interface OverlayPlugin {
  hasPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<void>;
  arm(opts: { enabled: boolean } & OverlayState): Promise<void>;
  setState(opts: OverlayState): Promise<void>;
}

const Overlay = registerPlugin<OverlayPlugin>("Overlay");
const native = () => Capacitor.isNativePlatform();

export async function overlayHasPermission(): Promise<boolean> {
  if (!native()) return false;
  try {
    return (await Overlay.hasPermission()).granted;
  } catch {
    return false;
  }
}

export async function overlayRequestPermission(): Promise<void> {
  if (!native()) return;
  try {
    await Overlay.requestPermission();
  } catch {
    /* ignore */
  }
}

// Arm/disarm auto-show: when armed, leaving the app during a workout floats the bubble.
export async function armOverlay(enabled: boolean, state: OverlayState = {}): Promise<void> {
  if (!native()) return;
  try {
    await Overlay.arm({ enabled, ...state });
  } catch {
    /* unsupported */
  }
}

export async function setOverlayState(state: OverlayState): Promise<void> {
  if (!native()) return;
  try {
    await Overlay.setState(state);
  } catch {
    /* unsupported */
  }
}
