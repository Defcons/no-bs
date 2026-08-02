// In-app feedback → a mailto: link to the app's contact address, pre-filled with a
// short diagnostics footer (app version + Android/device parsed from the UA) so bug
// reports are actionable. No backend and no native plugin — a plain mailto anchor
// works on web and on native (Capacitor hands non-http schemes to the OS), so it
// ships over-the-air. The point: give an unhappy user a direct line to us before a
// one-star review is their only outlet.
const FEEDBACK_TO = "apps@agentas.net";

// "Android 14 · SM-S911B" from the WebView UA, degrading gracefully.
function deviceInfo(): string {
  const ua = navigator.userAgent || "";
  const ver = ua.match(/Android ([\d.]+)/)?.[1];
  const model = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/[^)]*)?\)/)?.[1]?.trim();
  if (ver && model) return `Android ${ver} · ${model}`;
  if (ver) return `Android ${ver}`;
  return ua || "unknown device";
}

export function feedbackMailtoUrl(appVersion: string): string {
  const v = appVersion && appVersion !== "…" ? appVersion.split("+")[0] : "unknown";
  const subject = `NoBS feedback (v${v})`;
  const body =
    "Describe your feedback or the bug here:\n\n\n" +
    "— — —\n" +
    "(the details below help us fix issues — please keep them)\n" +
    `App: NoBS v${v}\n` +
    `Device: ${deviceInfo()}\n`;
  return `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
