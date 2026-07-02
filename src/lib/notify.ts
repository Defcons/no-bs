// Local workout reminders. The web can't reliably fire a scheduled notification
// while the app is fully closed without a push backend, so this fires when the
// app is opened / becomes visible and you're behind your weekly goal.
export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined" && "serviceWorker" in navigator;
}

export async function requestNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

export async function showReminder(title: string, body: string): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "workout-reminder",
    });
  } catch {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
  }
}
