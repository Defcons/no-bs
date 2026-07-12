import type { CapacitorConfig } from "@capacitor/cli";

// Wraps the built web app (dist/) into a native Android app. The web version at
// app.codecrafts.cc is unaffected — this is an additional target.
const config: CapacitorConfig = {
  appId: "no.defc0n.gymtracker",
  appName: "NoBS – Workout Log",
  webDir: "dist",
  plugins: {
    // OTA web-layer updates are driven manually from Settings → Update (self-hosted
    // bundle on app.codecrafts.cc), so disable Capgo's cloud auto-update — AND its
    // default telemetry: without statsUrl:"" the plugin posts update/health events
    // to plugin.capgo.app even with autoUpdate off (verified in plugin source),
    // which would violate our "no analytics" privacy policy.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: "",
      updateUrl: "",
      channelUrl: "",
    },
  },
};

export default config;
