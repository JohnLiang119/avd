package com.mattpocock.avd;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * 車機連線排程的觸發與「會讓登錄失效的系統事件」（重開機、改時間、改時區）。
 *
 * 觸發時**先登錄下一次**再連線 —— 同廣播鬧鐘的理由：連線失敗不該讓排程從此消失。
 * 連線要等車機回應，改以 goAsync 在背景執行緒做；系統對廣播接收器的時限約 10 秒，
 * 所以排程的等待上限（{@link RadioAlarmConstants#CAR_BLUETOOTH_SCHEDULE_WAIT_MS}）
 * 刻意比手動連線短。
 */
public class CarBluetoothScheduleReceiver extends BroadcastReceiver {

    private static final String TAG = "CarBluetoothSchedule";

    @Override
    public void onReceive(final Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();

        if (CarBluetoothScheduler.ACTION_FIRE.equals(action)) {
            CarBluetoothScheduler.reschedule(context);
            connectInBackground(context.getApplicationContext());
            return;
        }

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.d(TAG, "rescheduling after " + action);
            CarBluetoothScheduler.reschedule(context);
        }
    }

    private void connectInBackground(final Context app) {
        final PendingResult result = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    CarBluetoothStore.Device car = new CarBluetoothStore(app).get();
                    if (car == null) return;
                    CarBluetooth.Outcome outcome = CarBluetooth.connect(
                            app, car, RadioAlarmConstants.CAR_BLUETOOTH_SCHEDULE_WAIT_MS);
                    Log.d(TAG, "scheduled connect: " + outcome);
                    if (outcome == CarBluetooth.Outcome.NOT_CONNECTED
                            || outcome == CarBluetooth.Outcome.ADAPTER_OFF) {
                        CarBluetooth.notifyNotConnected(app, car.name, outcome);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "scheduled connect failed", e);
                } finally {
                    result.finish();
                }
            }
        }, "car-bt-schedule").start();
    }
}
