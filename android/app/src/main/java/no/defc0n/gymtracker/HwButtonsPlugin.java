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
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hardware-button bridge, armed only while a workout is active (Settings toggles):
 *
 * - Volume-CHANGE observer (armed with setCapture): the BREAK is started by a Bluetooth
 *   earbud volume rocker, which sends an AVRCP absolute-volume command — NOT a key event,
 *   so onKeyDown and the accessibility service never see it, but with absolute volume
 *   (Android's default) it DOES move the media-stream level. We watch that level and,
 *   while armed, treat a change as a break trigger (emit "volumeKey") and snap the volume
 *   back so music volume doesn't drift. This is the only route that works from earbuds.
 *
 *   The PHONE's physical volume keys stay NORMAL VOLUME — they are never consumed. To keep
 *   the observer from mistaking a phone-key change for an earbud press, MainActivity
 *   (foreground) and the accessibility service (locked) call suppressVolumeChange() first,
 *   so that one level change is ignored. Net: phone buttons = volume, earbud rocker = break.
 *
 * - Headphone/media button (optional, separate toggle): a foreground MediaSession
 *   claims media-button routing and emits "mediaButton" on play/pause/headset-hook
 *   presses. TRADE-OFF (shown in Settings): while armed, that button starts the
 *   break INSTEAD of controlling the user's music app.
 *
 * - duck(): request transient MAY_DUCK audio focus so a playing music app dims
 *   (not pauses) while a break sound / countdown plays over it, then release.
 */
@CapacitorPlugin(name = "HwButtons")
public class HwButtonsPlugin extends Plugin {

    // Diagnostic tag — `adb logcat -s HwBreak:D` to trace the earbud-break chain.
    static final String TAG = "HwBreak";
    // Logging gate: OFF for shipped builds (no diagnostic spam in the Play release).
    // Flip to true and rebuild to re-enable the HwBreak trace during development.
    private static final boolean DEBUG_LOG = false;

    static void log(String m) {
        if (DEBUG_LOG) Log.d(TAG, m);
    }

    // Read by MainActivity.onKeyDown() — captures BOTH volume up and down.
    // volatile: written on Capacitor's plugin-executor thread, read on the main and
    // accessibility-service threads (no other fence between them).
    static volatile boolean captureVolume = false;

    // When true, the PHONE's own volume keys are CONSUMED (no volume change) and
    // start/skip the break instead — opt-in (setting `phoneVolumeBreak`). Read by
    // MainActivity.onKeyDown (foreground) and VolumeKeyAccessibilityService (locked).
    static volatile boolean phoneKeyBreak = false;
    private long lastPhoneFire = 0; // debounce: a11y + activity can both see one press

    // Live instance, so the EXTENDED flavor's VolumeKeyAccessibilityService can fire
    // a volume press from OUTSIDE the activity (screen locked / another app on top).
    // It runs in this same process but has no Capacitor Bridge of its own.
    private static volatile HwButtonsPlugin instance;

    // The a11y service must stop consuming keys once the activity (and with it the
    // whole break pipeline) is gone — see handleOnDestroy + VolumeKeyAccessibilityService.
    static boolean alive() {
        return instance != null;
    }

    private MediaSession session;

    // --- Volume-change observer (earbud AVRCP rocker) ---
    private AudioManager audioManager;
    private ContentObserver volumeObserver;
    private int lastMusicVol = -1;
    // Ignore the next level change: set for our own snap-back write AND for a PHONE
    // volume-key press (so phone buttons stay normal volume and only the earbud fires
    // the break). volatile — set from the accessibility service's key thread, read on main.
    private volatile boolean suppressVolumeObserver = false;
    private final Runnable clearSuppress = () -> suppressVolumeObserver = false;

    // --- Audio-focus ducking ---
    private AudioFocusRequest duckRequest;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable releaseDuck;

    @Override
    public void load() {
        instance = this;
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    // Tell the volume observer to ignore the next level change — because a PHONE
    // volume KEY (from MainActivity.onKeyDown foreground, or the accessibility service
    // when locked) is about to change it, and phone keys must stay normal volume, not
    // a break trigger. Only the earbud AVRCP change (no key event → no suppress) fires
    // the break. Safe to call from any thread.
    static void suppressVolumeChange(String source) {
        HwButtonsPlugin p = instance;
        if (p != null) p.doSuppress(source);
    }

    private void doSuppress(String source) {
        log("suppress armed by " + source);
        suppressVolumeObserver = true;
        main.removeCallbacks(clearSuppress);
        main.postDelayed(clearSuppress, 400);
    }

    // A PHONE volume key was pressed while `phoneKeyBreak` is on → fire the break.
    // Debounced because the accessibility service (locked) and the activity's
    // onKeyDown (foreground) can both observe the same press, and keys auto-repeat.
    static void firePhoneKeyBreak() {
        HwButtonsPlugin p = instance;
        if (p != null) p.doPhoneKeyBreak();
    }

    private void doPhoneKeyBreak() {
        long now = SystemClock.uptimeMillis();
        if (now - lastPhoneFire < 300) return;
        lastPhoneFire = now;
        log("phone volume key -> break");
        notifyVolumeKey();
    }

    @PluginMethod
    public void setCapture(PluginCall call) {
        captureVolume = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        log("setCapture enabled=" + captureVolume);
        getActivity().runOnUiThread(() -> {
            if (captureVolume) startVolumeObserver();
            else stopVolumeObserver();
        });
        call.resolve();
    }

    @PluginMethod
    public void setPhoneKeyCapture(PluginCall call) {
        phoneKeyBreak = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        log("setPhoneKeyCapture enabled=" + phoneKeyBreak);
        call.resolve();
    }

    // --- Volume-change observer -------------------------------------------------

    // An earbud (AVRCP) press moves the media level by one — occasionally two —
    // steps. Anything bigger is the user actually SETTING volume (system slider
    // drag, Spotify Connect / Cast remote volume, app-driven change).
    private static final int MAX_EARBUD_STEP = 2;

    private void startVolumeObserver() {
        if (volumeObserver != null || audioManager == null) return;
        lastMusicVol = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        // Arm-time headroom: arming while the level sits AT min/max leaves the first
        // press in that direction with zero observable movement (same reason the
        // per-fire restore stays one step off the extremes) — nudge it in-range now.
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int nudged = Math.max(1, Math.min(max - 1, lastMusicVol));
        if (nudged != lastMusicVol) {
            log("arm-time nudge " + lastMusicVol + " -> " + nudged);
            lastMusicVol = nudged;
            try {
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, nudged, 0);
            } catch (Exception ignored) {
                // fixed-volume devices reject writes; the observer still works
            }
        }
        log("observer registered, music vol=" + lastMusicVol
                + " max=" + audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        volumeObserver = new ContentObserver(main) {
            @Override
            public void onChange(boolean selfChange) {
                if (audioManager == null) return;
                int now = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                log("onChange music now=" + now + " last=" + lastMusicVol
                        + " suppress=" + suppressVolumeObserver + " capture=" + captureVolume);
                if (now == lastMusicVol) {
                    log("  -> no music-level change (different stream, or at min/max dead zone)");
                    return; // a different stream changed
                }
                if (suppressVolumeObserver) { // our own snap-back OR a phone-key change
                    log("  -> suppressed (phone key or our snap-back); tracking last=" + now);
                    lastMusicVol = now;
                    return;
                }
                if (captureVolume) {
                    // Only a small step reads as an earbud press. A larger jump is real
                    // user volume intent (slider drag with the panel open, Spotify
                    // Connect/Cast remote, app-driven change) — firing a break AND
                    // snapping the level back made media volume impossible to adjust
                    // mid-workout. Re-baseline and let the user's change stand.
                    if (Math.abs(now - lastMusicVol) > MAX_EARBUD_STEP) {
                        log("  -> jump of " + (now - lastMusicVol) + " (user volume intent); re-baseline, no fire");
                        lastMusicVol = now;
                        return;
                    }
                    // An earbud rocker change (no key event preceded it): treat it as a
                    // break trigger and restore the level so music volume doesn't drift.
                    //
                    // Two fixes for the intermittent MISSES (2026-08-03):
                    //  (1) Restore NEAR the baseline but never AT an extreme. A press when
                    //      the level is already at min/max nets zero movement, so the
                    //      observer never sees it — leaving one step of headroom means
                    //      every earbud press produces an observable change.
                    //  (2) Update lastMusicVol to the restored value and DON'T arm a timed
                    //      suppress for our own snap-back: the write's onChange then hits
                    //      the `now == lastMusicVol` no-op path above. The old 400 ms
                    //      snap-back suppress swallowed a fast SECOND press ("double-tap
                    //      did nothing"); without it, a quick second press fires normally.
                    int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    final int restore = Math.max(1, Math.min(max - 1, lastMusicVol));
                    log("  -> EARBUD BREAK fire; restoring vol to " + restore + " (was " + lastMusicVol + ")");
                    lastMusicVol = restore;
                    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, restore, 0);
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
        // Reset the statics WITH the activity: on the extended flavour the a11y
        // service keeps this process alive after a swipe-away, and a leftover
        // phoneKeyBreak=true would make it consume EVERY volume key system-wide
        // with nothing left to receive the break (until the app is reopened).
        captureVolume = false;
        phoneKeyBreak = false;
        if (instance == this) instance = null;
    }

    // Called by MainActivity when a captured volume key (up or down) fires.
    void notifyVolumeKey() {
        log("notifyVolumeKey -> JS (break start/skip)");
        notifyListeners("volumeKey", new JSObject());
    }
}
