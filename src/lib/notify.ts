// Notifications. On the native app we use Capacitor LocalNotifications (reliable,
// and can be SCHEDULED to fire when the app is backgrounded/closed). On the web
// we fall back to the service-worker notification (best-effort in background).
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const native = () => Capacitor.isNativePlatform();

export function notificationsSupported(): boolean {
  return native() || (typeof Notification !== "undefined" && "serviceWorker" in navigator);
}

// Whether notifications are actually permitted right now, per platform. On native
// the permission lives in LocalNotifications (the web Notification API is always
// "denied" inside the Android WebView), so checking Notification.permission there
// would wrongly gate out every native reminder.
export async function notificationsAllowed(): Promise<boolean> {
  if (native()) {
    try {
      return (await LocalNotifications.checkPermissions()).display === "granted";
    } catch {
      return false;
    }
  }
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

export async function requestNotifications(): Promise<boolean> {
  if (native()) {
    const p = await LocalNotifications.requestPermissions();
    return p.display === "granted";
  }
  if (typeof Notification === "undefined") return false;
  return (await Notification.requestPermission()) === "granted";
}

let idc = 8000;
export async function showReminder(title: string, body: string): Promise<void> {
  if (native()) {
    try {
      await LocalNotifications.schedule({ notifications: [{ id: idc++ % 100000, title, body }] });
    } catch {
      /* permission not granted */
    }
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png", tag: "workout-reminder" });
  } catch {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
  }
}

// Native only: schedule the "rest over" notification for the exact end time so it
// fires even if the app is in the background. (The web build relies on the in-app
// timer + SW notification.)
const BREAK_NOTIF_ID = 7001;
export async function scheduleBreakNotification(at: number): Promise<void> {
  if (!native()) return;
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: BREAK_NOTIF_ID,
          title: "Rest over — go! 💪",
          body: "Time for your next set.",
          schedule: { at: new Date(at), allowWhileIdle: true },
        },
      ],
    });
  } catch {
    /* ignore */
  }
}
export async function cancelBreakNotification(): Promise<void> {
  if (!native()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: BREAK_NOTIF_ID }] });
  } catch {
    /* ignore */
  }
}
