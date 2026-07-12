package no.defc0n.gymtracker;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hardware-button bridge: while capture is armed (Settings toggle, during an
 * active workout), MainActivity.onKeyDown consumes VOLUME UP and emits a
 * "volumeUp" event instead of changing the volume — the web layer starts the
 * break timer. Works with headphone volume buttons too (they send the same
 * keycode). Media/play-pause buttons are deliberately NOT captured: hijacking
 * them would steal play/pause from the user's music app mid-workout.
 */
@CapacitorPlugin(name = "HwButtons")
public class HwButtonsPlugin extends Plugin {

    // Read by MainActivity.onKeyDown().
    static boolean captureVolumeUp = false;

    @PluginMethod
    public void setCapture(PluginCall call) {
        captureVolumeUp = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    // Called by MainActivity when a captured key fires.
    void notifyVolumeUp() {
        notifyListeners("volumeUp", new JSObject());
    }
}
