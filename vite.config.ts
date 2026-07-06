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
      // downloadable /gym-tracker.apk) — those should hit the network.
      workbox: { navigateFallbackDenylist: [/\.[^/]+$/] },
      manifest: {
        name: "Gym Tracker",
        short_name: "Gym",
        description: "Fast in-gym set logging with rest timer and heart rate",
        theme_color: "#0e1116",
        background_color: "#0e1116",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: { host: true },
});
