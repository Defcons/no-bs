// Over-the-air web-layer updates for the native app (Capgo). Downloads the latest
// web bundle from the self-hosted endpoint and swaps to it live — no APK reinstall,
// no Android install prompt. Only new native plugins ever need a full APK.
// On the plain web build these are no-ops (the PWA service worker handles updates).
import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

const native = () => Capacitor.isNativePlatform();

// The deploy publishes the latest bundle info here (see Dockerfile).
const VERSION_URL = "https://gym.defc0n.no/version.json";

export const updatesSupported = (): boolean => native();

// Call once on app start so Capgo commits (doesn't roll back) the running bundle.
export async function markAppReady(): Promise<void> {
  if (!native()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* running the builtin bundle */
  }
}

export async function currentVersion(): Promise<string> {
  if (!native()) return "web";
  try {
    const b = await CapacitorUpdater.current();
    return b.bundle?.version || "builtin";
  } catch {
    return "builtin";
  }
}

export type UpdateResult = { status: "updated" | "uptodate" | "error"; message: string };

export async function checkAndApplyUpdate(): Promise<UpdateResult> {
  if (!native()) return { status: "error", message: "Updates apply to the installed app only." };
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res.ok) return { status: "error", message: `Update server returned ${res.status}` };
    const latest = (await res.json()) as { version: string; url: string };
    if (!latest?.url || !latest?.version) return { status: "error", message: "Malformed update info." };
    // Only ever download from our own origin — never live-load a bundle from a URL
    // an altered version.json could point elsewhere.
    if (new URL(latest.url, VERSION_URL).origin !== new URL(VERSION_URL).origin) {
      return { status: "error", message: "Update rejected (unexpected host)." };
    }
    const cur = await currentVersion();
    if (latest.version === cur) return { status: "uptodate", message: "You're already on the latest version." };
    const bundle = await CapacitorUpdater.download({ url: latest.url, version: latest.version });
    await CapacitorUpdater.set(bundle); // switches + reloads into the new bundle
    return { status: "updated", message: "Updated — reloading…" };
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
}
