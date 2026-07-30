package no.defc0n.gymtracker;

import android.content.res.Configuration;
import android.app.PictureInPictureParams;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.Rational;
import android.view.InputDevice;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PipPlugin.class);
        registerPlugin(HwButtonsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // The PHONE's physical volume buttons keep working as VOLUME (do NOT consume). The
    // break is triggered only by a Bluetooth EARBUD volume rocker, which arrives as an
    // AVRCP volume-level change (not a key event) and is caught by HwButtonsPlugin's
    // ContentObserver. To stop that observer from mistaking a phone-key volume change
    // for an earbud press, we tell it to ignore the very next level change while armed.
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            // DIAGNOSTIC: log the source input device so we can tell whether the EARBUD
            // rocker (external/Bluetooth device) is arriving here as a KEY EVENT — if it
            // is, suppressing it below is what kills the break. Built-in phone keys and
            // earbud keys have different device names/ids.
            InputDevice dev = event.getDevice();
            Log.d(HwButtonsPlugin.TAG, "onKeyDown(fg) code=" + keyCode
                    + " deviceId=" + event.getDeviceId()
                    + " name=" + (dev != null ? dev.getName() : "?")
                    + " external=" + (dev != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? dev.isExternal() : "?")
                    + " capture=" + HwButtonsPlugin.captureVolume + " phoneBreak=" + HwButtonsPlugin.phoneKeyBreak);
            // Opt-in: the phone's own volume keys start/skip the break and are consumed
            // (no volume change). On the extended build the a11y service usually catches
            // these first; this covers the standard build + the foreground case.
            if (HwButtonsPlugin.phoneKeyBreak) {
                if (event.getRepeatCount() == 0) HwButtonsPlugin.firePhoneKeyBreak();
                return true; // consume → volume does NOT change
            }
            if (HwButtonsPlugin.captureVolume) {
                HwButtonsPlugin.suppressVolumeChange("onKeyDown-fg");
            }
        }
        return super.onKeyDown(keyCode, event); // let the system adjust volume normally
    }

    // When phone-volume-break is on, also swallow the key-UP so nothing adjusts volume.
    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if ((keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)
                && HwButtonsPlugin.phoneKeyBreak) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    // Leaving the app during a workout with the timer armed → float it as PiP.
    // Android 12+ handles this itself via PictureInPictureParams.setAutoEnterEnabled
    // (set in PipPlugin.setAutoEnter) — which ALSO covers the Recents/task-view button
    // and the swipe-up gesture. onUserLeaveHint only fires for Home, so it's just the
    // pre-12 fallback; running both would try to enter PiP twice.
    @Override
    protected void onUserLeaveHint() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return;
        if (PipPlugin.autoEnter
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            try {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(PipPlugin.autoW, PipPlugin.autoH))
                        .build();
                enterPictureInPictureMode(params);
            } catch (Exception e) {
                // PiP can be blocked by device policy / OEM, or the activity may be
                // finishing — never crash the app on Home for it.
            }
        }
    }

    // Tell the web layer to swap in / out of the minimal PiP break view.
    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPip, newConfig);
        PluginHandle handle = getBridge() != null ? getBridge().getPlugin("Pip") : null;
        if (handle != null && handle.getInstance() instanceof PipPlugin) {
            ((PipPlugin) handle.getInstance()).notifyPipChange(inPip);
        }
    }
}
