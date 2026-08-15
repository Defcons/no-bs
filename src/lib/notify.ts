// Notifications. On the native app we use Capacitor LocalNotifications (reliable,
// and can be SCHEDULED to fire when the app is backgrounded/closed). On the web
// we fall back to the service-worker notification (best-effort in background).
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { getSetting } from "../db";

const native = () => Capacitor.isNativePlatform();

// A high-importance channel so the scheduled "rest over" notification actually makes
// a sound + heads-up while the app is backgrounded (the in-app Web Audio beep is
// throttled/silent in the background).
const REST_CHANNEL = "rest-timer";
const REMINDER_CHANNEL = "reminders";
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
    // Training reminders (incl. the pre-scheduled closed-app ones). Without an
    // explicit channel Android may drop a scheduled notification onto a silent
    // default channel — that's why background reminders weren't showing.
    await LocalNotifications.createChannel({
      id: REMINDER_CHANNEL,
      name: "Training reminders",
      description: "Nudges you to train when you're behind your goal",
      importance: 4, // HIGH → shows + sound
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
      await ensureRestChannel(); // creates the reminder channel too
      await LocalNotifications.schedule({
        notifications: [{ id: idc++ % 100000, title, body, channelId: REMINDER_CHANNEL }],
      });
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

// Auto-ended workouts (left the gym / lost HR) save silently while the app is
// backgrounded, so the user never got the chance to rate their mood. Fire a
// notification; if mood is still missing, tag it with the saved workout id so a
// tap can open the mood-logging modal for that session (see onNotificationTap).
const AUTOEND_NOTIF_ID = 7201;
export async function showAutoEndNotification(
  reason: "left" | "hr",
  workoutId: number | undefined,
  moodIncomplete: boolean,
): Promise<void> {
  const why = reason === "left" ? "You left the gym" : "Your heart-rate signal dropped";
  const body = moodIncomplete
    ? `${why} — session saved. Tap to log how it felt.`
    : `${why} — session saved.`;
  if (native()) {
    try {
      await ensureRestChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: AUTOEND_NOTIF_ID,
            title: "Workout auto-saved 💾",
            body,
            channelId: REMINDER_CHANNEL,
            // extra rides along to localNotificationActionPerformed on tap.
            extra: moodIncomplete && workoutId != null ? { logMood: workoutId } : undefined,
          },
        ],
      });
    } catch {
      /* permission not granted */
    }
    return;
  }
  // Web fallback: informative only (SW notification taps don't route to the modal).
  showReminder("Workout auto-saved 💾", body);
}

// Native only: wire a tap on the auto-end notification to a callback with the
// saved workout id (from the notification's `extra.logMood`). Pure-JS listener on
// the already-registered plugin — ships OTA, no native change. Best-effort on a
// cold start (the event may fire before the listener attaches).
export function onNotificationTap(cb: (workoutId: number) => void): () => void {
  if (!native()) return () => {};
  const handle = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const id = action.notification?.extra?.logMood;
    if (typeof id === "number") cb(id);
  });
  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}

// Native only: schedule the "rest over" notification for the exact end time so it
// fires even if the app is in the background. (The web build relies on the in-app
// timer + SW notification.)
const BREAK_NOTIF_ID = 7001;
export async function scheduleBreakNotification(at: number): Promise<void> {
  if (!native()) return;
  if (!(await getSetting("breakNotify", false))) return; // opt-in (default off) — see Settings "Break-over notification"
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
    await ensureRestChannel(); // ensure the reminder channel exists first
    await LocalNotifications.cancel({ notifications: TRAIN_NOTIF_IDS.map((id) => ({ id })) });
    const gapDays = Math.ceil(7 / Math.max(1, daysPerWeek));
    // Parse the date as LOCAL calendar parts — new Date("yyyy-mm-dd") is UTC
    // midnight, which shifts a day back in UTC-negative timezones.
    const now = new Date();
    let y = now.getFullYear();
    let mo = now.getMonth();
    let d = now.getDate();
    if (lastWorkoutISO) {
      const [py, pm, pd] = lastWorkoutISO.slice(0, 10).split("-").map(Number);
      if (py && pm && pd) [y, mo, d] = [py, pm - 1, pd];
    }
    let due = new Date(y, mo, d + gapDays, REMINDER_HOUR, 0, 0);
    // Already overdue (the users reminders exist for!) — anchor to today so the
    // filter below doesn't silently drop every shot.
    if (due.getTime() <= Date.now()) {
      due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), REMINDER_HOUR, 0, 0);
      if (due.getTime() <= Date.now()) due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, REMINDER_HOUR, 0, 0);
    }
    const notifications = TRAIN_NOTIF_IDS.map((id, i) => {
      // Calendar-day steps (not +86400000 ms) so the 17:00 slot survives DST.
      const at = new Date(due.getFullYear(), due.getMonth(), due.getDate() + i, REMINDER_HOUR, 0, 0);
      return { id, at };
    }).filter((n) => n.at.getTime() > Date.now());
    if (!notifications.length) return;
    await LocalNotifications.schedule({
      notifications: notifications.map((n) => ({
        id: n.id,
        title: "Time to train 💪",
        body: `Keep your ${daysPerWeek}×/week streak going — log a workout today.`,
        channelId: REMINDER_CHANNEL,
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
