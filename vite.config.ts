import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // We register the SW ourselves (in main.tsx) so we can skip it entirely on
      // the native app, where a precaching SW would serve stale bundles and defeat
      // the Capgo OTA updater.
      injectRegister: null,
      includeAssets: ["favicon.svg"],
      // Don't let the SPA navigation fallback hijack direct file URLs (e.g. the
      // downloadable /dl/nobs.apk) — those should hit the network.
      workbox: { navigateFallbackDenylist: [/\.[^/]+$/] },
      manifest: {
        name: "NoBS – Workout Log",
        short_name: "NoBS",
        description: "A no-BS workout log: sets, reps, timer, heart rate. Nothing you don't need.",
        // Matches index.html's <meta theme-color> and the dark --bg token in
        // src/index.css — keep all three in sync.
        theme_color: "#0b0d12",
        background_color: "#0b0d12",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: { host: true },
});
