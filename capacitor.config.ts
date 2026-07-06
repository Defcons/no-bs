import type { CapacitorConfig } from "@capacitor/cli";

// Wraps the built web app (dist/) into a native Android app. The web version at
// gym.defc0n.no is unaffected — this is an additional target.
const config: CapacitorConfig = {
  appId: "no.defc0n.gymtracker",
  appName: "Gym Tracker",
  webDir: "dist",
  plugins: {
    // OTA web-layer updates are driven manually from Settings → Update (self-hosted
    // bundle on gym.defc0n.no), so disable Capgo's cloud auto-update.
    CapacitorUpdater: {
      autoUpdate: false,
    },
  },
};

export default config;
