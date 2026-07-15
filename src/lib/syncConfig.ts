// Public origin of the installed app — used to build shareable route links that open
// the in-app map viewer. Empty in the public build (falls back to a relative link).
export const APP_PUBLIC_URL = import.meta.env.VITE_APP_URL ?? "https://app.codecrafts.cc";
