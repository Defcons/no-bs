package no.defc0n.gymtracker;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;

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
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
