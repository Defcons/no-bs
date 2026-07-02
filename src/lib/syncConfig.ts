// Built-in Google Sheets sync config, used as the default on every device so you
// never have to enter it per-device. Safe to embed here because the app is
// private behind Cloudflare Access (only the owner can load it) and the Apps Script
// only appends to the owner's own sheet. A per-device value in Settings overrides these.
export const DEFAULT_SYNC_URL =
  "REDACTED_SYNC_URL";
export const DEFAULT_SYNC_SECRET = "REDACTED_OLD_SECRET";
