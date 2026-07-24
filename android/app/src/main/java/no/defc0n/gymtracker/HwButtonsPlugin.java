package no.defc0n.gymtracker;

import android.content.Context;
import android.content.Intent;
import android.database.ContentObserver;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
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
 *
 * - Volume-CHANGE observer (armed with setCapture): a Bluetooth earbud volume
 *   rocker sends an AVRCP absolute-volume command, NOT a key event, so onKeyDown
 *   and the accessibility service never see it — but with absolute volume (Android's
 *   default) it DOES move the media-stream level. We watch that level and, while
 *   armed, treat a change as a break trigger and snap the volume back. This is the
 *   only route that works from the earbuds. Phone/accessibility volume KEYS are
 *   consumed before the level changes, so they go through notifyVolumeKey() instead
 *   and never reach this observer — the two paths compose, they don't double-fire.
 *
 * - duck(): request transient MAY_DUCK audio focus so a playing music app dims
 *   (not pauses) while a break sound / countdown plays over it, then release.
 */
@CapacitorPlugin(name = "HwButtons")
public class HwButtonsPlugin extends Plugin {

    // Read by MainActivity.onKeyDown() — captures BOTH volume up and down.
    static boolean captureVolume = false;

    // Live instance, so the EXTENDED flavor's VolumeKeyAccessibilityService can fire
    // a volume press from OUTSIDE the activity (screen locked / another app on top).
    // It runs in this same process but has no Capacitor Bridge of its own.
    private static HwButtonsPlugin instance;

    private MediaSession session;

    // --- Volume-change observer (earbud AVRCP rocker) ---
    private AudioManager audioManager;
    private ContentObserver volumeObserver;
    private int lastMusicVol = -1;
    private boolean suppressVolumeObserver = false; // ignore our own snap-back write

    // --- Audio-focus ducking ---
    private AudioFocusRequest duckRequest;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable releaseDuck;

    @Override
    public void load() {
        instance = this;
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
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
        getActivity().runOnUiThread(() -> {
            if (captureVolume) startVolumeObserver();
            else stopVolumeObserver();
        });
        call.resolve();
    }

    // --- Volume-change observer -------------------------------------------------

    private void startVolumeObserver() {
        if (volumeObserver != null || audioManager == null) return;
        lastMusicVol = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        volumeObserver = new ContentObserver(main) {
            @Override
            public void onChange(boolean selfChange) {
                if (audioManager == null) return;
                int now = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                if (now == lastMusicVol) return; // a different stream changed
                if (suppressVolumeObserver) { // our own snap-back write
                    lastMusicVol = now;
                    return;
                }
                if (captureVolume) {
                    // Consume the change as a break trigger and restore the level so
                    // the user's music volume doesn't drift over the session.
                    final int restore = lastMusicVol;
                    suppressVolumeObserver = true;
                    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, restore, 0);
                    main.postDelayed(() -> suppressVolumeObserver = false, 300);
                    notifyVolumeKey();
                } else {
                    lastMusicVol = now;
                }
            }
        };
        getContext().getContentResolver()
                .registerContentObserver(Settings.System.CONTENT_URI, true, volumeObserver);
    }

    private void stopVolumeObserver() {
        if (volumeObserver != null) {
            try {
                getContext().getContentResolver().unregisterContentObserver(volumeObserver);
            } catch (Exception ignored) {
            }
            volumeObserver = null;
        }
    }

    // --- Audio-focus ducking ----------------------------------------------------

    @PluginMethod
    public void duck(PluginCall call) {
        int ms = call.getInt("durationMs", 1500);
        getActivity().runOnUiThread(() -> requestDuck(ms));
        call.resolve();
    }

    private void requestDuck(int ms) {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (duckRequest == null) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build();
                    duckRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                            .setAudioAttributes(attrs)
                            .build();
                }
                audioManager.requestAudioFocus(duckRequest);
            } else {
                audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch (Exception ignored) {
            return;
        }
        // Extend the hold if a new sound comes in before the old one released.
        if (releaseDuck != null) main.removeCallbacks(releaseDuck);
        releaseDuck = this::abandonDuck;
        main.postDelayed(releaseDuck, Math.max(300, ms));
    }

    private void abandonDuck() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (duckRequest != null) audioManager.abandonAudioFocusRequest(duckRequest);
            } else {
                audioManager.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {
        }
    }

    // --- Media button (headset play/pause) --------------------------------------

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
        stopVolumeObserver();
        abandonDuck();
        if (instance == this) instance = null;
    }

    // Called by MainActivity when a captured volume key (up or down) fires.
    void notifyVolumeKey() {
        notifyListeners("volumeKey", new JSObject());
    }
}
