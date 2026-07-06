// Built-in Google Sheets sync config, baked into the client so no per-device setup
// is needed. NOTE: this "secret" is effectively public — anyone who loads the JS
// bundle can read it, and Cloudflare Access only guards gym.defc0n.no, NOT the
// script.google.com /exec endpoint. The real protections are just that the endpoint
// is obscure and the blast radius is one personal spreadsheet (append/read only). If
// that ever stops being acceptable, move these to per-device Settings (no default)
// or put the Apps Script behind its own auth.
export const DEFAULT_SYNC_URL =
  "REDACTED_SYNC_URL";
export const DEFAULT_SYNC_SECRET = "REDACTED_OLD_SECRET";

// Public origin of the installed PWA — used to build shareable route links that
// open the in-app map viewer (behind Cloudflare Access, so only the owner can open).
export const APP_PUBLIC_URL = "https://gym.defc0n.no";
