package no.defc0n.gymtracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Workout foreground service for the standard (Play) build. On a locked phone Android
 * can freeze a backgrounded app, so the earbud break (HwButtonsPlugin's volume observer)
 * may miss; NoBS Extended stays alive through its accessibility service instead. While
 * this runs, the process stays alive behind one quiet "Workout in progress" notification.
 * Type "health" (fitness tracking): on Android 14+ that needs ACTIVITY_RECOGNITION
 * granted, which WorkoutServicePlugin checks before starting it. Started and stopped by
 * WorkoutServicePlugin; stopWithTask in the manifest ends it on a swipe-away.
 */
public class WorkoutService extends Service {
    private static final String CHANNEL_ID = "workout";
    private static final int NOTIFICATION_ID = 7301;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Workout in progress", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps the earbud break working while the phone is locked.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = open == null ? null
                : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_workout)
                .setContentTitle("Workout in progress")
                .setContentText("The earbud break stays ready while the phone is locked.")
                .setContentIntent(tap)
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        return START_NOT_STICKY;
    }
}
