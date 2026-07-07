// Optional Google Sheets sync config. In the PUBLIC build these are EMPTY, so sync
// is off by default and the user configures their own in Settings. A personal build
// supplies them via a gitignored `.env.local` (VITE_SYNC_URL / VITE_SYNC_SECRET) so
// it keeps syncing with zero setup.
//
// NEVER hardcode a real secret here — it ships in the client bundle.
export const DEFAULT_SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "";
export const DEFAULT_SYNC_SECRET = import.meta.env.VITE_SYNC_SECRET ?? "";

// Public origin of the installed app — used to build shareable route links that open
// the in-app map viewer. Empty in the public build (falls back to a relative link).
export const APP_PUBLIC_URL = import.meta.env.VITE_APP_URL ?? "";
