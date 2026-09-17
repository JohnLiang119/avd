package com.mattpocock.avd;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;

/**
 * 把設定中的每日時間登錄成系統鬧鐘。
 *
 * 用 {@link AlarmManager#setAlarmClock} 而非 setExactAndAllowWhileIdle 或 WorkManager
 * （見 design.md D1）：三者只有它同時滿足「穿透 Doze」「不被 9 分鐘節流」「享有
 * Android 12+ 從背景啟動前景服務的豁免」，而且會顯示在系統的「下一個鬧鐘」——
 * 使用者看得到自己設了什麼，這件事本身就是可靠度的一部分。
 *
 * 一律只登錄**下一次**的單次觸發，響完再由接收器登錄下一次。setRepeating 自 API 19
 * 起即為不精確，且跨日與時區變更的處理不透明。
 */
public final class RadioAlarmScheduler {

    private static final String TAG = "RadioAlarmScheduler";

    /** 鬧鐘觸發時送給 {@link RadioAlarmReceiver} 的動作。 */
    public static final String ACTION_ALARM_FIRE = "com.mattpocock.avd.RADIO_ALARM_FIRE";

    public static final String EXTRA_ENTRY_ID = "entryId";
    public static final String EXTRA_DURATION_MIN = "durationMin";
    /** 預定開始時刻，供播放服務計算 3 分鐘失敗窗（而非以實際啟動時間計算）。 */
    public static final String EXTRA_SCHEDULED_AT = "scheduledAt";

    private RadioAlarmScheduler() {
    }

    /**
     * 依目前設定重新登錄所有鬧鐘：先取消上一輪登錄過的每一筆，再登錄現在啟用的每一筆。
     *
     * 先全取消再全登錄，而不是「算出差異只改變動的部分」：差異計算是另一個會靜默
     * 出錯的地方，而重新登錄的成本可以忽略。
     */
    public static void rescheduleAll(Context context) {
        RadioAlarmStore store = new RadioAlarmStore(context);
        RadioAlarmConfig config = store.getConfig();

        for (String id : store.getScheduledIds()) {
            cancel(context, id);
        }

        List<String> scheduled = new ArrayList<String>();
        long now = System.currentTimeMillis();
        TimeZone zone = TimeZone.getDefault();

        for (RadioAlarmConfig.Entry entry : config.enabledEntries()) {
            long triggerAt = RadioAlarmSchedule.nextTrigger(now, entry.time, zone);
            if (triggerAt < 0) continue;
            if (schedule(context, entry, triggerAt)) {
                scheduled.add(entry.id);
            }
        }

        store.setScheduledIds(scheduled);
        Log.d(TAG, "rescheduleAll: " + scheduled.size() + " alarm(s) registered");
    }

    /** 登錄單一項目的下一次觸發。 */
    public static boolean schedule(Context context, RadioAlarmConfig.Entry entry, long triggerAt) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return false;

        PendingIntent operation = buildOperation(context, entry, triggerAt);
        try {
            AlarmManager.AlarmClockInfo info =
                    new AlarmManager.AlarmClockInfo(triggerAt, buildShowIntent(context));
            manager.setAlarmClock(info, operation);
            return true;
        } catch (SecurityException e) {
            // 精確鬧鐘權限被撤銷（API 31–32 可被使用者關閉）。介面會依
            // canScheduleExactAlarms 顯示說明與前往系統設定的入口。
            Log.e(TAG, "setAlarmClock denied for entry " + entry.id, e);
            return false;
        }
    }

    /** 取消單一項目的登錄。 */
    public static void cancel(Context context, String entryId) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        PendingIntent operation = PendingIntent.getBroadcast(
                context, requestCodeFor(entryId), buildFireIntent(context, entryId),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (operation != null) {
            manager.cancel(operation);
            operation.cancel();
        }
    }

    /** 系統是否允許本 App 登錄精確鬧鐘。API 31 以下一律為 true。 */
    public static boolean canScheduleExactAlarms(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return manager != null && manager.canScheduleExactAlarms();
    }

    // ---- PendingIntent 的組成 ----

    private static PendingIntent buildOperation(Context context, RadioAlarmConfig.Entry entry, long triggerAt) {
        Intent intent = buildFireIntent(context, entry.id);
        intent.putExtra(EXTRA_DURATION_MIN, entry.durationMin);
        intent.putExtra(EXTRA_SCHEDULED_AT, triggerAt);
        return PendingIntent.getBroadcast(
                context, requestCodeFor(entry.id), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * 每筆各自的觸發 Intent。
     *
     * data 以項目 id 組成唯一的 URI：PendingIntent 的比對（filterEquals）**不看 extras**，
     * 只看 action、data、type、component 與 category。少了這個 URI，兩筆不同時間的
     * 鬧鐘會被視為同一個 PendingIntent 而互相覆蓋 —— 只會有一筆真的響。
     */
    private static Intent buildFireIntent(Context context, String entryId) {
        Intent intent = new Intent(context, RadioAlarmReceiver.class);
        intent.setAction(ACTION_ALARM_FIRE);
        intent.setData(Uri.parse("avd-radio-alarm://entry/" + entryId));
        intent.putExtra(EXTRA_ENTRY_ID, entryId);
        return intent;
    }

    /**
     * 系統鬧鐘介面（狀態列的鬧鐘圖示、鎖定畫面）點下去會開啟的畫面。
     * design.md D3.6 的後路也用它把 App 拉到前景。
     */
    static PendingIntent buildShowIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int requestCodeFor(String entryId) {
        return entryId == null ? 0 : entryId.hashCode();
    }
}
