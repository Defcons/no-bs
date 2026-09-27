// Public origin of the installed app — used to build shareable route links that open
// the in-app map viewer. The public build passes it EMPTY, so `||` (not `??`) falls
// back to the public app — a relative "/#route=…" in a Sheet cell isn't a link.
// import.meta.env is Vite-only — the ?. keeps Node tooling (tsx: scripts/validate.ts,
// tests/audit-check.ts) from crashing at import time.
export const APP_PUBLIC_URL = import.meta.env?.VITE_APP_URL || "https://app.agentas.net";
