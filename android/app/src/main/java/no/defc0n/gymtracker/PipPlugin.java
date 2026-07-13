package no.defc0n.gymtracker;

import android.app.PictureInPictureParams;
import android.content.Intent;
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
    static int autoW = 1; // aspect ratio of the auto-entered PiP window
    static int autoH = 1;

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
    public void isInPip(PluginCall call) {
        boolean inPip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getActivity().isInPictureInPictureMode();
        JSObject res = new JSObject();
        res.put("inPip", inPip);
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

    // Keep the screen on via the window flag — unlike the web Wake Lock API this
    // also holds while the window is in PiP. Toggled by the "keep screen on" setting.
    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            try {
                if (on) {
                    getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            } catch (Exception e) {
                /* ignore */
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void setAutoEnter(PluginCall call) {
        autoEnter = call.getBoolean("enabled", false);
        autoW = call.getInt("width", 1);
        autoH = call.getInt("height", 1);
        call.resolve();
    }

    // Leave PiP by bringing the activity back to full screen. Used when the workout
    // auto-ends while floating, so a stale PiP window (now showing the normal app)
    // doesn't linger. Android has no "close PiP to nothing" — expanding is the exit.
    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getActivity().isInPictureInPictureMode()) {
                    Intent intent = new Intent(getContext(), MainActivity.class);
                    intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                    getActivity().startActivity(intent);
                }
            } catch (Exception e) {
                // best-effort — never crash the finish flow over it
            }
        });
        call.resolve();
    }

    // Called by MainActivity when the system PiP mode flips.
    void notifyPipChange(boolean inPip) {
        JSObject data = new JSObject();
        data.put("pip", inPip);
        notifyListeners("pipChange", data);
    }
}
