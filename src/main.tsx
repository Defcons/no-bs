import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import "./index.css";
import App from "./App.tsx";

// The service worker is for the browser PWA only. On the native (Capacitor) app,
// Capgo handles updates, and a precaching SW would keep serving an old bundle after
// an OTA update (the version badge bumps but the UI doesn't) — so we never register
// it there, and we tear down any SW + caches a previous build installed so the
// current bundle actually runs.
if (Capacitor.isNativePlatform()) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
  }
  if ("caches" in window) {
    caches
      .keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => {});
  }
} else if ("serviceWorker" in navigator) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
