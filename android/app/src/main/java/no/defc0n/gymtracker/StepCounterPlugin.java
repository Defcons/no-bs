package no.defc0n.gymtracker;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Hardware step counter for the active workout. Uses TYPE_STEP_COUNTER — a low-power
 * sensor that accumulates steps IN HARDWARE and keeps counting with the screen off
 * (unlike the WebView's accelerometer, which is suspended, so a JS pedometer would miss
 * exactly the screen-off run we care about). start() marks the cumulative-since-boot
 * baseline; getCount()/stop() return steps since that baseline. Needs the runtime
 * ACTIVITY_RECOGNITION permission on Android 10+ (API 29). Registered in MainActivity.
 */
@CapacitorPlugin(
    name = "StepCounter",
    permissions = {
        @Permission(strings = { "android.permission.ACTIVITY_RECOGNITION" }, alias = "activity")
    }
)
public class StepCounterPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensorManager;
    private Sensor stepSensor;
    private float latest = -1f; // latest cumulative-since-boot reading (-1 = none yet)
    private float base = -1f;   // baseline captured at start (-1 = pending first reading)
    private boolean listening = false;
    // Timestamped cadence samples for the active session: each = { epochMs, stepsSinceBase }.
    // Drained by getSamples() (1.72+). Lets the app derive walk/run/stop CADENCE indoors
    // (no GPS) and, later, fill a GPS dropout's distance from the steps taken across it.
    // event.timestamp (not wall-clock-on-delivery) keeps times honest when the OS batches
    // sensor events to the next wake with the screen off. Guarded — the sensor callback
    // runs on a different thread than the plugin methods.
    private final java.util.ArrayList<long[]> samples = new java.util.ArrayList<>();
    private static final int MAX_SAMPLES = 20000; // safety cap (~a very long session)

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        }
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", stepSensor != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (stepSensor == null) {
            call.reject("no step-counter sensor");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && getPermissionState("activity") != PermissionState.GRANTED) {
            requestPermissionForAlias("activity", call, "afterPerm");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterPerm(PluginCall call) {
        if (getPermissionState("activity") == PermissionState.GRANTED) {
            begin(call);
        } else {
            call.reject("activity-recognition permission denied");
        }
    }

    private void begin(PluginCall call) {
        base = -1f; // the next sensor reading becomes the baseline
        synchronized (samples) {
            samples.clear();
        }
        if (!listening) {
            sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL);
            listening = true;
        }
        call.resolve();
    }

    @PluginMethod
    public void getCount(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("steps", steps());
        call.resolve(ret);
    }

    // Drain + clear the timestamped cadence buffer collected since start (or the last
    // drain). Present only on the patched APK; older shells don't expose it (OTA-safe —
    // the JS side falls back to no cadence stream, just the session total).
    @PluginMethod
    public void getSamples(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (samples) {
            for (long[] s : samples) {
                JSObject o = new JSObject();
                o.put("t", s[0]);
                o.put("steps", s[1]);
                arr.put(o);
            }
            samples.clear();
        }
        JSObject ret = new JSObject();
        ret.put("samples", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        long s = steps();
        if (listening) {
            sensorManager.unregisterListener(this);
            listening = false;
        }
        base = -1f;
        JSObject ret = new JSObject();
        ret.put("steps", s);
        call.resolve(ret);
    }

    private long steps() {
        return (base >= 0 && latest >= base) ? (long) (latest - base) : 0L;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        latest = event.values[0];
        if (base < 0) base = latest; // first reading after start = the baseline
        // Convert the event's boot-relative timestamp to epoch ms so batched screen-off
        // events keep the time they actually OCCURRED, not the time they were delivered.
        long tMs = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000L;
        synchronized (samples) {
            samples.add(new long[] { tMs, steps() });
            if (samples.size() > MAX_SAMPLES) samples.remove(0);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
