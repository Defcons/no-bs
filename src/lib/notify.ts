// Notifications. On the native app we use Capacitor LocalNotifications (reliable,
// and can be SCHEDULED to fire when the app is backgrounded/closed). On the web
// we fall back to the service-worker notification (best-effort in background).
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const native = () => Capacitor.isNativePlatform();

// A high-importance channel so the scheduled "rest over" notification actually makes
// a sound + heads-up while the app is backgrounded (the in-app Web Audio beep is
// throttled/silent in the background).
const REST_CHANNEL = "rest-timer";
let channelReady = false;
async function ensureRestChannel(): Promise<void> {
  if (!native() || channelReady) return;
  try {
    await LocalNotifications.createChannel({
      id: REST_CHANNEL,
      name: "Rest timer",
      description: "Alerts when your rest is over",
      importance: 5, // HIGH → sound + heads-up
      visibility: 1,
      vibration: true,
    });
    channelReady = true;
  } catch {
    /* older Android / no channel support */
  }
}

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
    await ensureRestChannel();
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
    await ensureRestChannel();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: BREAK_NOTIF_ID,
          title: "Rest over — go! 💪",
          body: "Time for your next set.",
          channelId: REST_CHANNEL, // high-importance → plays a sound in the background
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

// Native only: pre-schedule "time to train" reminders so they fire even when the
// app is CLOSED (the on-open nudge in App.maybeRemind can't). Rescheduled from
// scratch on every app open + workout finish, so the dates track the latest
// workout: first shot the day training becomes due (lastWorkout + 7/dpw days),
// then daily follow-ups, all at REMINDER_HOUR.
const TRAIN_NOTIF_IDS = [7101, 7102, 7103];
const REMINDER_HOUR = 17; // late afternoon — gym time for most people
export async function scheduleTrainingReminders(daysPerWeek: number, lastWorkoutISO: string | null): Promise<void> {
  if (!native()) return;
  try {
    await LocalNotifications.cancel({ notifications: TRAIN_NOTIF_IDS.map((id) => ({ id })) });
    const gapDays = Math.ceil(7 / Math.max(1, daysPerWeek));
    const base = lastWorkoutISO ? new Date(lastWorkoutISO.slice(0, 10)) : new Date();
    const due = new Date(base.getFullYear(), base.getMonth(), base.getDate() + gapDays, REMINDER_HOUR, 0, 0);
    const notifications = TRAIN_NOTIF_IDS.map((id, i) => {
      const at = new Date(due.getTime() + i * 86400000);
      return { id, at };
    }).filter((n) => n.at.getTime() > Date.now());
    if (!notifications.length) return;
    await LocalNotifications.schedule({
      notifications: notifications.map((n) => ({
        id: n.id,
        title: "Time to train 💪",
        body: `Keep your ${daysPerWeek}×/week streak going — log a workout today.`,
        schedule: { at: n.at, allowWhileIdle: true },
      })),
    });
  } catch {
    /* permission not granted */
  }
}
export async function cancelTrainingReminders(): Promise<void> {
  if (!native()) return;
  try {
    await LocalNotifications.cancel({ notifications: TRAIN_NOTIF_IDS.map((id) => ({ id })) });
  } catch {
    /* ignore */
  }
}
