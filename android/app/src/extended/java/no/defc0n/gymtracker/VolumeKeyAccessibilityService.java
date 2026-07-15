package no.defc0n.gymtracker;

import android.accessibilityservice.AccessibilityService;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * EXTENDED FLAVOUR ONLY (src/extended) — not in the Play build.
 *
 * Why this exists: the whole point of the volume-button break is to press a button on
 * your HEADPHONES without taking the phone out. MainActivity.onKeyDown only gets volume
 * keys while the app has window focus, so it dies the moment the screen locks. A
 * MediaSession VolumeProvider doesn't save us either — volume keys route to whichever
 * media session is active, so a playing music app wins exactly when you need this.
 *
 * An AccessibilityService with flagRequestFilterKeyEvents receives key events GLOBALLY —
 * screen locked, any app on top, music playing. It's the only reliable route. Google Play
 * rejects non-accessibility uses of this API, which is why it lives in this flavour only.
 *
 * Runs in the app's process, so it can poke HwButtonsPlugin's static hook directly.
 * The user must enable it once: Android Settings → Accessibility → NoBS break button.
 */
public class VolumeKeyAccessibilityService extends AccessibilityService {

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Not interested in UI events — this service exists purely for key filtering.
    }

    @Override
    public void onInterrupt() {
        // no-op
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        int c = event.getKeyCode();
        if (c != KeyEvent.KEYCODE_VOLUME_UP && c != KeyEvent.KEYCODE_VOLUME_DOWN) return false;
        // Only swallow the press while a workout has actually armed it; otherwise the
        // volume keys must behave completely normally.
        if (!HwButtonsPlugin.captureVolume) return false;
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            if (!HwButtonsPlugin.fireVolumeKey()) return false; // no live plugin → let it pass
        }
        return true; // consume DOWN *and* UP, else the volume slider still pops up
    }
}
