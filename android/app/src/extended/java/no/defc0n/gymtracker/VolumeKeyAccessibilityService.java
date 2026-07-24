package no.defc0n.gymtracker;

import android.accessibilityservice.AccessibilityService;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * EXTENDED FLAVOUR ONLY (src/extended) — not in the Play build.
 *
 * The break is started by a Bluetooth EARBUD volume rocker, which reaches the app as an
 * AVRCP volume-LEVEL change (not a key event) and is caught by HwButtonsPlugin's volume
 * observer — that works even with the screen locked, no accessibility API needed.
 *
 * The PHONE's physical volume keys must stay normal VOLUME. In the foreground
 * MainActivity.onKeyDown handles that, but when the screen is LOCKED or another app is on
 * top, onKeyDown never fires — so a phone-key volume change would reach the observer and be
 * mistaken for an earbud press. This service (which sees key events globally via
 * flagRequestFilterKeyEvents) exists solely to catch that case: it NEVER consumes the key
 * (volume still adjusts), it just tells the observer to ignore the change the key causes.
 * Google Play rejects non-accessibility uses of this API, which is why it's flavour-only.
 *
 * Runs in the app's process, so it can poke HwButtonsPlugin's static hook directly.
 * The user enables it once: Android Settings → Accessibility → NoBS break button.
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
        // Phone volume keys stay normal volume even when locked — never consumed. We only
        // stop the observer from reading this phone-key change as an earbud break trigger.
        if (HwButtonsPlugin.captureVolume && event.getAction() == KeyEvent.ACTION_DOWN) {
            HwButtonsPlugin.suppressVolumeChange();
        }
        return false; // never consume — let the system adjust the volume
    }
}
