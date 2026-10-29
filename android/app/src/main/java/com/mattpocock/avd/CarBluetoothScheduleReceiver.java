package com.mattpocock.avd;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 連線排程的區段開始，以及「會讓登錄失效的系統事件」（重開機、改時間、改時區）。
 *
 * 區段開始時**先登錄下一次**再啟動連線服務 —— 同廣播鬧鐘的理由：連線失敗不該讓排程
 * 從此消失。接收器自己不連線（時限約 10 秒），重試迴圈在
 * {@link CarBluetoothConnectService}。
 */
public class CarBluetoothScheduleReceiver extends BroadcastReceiver {

    private static final String TAG = "CarBluetoothSchedule";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();

        if (CarBluetoothScheduler.ACTION_FIRE.equals(action)) {
            // 登錄下一次；此處不要求「已在區段內就立刻開始」，下面自己啟動
            CarBluetoothScheduler.reschedule(context, false);
            long now = System.currentTimeMillis();
            long end = CarBluetoothSchedule.activeWindowEnd(
                    new CarBluetoothStore(context).getSchedule(), now, java.util.TimeZone.getDefault());
            if (end > 0 && new CarBluetoothStore(context).get() != null) {
                CarBluetoothConnectService.start(context.getApplicationContext(), end);
            } else {
                Log.d(TAG, "window fired but no active window or no car selected");
            }
            return;
        }

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.d(TAG, "rescheduling after " + action);
            CarBluetoothScheduler.reschedule(context, true);
        }
    }
}
