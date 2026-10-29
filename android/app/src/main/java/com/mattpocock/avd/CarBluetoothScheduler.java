package com.mattpocock.avd;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.util.List;
import java.util.TimeZone;

/**
 * 把車機連線排程的「區段開始」登錄成系統鬧鐘。
 *
 * 只維護**一個**系統鬧鐘：指向所有啟用區段中最早的下一次開始。觸發時接收器重算並
 * 登錄下一個，所以不必追蹤「上一輪登錄了哪些 id」。區段內的重試由
 * {@link CarBluetoothConnectService} 負責，不靠鬧鐘。
 *
 * 用 setExactAndAllowWhileIdle 而不是 setAlarmClock：連線排程不是要「叫醒」使用者的
 * 鬧鐘，不該佔用狀態列的鬧鐘圖示與系統的「下一個鬧鐘」。精確鬧鐘到點時系統允許
 * 從背景啟動前景服務。
 */
public final class CarBluetoothScheduler {

    private static final String TAG = "CarBluetoothScheduler";

    public static final String ACTION_FIRE = "com.mattpocock.avd.CAR_BLUETOOTH_SCHEDULE_FIRE";
    private static final int REQUEST_CODE = 4210;

    private CarBluetoothScheduler() {
    }

    private static PendingIntent pending(Context context, int flags) {
        Intent intent = new Intent(context, CarBluetoothScheduleReceiver.class);
        intent.setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * 依目前設定重新登錄：先取消舊的，再登錄最早的下一次開始；沒有啟用項目就只取消。
     *
     * @param startIfActive 現在若已落在某個區段內，是否立刻開始連線。重開機、改時間、
     *                      使用者儲存設定時為 true（區段中途開機仍要連）；區段開始的
     *                      鬧鐘觸發時為 false（接收器自己會啟動，不重複）。
     */
    public static void reschedule(Context context, boolean startIfActive) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;

        manager.cancel(pending(context, PendingIntent.FLAG_UPDATE_CURRENT));

        List<CarBluetoothSchedule.Entry> entries = new CarBluetoothStore(context).getSchedule();
        long now = System.currentTimeMillis();
        TimeZone zone = TimeZone.getDefault();

        if (startIfActive && new CarBluetoothStore(context).get() != null) {
            long activeEnd = CarBluetoothSchedule.activeWindowEnd(entries, now, zone);
            if (activeEnd > 0) {
                Log.d(TAG, "inside a window until " + activeEnd + ", starting connect loop");
                CarBluetoothConnectService.start(context, activeEnd);
            }
        }

        long triggerAt = CarBluetoothSchedule.earliestNextTrigger(entries, now, zone);
        if (triggerAt < 0) {
            Log.d(TAG, "no enabled schedule, alarm cancelled");
            return;
        }

        PendingIntent operation = pending(context, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
                // 精確鬧鐘被使用者關閉（API 31–32）：退而求其次，區段開始可能晚幾分鐘
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation);
            } else {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation);
            }
            Log.d(TAG, "next car bluetooth window starts at " + triggerAt);
        } catch (SecurityException e) {
            Log.e(TAG, "cannot schedule car bluetooth alarm", e);
        }
    }

    /** 下一次區段開始（epoch 毫秒）；沒有啟用項目為 -1。供介面顯示。 */
    public static long nextTriggerAt(Context context) {
        return CarBluetoothSchedule.earliestNextTrigger(
                new CarBluetoothStore(context).getSchedule(), System.currentTimeMillis(), TimeZone.getDefault());
    }

    /** 目前所在區段的結束時刻；不在任何區段內為 -1。供介面顯示。 */
    public static long activeUntil(Context context) {
        return CarBluetoothSchedule.activeWindowEnd(
                new CarBluetoothStore(context).getSchedule(), System.currentTimeMillis(), TimeZone.getDefault());
    }
}
