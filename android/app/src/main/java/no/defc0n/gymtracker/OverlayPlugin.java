package no.defc0n.gymtracker;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A small always-on-top floating timer the app fully controls: draggable, position
 * saved, size chosen in-app. Shown when the user leaves the app during a workout
 * (MainActivity.onUserLeaveHint), hidden on return (onResume). Ticks natively so the
 * time keeps updating while the WebView is paused. Needs SYSTEM_ALERT_WINDOW.
 */
@CapacitorPlugin(name = "Overlay")
public class OverlayPlugin extends Plugin {
    static boolean armed = false;

    // Latest state pushed from JS (native computes the ticking time from these, so it
    // keeps counting while the WebView is paused).
    private static long restEndsAt = 0;
    private static long startEpoch = 0; // workout start (ms); WORK time = now - startEpoch
    private static int bpm = 0;
    private static int sizeSp = 22;

    private WindowManager wm;
    private TextView view;
    private WindowManager.LayoutParams params;
    private Handler handler;
    private Runnable ticker;
    private boolean showing = false;

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", canDraw());
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!canDraw()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void arm(PluginCall call) {
        applyState(call);
        armed = call.getBoolean("enabled", false);
        if (!armed) getActivity().runOnUiThread(this::hideNow);
        call.resolve();
    }

    @PluginMethod
    public void setState(PluginCall call) {
        applyState(call);
        getActivity().runOnUiThread(this::render);
        call.resolve();
    }

    private void applyState(PluginCall call) {
        if (call.hasOption("restEndsAt")) restEndsAt = (long) call.getDouble("restEndsAt", 0.0).doubleValue();
        if (call.hasOption("startEpoch")) startEpoch = (long) call.getDouble("startEpoch", 0.0).doubleValue();
        if (call.hasOption("bpm")) bpm = call.getInt("bpm", 0);
        if (call.hasOption("sizeSp")) sizeSp = call.getInt("sizeSp", 22);
    }

    // Show the bubble when the app leaves the foreground, hide it on return.
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (armed && !showing && canDraw()) getActivity().runOnUiThread(this::createAndAdd);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        getActivity().runOnUiThread(this::hideNow);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        getActivity().runOnUiThread(this::hideNow);
    }

    private void createAndAdd() {
        Context ctx = getContext().getApplicationContext();
        wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (view == null) {
            view = new TextView(ctx);
            view.setTextColor(Color.WHITE);
            view.setPadding(dp(14), dp(9), dp(14), dp(9));
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.parseColor("#0e1116"));
            bg.setCornerRadius(dp(16));
            bg.setStroke(dp(2), Color.parseColor("#4f8cff"));
            view.setBackground(bg);

            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;
            params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                    PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.START;
            params.x = getContext().getSharedPreferences("overlay", Context.MODE_PRIVATE).getInt("x", dp(24));
            params.y = getContext().getSharedPreferences("overlay", Context.MODE_PRIVATE).getInt("y", dp(140));
            attachTouch();
        }
        render();
        try {
            wm.addView(view, params);
            showing = true;
            startTicker();
        } catch (Exception e) {
            showing = false;
        }
    }

    private void hideNow() {
        stopTicker();
        if (showing && wm != null && view != null) {
            try { wm.removeView(view); } catch (Exception ignored) {}
        }
        showing = false;
    }

    private void startTicker() {
        stopTicker();
        handler = new Handler(Looper.getMainLooper());
        ticker = new Runnable() {
            public void run() {
                render();
                if (showing) handler.postDelayed(this, 500);
            }
        };
        handler.post(ticker);
    }

    private void stopTicker() {
        if (handler != null && ticker != null) handler.removeCallbacks(ticker);
    }

    private void render() {
        if (view == null) return;
        long now = System.currentTimeMillis();
        String text;
        if (restEndsAt > now) {
            text = "BREAK " + mmss((restEndsAt - now) / 1000);
        } else {
            long secs = startEpoch > 0 ? Math.max(0, (now - startEpoch) / 1000) : 0;
            text = "WORK " + hhmmss(secs);
        }
        if (bpm > 0) text += "   ♥" + bpm;
        view.setText(text);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
    }

    private void attachTouch() {
        view.setOnTouchListener(new View.OnTouchListener() {
            float downX, downY;
            int startX, startY;
            boolean moved;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX();
                        downY = e.getRawY();
                        startX = params.x;
                        startY = params.y;
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - downX);
                        int dy = (int) (e.getRawY() - downY);
                        if (Math.abs(dx) > dp(5) || Math.abs(dy) > dp(5)) moved = true;
                        params.x = startX + dx;
                        params.y = startY + dy;
                        try { wm.updateViewLayout(view, params); } catch (Exception ignored) {}
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (moved) {
                            getContext().getSharedPreferences("overlay", Context.MODE_PRIVATE)
                                    .edit().putInt("x", params.x).putInt("y", params.y).apply();
                        } else {
                            // Tap → bring the app to the front.
                            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
                            if (launch != null) {
                                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                                getContext().startActivity(launch);
                            }
                        }
                        return true;
                }
                return false;
            }
        });
    }

    private int dp(int v) {
        return (int) (v * getContext().getResources().getDisplayMetrics().density);
    }

    private String mmss(long s) {
        return (s / 60) + ":" + String.format(java.util.Locale.US, "%02d", s % 60);
    }

    private String hhmmss(long s) {
        long h = s / 3600, m = (s % 3600) / 60, r = s % 60;
        return h > 0
                ? h + ":" + String.format(java.util.Locale.US, "%02d", m) + ":" + String.format(java.util.Locale.US, "%02d", r)
                : m + ":" + String.format(java.util.Locale.US, "%02d", r);
    }
}
