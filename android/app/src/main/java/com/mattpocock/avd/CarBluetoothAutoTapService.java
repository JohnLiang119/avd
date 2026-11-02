package com.mattpocock.avd;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import java.util.List;
import java.util.Set;

/**
 * 無障礙服務「AVD 自動點選車機」（OpenSpec car-bluetooth-connect）。
 *
 * 實車驗證 CX501A 不吃 RFCOMM 喚醒，但在系統藍牙設定頁點一下就連得上；Android 12 起
 * App 又不能自己叫系統連線。不加 Shizuku、不 root 的前提下，唯一能自動化的就是替使用者
 * 點那一下 —— 本服務只做這件事。
 *
 * 範圍限制：只在本 App 經 {@link CarBluetoothSettingsActivity} 開啟藍牙設定後的
 * {@link #ARM_MS} 內動作（{@link #arm}），其餘時間收到的事件一律直接忽略；只點名稱與選定
 * 車機完全相同的那一列，且每次開啟至多點一次。點之前先確認車機還沒連上 —— 在設定頁點
 * 已連線的裝置，部分 ROM 會跳出中斷連線。
 *
 * 待命狀態只在主執行緒讀寫（中繼頁與無障礙事件都在主執行緒）；查連線狀態會阻塞，丟到
 * 背景執行緒再 post 回來。
 */
public class CarBluetoothAutoTapService extends AccessibilityService {

    private static final String TAG = "CarBtAutoTap";

    /** 開啟藍牙設定後等待點選的上限。設定頁通常一秒內出現，多留給列表載入與捲動。 */
    private static final long ARM_MS = 15 * 1000L;
    /** 點下去後等音訊協定接回的上限；接上就提示並返回。 */
    private static final long VERIFY_MS = 12 * 1000L;
    /** 列表裡看不到車機時往下捲的次數上限，與開始捲之前讓列表先載入的時間、兩次捲動的間隔。 */
    private static final int MAX_SCROLLS = 5;
    private static final long SCROLL_SETTLE_MS = 1200L;
    private static final long SCROLL_GAP_MS = 700L;
    /** 從名稱文字往上找可點擊列的層數上限。 */
    private static final int MAX_ANCESTOR_DEPTH = 8;
    /** 系統 UI（快速設定磚的標籤就是車機名稱）不可點。本 App 自己的畫面另外排除。 */
    private static final String SYSTEM_UI_PACKAGE = "com.android.systemui";

    private static volatile CarBluetoothAutoTapService instance;
    private static volatile Target target;

    private final Handler main = new Handler(Looper.getMainLooper());

    /** 一次「開啟藍牙設定」的待命。 */
    private static final class Target {
        final String address;
        final String name;
        final Set<String> names;
        /** 藍牙設定頁所屬套件；只在這裡捲動。解析不到為 null（不捲動，仍可點選）。 */
        final String settingsPackage;
        final long until;
        /** 已找到列、正在背景確認是否已連線，期間不重複處理事件。 */
        boolean checking = false;
        int scrolls = 0;
        long firstSeenAt = 0L;
        long lastScrollAt = 0L;

        Target(String address, String name, Set<String> names, String settingsPackage, long until) {
            this.address = address;
            this.name = name;
            this.names = names;
            this.settingsPackage = settingsPackage;
            this.until = until;
        }
    }

    // ---- 給其他元件用 ----

    /** 服務是否已被使用者在無障礙設定開啟並由系統綁定。 */
    public static boolean isActive() {
        return instance != null;
    }

    /**
     * 本 App 即將開啟藍牙設定：記下要點的車機，待命 {@link #ARM_MS}。服務沒開或沒選車機時
     * 什麼都不做。MUST 在主執行緒呼叫。
     */
    public static void arm(Context context) {
        if (instance == null) return;
        CarBluetoothStore.Device car = new CarBluetoothStore(context).get();
        if (car == null || !CarBluetooth.hasPermission(context)) {
            target = null;
            return;
        }
        target = new Target(car.address, car.name, CarBluetooth.displayNames(context, car),
                resolveSettingsPackage(context), System.currentTimeMillis() + ARM_MS);
        Log.d(TAG, "armed for " + car.name);
    }

    public static void disarm() {
        target = null;
    }

