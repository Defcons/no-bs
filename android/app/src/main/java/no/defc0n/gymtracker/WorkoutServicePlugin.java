package no.defc0n.gymtracker;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts/stops WorkoutService (see there). Wrapped by src/lib/workoutService.ts, which
 * runs it only on the standard build with the earbud break on, and stands it down while
 * a location watcher (its own foreground service) runs. Registered in MainActivity.
 */
@CapacitorPlugin(name = "WorkoutService")
public class WorkoutServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        // A "health" foreground service needs ACTIVITY_RECOGNITION on Android 14+. Without
        // it startForeground() throws inside the service, and a service started with
        // startForegroundService() that never goes foreground crashes the app, so check here.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("needs the physical activity permission");
            return;
        }
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, WorkoutService.class));
            call.resolve();
        } catch (RuntimeException e) {
            // Android 12+ refuses to start one from the background.
            call.reject("could not start the workout service", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, WorkoutService.class));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, WorkoutService.class));
    }
}
