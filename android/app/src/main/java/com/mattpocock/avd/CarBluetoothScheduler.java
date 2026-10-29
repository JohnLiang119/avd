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
 * 把車機連線排程登錄成系統鬧鐘。
 *
 * 與廣播鬧鐘不同，這裡只維護**一個**系統鬧鐘：指向所有啟用項目中最早的下一次。
 * 觸發時接收器重算並登錄下一個，所以不必追蹤「上一輪登錄了哪些 id」。
 *
 * 用 setExactAndAllowWhileIdle 而不是 setAlarmClock：連線排程不是使用者要被「叫醒」
 * 的鬧鐘，不該佔用狀態列的鬧鐘圖示與系統的「下一個鬧鐘」。代價是 Android 12+ 不再有
 * setAlarmClock 的背景啟動豁免，但接收器只做藍牙連線，不需要啟動前景服務。
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

    /** 依目前設定重新登錄：先取消舊的，再登錄最早的下一次；沒有啟用項目就只取消。 */
    public static void reschedule(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;

        manager.cancel(pending(context, PendingIntent.FLAG_UPDATE_CURRENT));

        List<CarBluetoothSchedule.Entry> entries = new CarBluetoothStore(context).getSchedule();
        long triggerAt = CarBluetoothSchedule.earliestNextTrigger(
                entries, System.currentTimeMillis(), TimeZone.getDefault());
        if (triggerAt < 0) {
            Log.d(TAG, "no enabled schedule, alarm cancelled");
            return;
        }

        PendingIntent operation = pending(context, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
                // 精確鬧鐘被使用者關閉（API 31–32）：退而求其次，可能晚幾分鐘，總比不連好
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation);
            } else {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation);
            }
            Log.d(TAG, "next car bluetooth connect at " + triggerAt);
        } catch (SecurityException e) {
            Log.e(TAG, "cannot schedule car bluetooth alarm", e);
        }
    }

    /** 下一次連線時刻（epoch 毫秒）；沒有啟用項目為 -1。供介面顯示。 */
    public static long nextTriggerAt(Context context) {
        return CarBluetoothSchedule.earliestNextTrigger(
                new CarBluetoothStore(context).getSchedule(), System.currentTimeMillis(), TimeZone.getDefault());
    }
}
