package no.defc0n.gymtracker;

import android.content.res.Configuration;
import android.app.PictureInPictureParams;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PipPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Auto-float the rest timer when the user leaves the app during a break.
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
