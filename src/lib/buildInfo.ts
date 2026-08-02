// Which native build are we? The "extended" flavour ships as its own app
// (applicationId net.agentas.nobs.extended, side-by-side with the Play build) and
// adds the locked-screen headphone-break accessibility service. The web bundle is
// identical for both flavours, so we detect the flavour at runtime from the OS
// package id rather than a build-time constant.
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

let cached: boolean | null = null;

// True only on the native Extended build. Web (PWA) and the standard/Play build
// return false. Defensive: on an older native build without @capacitor/app the
// call throws — we treat that as "not extended" (no badge) so an OTA'd JS bundle
// never errors on a not-yet-updated install.
export async function isExtendedBuild(): Promise<boolean> {
  if (cached != null) return cached;
  if (!Capacitor.isNativePlatform()) return (cached = false);
  try {
    const { id } = await App.getInfo();
    cached = id.endsWith(".extended");
  } catch {
    cached = false;
  }
  return cached;
}
