import type { CapacitorConfig } from "@capacitor/cli";

// RSA 2048 PKCS#1 public key, sha256 of its PEM file 0c8fe62f57d5a1d7...
const CAPGO_PUBLIC_KEY = [
  "-----BEGIN RSA PUBLIC KEY-----",
  "MIIBCgKCAQEApOGLlMhwblY7EWgU81gSyi9x7WsmfZVAI4AIhx8cCMx3/J/MKY2q",
  "3ADz7hbLWF+5fBvX8JOX+SBfwuvTL5wCcOiiBpOkQmWtb+n3uZrmm7TaQYL6t/D7",
  "h8W9Z7NnQuQqmhueTsos3MPIxeUv6yOMLOxqEXYTquLd1++w4wGeVMrxRNy56JlY",
  "x9Vs4iuI0FHcIRH4xJnznPmyMjuLuJrZL30BvEcj9Symtf930H2s14UiJi5kOBCl",
  "acYysU66GQnJRxhV0QztI0JphDh0oj5rpjH+64C12etwPkY+FiAc1xuiyEeQHb2d",
  "dY1+7GC71tzb8NI/X108/VQqIbRixRhskwIDAQAB",
  "-----END RSA PUBLIC KEY-----",
].join("\n");

// Wraps the built web app (dist/) into a native Android app. The web version at
// app.agentas.net is unaffected — this is an additional target.
const config: CapacitorConfig = {
  // Public Play identity (Agentas rebrand 2026-07-30). The Android `namespace` /
  // Java package stays `no.defc0n.gymtracker` (see android/app/build.gradle) — only
  // this applicationId changed. Launcher name stays "NoBS".
  appId: "net.agentas.nobs",
  appName: "NoBS – Workout Log",
  webDir: "dist",
  plugins: {
    // OTA web-layer updates are driven manually from Settings → Update (self-hosted
    // bundle on app.agentas.net), so disable Capgo's cloud auto-update — AND its
    // default telemetry: without statsUrl:"" the plugin posts update/health events
    // to plugin.capgo.app even with autoUpdate off (verified in plugin source),
    // which would violate our "no analytics" privacy policy.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: "",
      updateUrl: "",
      channelUrl: "",
      // Capgo bundle-signing PUBLIC key (step 2 of the signed-bundle plan; the private key
      // is the CI secret CAPGO_PRIVATE_KEY and is never in the repo). With a key in the app
      // the plugin refuses a bundle offered without a checksum, so update.ts must keep
      // passing version.json's SHA-256. Without a session key the plugin still accepts that
      // plain SHA-256, so today this signs nothing; it only starts to once CI encrypts
      // bundles. Must start with the BEGIN line exactly (the plugin checks the prefix).
      publicKey: CAPGO_PUBLIC_KEY,
    },
  },
};

export default config;