    /**
     * 前往系統無障礙設定開啟本服務：先試直接開到本服務的詳細頁（非公開動作，部分 ROM
     * 沒有），開不了由呼叫端改用 {@link #accessibilitySettingsIntent()}。
     */
    public static Intent serviceDetailsIntent(Context context) {
        Intent intent = new Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS");
        intent.putExtra(Intent.EXTRA_COMPONENT_NAME,
                new ComponentName(context, CarBluetoothAutoTapService.class).flattenToString());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    public static Intent accessibilitySettingsIntent() {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    private static String resolveSettingsPackage(Context context) {
        try {
            ResolveInfo info = context.getPackageManager()
                    .resolveActivity(CarBluetooth.systemSettingsIntent(), 0);
            return info == null || info.activityInfo == null ? null : info.activityInfo.packageName;
        } catch (Exception e) {
            Log.w(TAG, "cannot resolve bluetooth settings package", e);
            return null;
        }
    }

    // ---- 服務生命週期 ----

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        Log.d(TAG, "service connected");
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        target = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        target = null;
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        // 沒有回饋（語音、震動）要中斷
    }

    // ---- 點選 ----

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        final Target t = target;
        if (t == null || t.checking) return;
        long now = System.currentTimeMillis();
        if (now > t.until) {
            Log.d(TAG, "gave up: " + t.name + " not found in time");
            target = null;
            return;
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        final String pkg = root.getPackageName() == null ? null : root.getPackageName().toString();
        if (pkg == null || pkg.equals(getPackageName()) || SYSTEM_UI_PACKAGE.equals(pkg)) return;

        if (findLabel(root, t.names) == null) {
            maybeScroll(t, root, pkg, now);
            return;
        }

        // 找到了：先在背景確認車機還沒連上（點已連線的裝置可能跳出中斷連線），再回主執行緒點
        t.checking = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean connected = CarBluetooth.isConnected(
                        CarBluetoothAutoTapService.this, t.address);
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        tapIfStillNeeded(t, pkg, connected);
                    }
                });
            }
        }, "car-bt-autotap-check").start();
    }

    private void tapIfStillNeeded(Target t, String pkg, boolean connected) {
        if (target != t) return;
        if (connected) {
            Log.d(TAG, t.name + " already connected, not tapping");
            target = null;
            return;
        }
        // 確認期間畫面可能變了：以當下的畫面重新找
        AccessibilityNodeInfo root = getRootInActiveWindow();
        AccessibilityNodeInfo label = root == null || !pkg.equals(String.valueOf(root.getPackageName()))
                ? null : findLabel(root, t.names);
        if (label == null) {
            t.checking = false;
            return;
        }
        target = null;
        boolean tapped = tap(label);
        Log.d(TAG, "tapped " + t.name + ": " + tapped);
        if (tapped) verify(t, pkg);
    }

    /** 名稱完全相同且使用者看得到的節點；「包含」不夠嚴格，會點到名稱相近的其他裝置。 */
    private static AccessibilityNodeInfo findLabel(AccessibilityNodeInfo root, Set<String> names) {
        for (String name : names) {
            List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByText(name);
            if (found == null) continue;
            for (AccessibilityNodeInfo node : found) {
                if (node.isVisibleToUser() && (matches(node.getText(), name)
                        || matches(node.getContentDescription(), name))) {
                    return node;
                }
            }
        }
        return null;
    }

    private static boolean matches(CharSequence text, String name) {
        return text != null && text.toString().trim().equals(name);
    }

    /** 點最近的可點擊祖先（整列）；找不到或被拒時改在文字中心送出點按手勢，等同手指點。 */
    private boolean tap(AccessibilityNodeInfo label) {
        AccessibilityNodeInfo node = label;
        for (int i = 0; node != null && i < MAX_ANCESTOR_DEPTH; i++) {
            if (node.isClickable()) {
                if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
                break;
            }
            node = node.getParent();
        }
        Rect bounds = new Rect();
        label.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) return false;
        Path path = new Path();
        path.moveTo(bounds.exactCenterX(), bounds.exactCenterY());
        GestureDescription gesture = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0L, 50L))
                .build();
        return dispatchGesture(gesture, null, null);
    }

    /** 列表裡看不到車機：等列表載入後往下捲，只捲藍牙設定所屬的 App。 */
    private void maybeScroll(Target t, AccessibilityNodeInfo root, String pkg, long now) {
        if (t.settingsPackage == null || !t.settingsPackage.equals(pkg)) return;
        if (t.firstSeenAt == 0L) t.firstSeenAt = now;
        if (t.scrolls >= MAX_SCROLLS) return;
        if (now - t.firstSeenAt < SCROLL_SETTLE_MS || now - t.lastScrollAt < SCROLL_GAP_MS) return;
        AccessibilityNodeInfo list = findScrollable(root, 0);
        if (list == null) return;
        t.lastScrollAt = now;
        // 捲不動代表到底了，不再嘗試
        t.scrolls = list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) ? t.scrolls + 1 : MAX_SCROLLS;
    }

    private static AccessibilityNodeInfo findScrollable(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 30) return null;
        if (node.isScrollable() && node.isVisibleToUser()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = findScrollable(node.getChild(i), depth + 1);
            if (found != null) return found;
        }
        return null;
    }

    /** 點了之後等接回：接上就提示，並在設定頁仍在最前面時按一次返回把它收掉。 */
    private void verify(final Target t, final String pkg) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean connected = CarBluetooth.awaitConnected(
                        CarBluetoothAutoTapService.this, t.address, VERIFY_MS);
                Log.d(TAG, "after tap, " + t.name + " connected: " + connected);
                if (!connected) return;  // 沒接回：設定頁留著讓使用者處理
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(CarBluetoothAutoTapService.this,
                                "已連線 " + t.name, Toast.LENGTH_SHORT).show();
                        AccessibilityNodeInfo root = getRootInActiveWindow();
                        if (root != null && pkg.equals(String.valueOf(root.getPackageName()))) {
                            performGlobalAction(GLOBAL_ACTION_BACK);
                        }
                    }
                });
            }
        }, "car-bt-autotap-verify").start();
    }
}
