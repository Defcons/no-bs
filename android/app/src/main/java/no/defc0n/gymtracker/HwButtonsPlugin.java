package no.defc0n.gymtracker;

import android.content.Intent;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hardware-button bridge, armed only while a workout is active (Settings toggles):
 *
 * - Volume-up: MainActivity.onKeyDown consumes VOLUME UP and emits "volumeUp"
 *   instead of changing the volume. Headphone volume buttons send the same
 *   keycode, so they work too.
 *
 * - Headphone/media button (optional, separate toggle): a foreground MediaSession
 *   claims media-button routing and emits "mediaButton" on play/pause/headset-hook
 *   presses. TRADE-OFF (shown in Settings): while armed, that button starts the
 *   break INSTEAD of controlling the user's music app.
 */
@CapacitorPlugin(name = "HwButtons")
public class HwButtonsPlugin extends Plugin {

    // Read by MainActivity.onKeyDown() — captures BOTH volume up and down.
    static boolean captureVolume = false;

    // Live instance, so the PERSONAL flavor's VolumeKeyAccessibilityService can fire
    // a volume press from OUTSIDE the activity (screen locked / another app on top).
    // It runs in this same process but has no Capacitor Bridge of its own.
    private static HwButtonsPlugin instance;

    private MediaSession session;

    @Override
    public void load() {
        instance = this;
    }

    /** Static entry point for the accessibility service. True if the press was consumed. */
    static boolean fireVolumeKey() {
        HwButtonsPlugin p = instance;
        if (p != null && captureVolume) {
            p.notifyVolumeKey();
            return true;
        }
        return false;
    }

    @PluginMethod
    public void setCapture(PluginCall call) {
        captureVolume = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void setMediaCapture(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (enabled) startSession();
            else stopSession();
        });
        call.resolve();
    }

    private void startSession() {
        if (session != null) return;
        try {
            session = new MediaSession(getContext(), "nobs-break");
            session.setCallback(new MediaSession.Callback() {
                @Override
                public boolean onMediaButtonEvent(Intent intent) {
                    KeyEvent ev = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                    if (ev != null && ev.getAction() == KeyEvent.ACTION_DOWN) {
                        int c = ev.getKeyCode();
                        if (c == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                                || c == KeyEvent.KEYCODE_HEADSETHOOK
                                || c == KeyEvent.KEYCODE_MEDIA_PLAY
                                || c == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                            notifyListeners("mediaButton", new JSObject());
                            return true;
                        }
                    }
                    return super.onMediaButtonEvent(intent);
                }
            });
            // STATE_PLAYING makes Android treat us as the active media target so
            // the headset button routes here while armed.
            session.setPlaybackState(new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE)
                    .setState(PlaybackState.STATE_PLAYING, 0, 1.0f)
                    .build());
            session.setActive(true);
        } catch (Exception e) {
            session = null; // never crash the workout over a media session
        }
    }

    private void stopSession() {
        if (session != null) {
            try {
                session.setActive(false);
                session.release();
            } catch (Exception ignored) {
            }
            session = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopSession();
        if (instance == this) instance = null;
    }

    // Called by MainActivity when a captured volume key (up or down) fires.
    void notifyVolumeKey() {
        notifyListeners("volumeKey", new JSObject());
    }
}
