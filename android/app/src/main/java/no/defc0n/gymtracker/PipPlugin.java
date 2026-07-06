package no.defc0n.gymtracker;

import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Picture-in-Picture bridge for the rest timer. The web layer asks to enter PiP
 * (or arms auto-enter so leaving the app during a break floats the timer), and
 * listens for "pipChange" to swap in a minimal break view while shrunk.
 */
@CapacitorPlugin(name = "Pip")
public class PipPlugin extends Plugin {

    // Read by MainActivity.onUserLeaveHint() to auto-float on Home/recents.
    static boolean autoEnter = false;

    private boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && getActivity().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject res = new JSObject();
        res.put("supported", supported());
        call.resolve(res);
    }

    @PluginMethod
    public void enter(PluginCall call) {
        if (!supported()) {
            call.reject("PiP not supported on this device");
            return;
        }
        int w = call.getInt("width", 2);
        int h = call.getInt("height", 3);
        final Rational ratio = new Rational(w, h);
        getActivity().runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    PictureInPictureParams params = new PictureInPictureParams.Builder()
                            .setAspectRatio(ratio)
                            .build();
                    getActivity().enterPictureInPictureMode(params);
                } catch (Exception e) {
                    // PiP unavailable (device policy / activity finishing) — ignore.
                }
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void setAutoEnter(PluginCall call) {
        autoEnter = call.getBoolean("enabled", false);
        call.resolve();
    }

    // Called by MainActivity when the system PiP mode flips.
    void notifyPipChange(boolean inPip) {
        JSObject data = new JSObject();
        data.put("pip", inPip);
        notifyListeners("pipChange", data);
    }
}
