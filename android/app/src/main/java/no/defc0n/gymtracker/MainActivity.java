package no.defc0n.gymtracker;

import android.content.res.Configuration;
import android.app.PictureInPictureParams;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
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

    // Volume up OR down → start/skip break (Settings toggle; armed only during an
    // active workout). Consumed so the media volume doesn't change while armed.
    // NOTE: onKeyDown only fires while the app has window focus (foreground) — Android
    // does not deliver volume keys to a backgrounded or PiP app; that's a platform limit.
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if ((keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)
                && HwButtonsPlugin.captureVolume) {
            PluginHandle handle = getBridge() != null ? getBridge().getPlugin("HwButtons") : null;
            if (handle != null && handle.getInstance() instanceof HwButtonsPlugin) {
                ((HwButtonsPlugin) handle.getInstance()).notifyVolumeKey();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    // Also swallow the matching key-up while armed, or the system still shows the
    // volume slider (volume is often applied on ACTION_UP).
    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if ((keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)
                && HwButtonsPlugin.captureVolume) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    // Leaving the app during a workout with the timer armed → float it as PiP.
    @Override
    protected void onUserLeaveHint() {
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
