import type { CapacitorConfig } from "@capacitor/cli";

// Wraps the built web app (dist/) into a native Android app. The web version at
// gym.defc0n.no is unaffected — this is an additional target.
const config: CapacitorConfig = {
  appId: "no.defc0n.gymtracker",
  appName: "Gym Tracker",
  webDir: "dist",
};

export default config;
