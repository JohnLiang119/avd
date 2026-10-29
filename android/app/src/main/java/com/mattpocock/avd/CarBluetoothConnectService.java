package com.mattpocock.avd;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 連線排程的執行者：在一個時間區段內**持續嘗試連線車機，連到就停**（OpenSpec
 * car-bluetooth-connect）。
 *
 * 為什麼是前景服務：每次嘗試要等車機回應數秒，整段區段可能長達數十分鐘；廣播接收器
 * 的時限約 10 秒，系統對 Doze 下的重複精確鬧鐘也有約 9 分鐘的節流。前景服務（連接
 * 裝置型）是唯一能在區段內穩定重試的做法，代價是區段內有一則常駐通知（連上即消失）。
 *
 * 結束條件：連上、區段結束、使用者按通知上的「停止」、藍牙權限或車機設定消失。
 * 區段結束仍沒連上才發「車機未連線」通知（點一下開藍牙設定）。
 */
public class CarBluetoothConnectService extends Service {

    private static final String TAG = "CarBluetoothService";

    public static final String ACTION_START = "com.mattpocock.avd.CAR_BT_CONNECT_START";
    public static final String ACTION_STOP = "com.mattpocock.avd.CAR_BT_CONNECT_STOP";
    public static final String EXTRA_END_AT = "endAt";

    private static final String CHANNEL_ID = "CarBluetoothProgressChannel";
    private static final int NOTIFICATION_ID = 4104;

    /** 同一時間只跑一個迴圈；第二次 START 只負責把結束時間往後延。 */
    private static volatile boolean running = false;

    private volatile boolean stopRequested = false;
    private volatile long endAt = 0L;
    private volatile int attempts = 0;
    private Thread worker;

    public static boolean isRunning() {
        return running;
    }

    /** 啟動連線迴圈；失敗（背景啟動被拒等）只記錄，不丟例外 —— 下一個區段仍會再試。 */
    public static void start(Context context, long endAtMillis) {
        Intent intent = new Intent(context, CarBluetoothConnectService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_END_AT, endAtMillis);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            Log.e(TAG, "cannot start car bluetooth service", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopRequested = true;
            if (!running) {
                stopForeground(true);
                stopSelf();
            }
            return START_NOT_STICKY;
        }

        if (!ACTION_START.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        long requestedEnd = intent.getLongExtra(EXTRA_END_AT, 0L);

        if (running) {
            // 已在重試：只延長結束時間，不重新開始
            if (requestedEnd > endAt) endAt = requestedEnd;
            return START_NOT_STICKY;
        }

        // startForegroundService 之後必須盡快 startForeground，所以先於任何判斷
        endAt = requestedEnd;
        stopRequested = false;
        attempts = 0;
        ensureChannel();
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
        }

        final CarBluetoothStore.Device car = new CarBluetoothStore(this).get();
        if (car == null || !CarBluetooth.hasPermission(this) || endAt <= System.currentTimeMillis()) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        running = true;
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                loop(car);
            }
        }, "car-bt-connect-loop");
        worker.start();
        return START_NOT_STICKY;
    }

    private void loop(CarBluetoothStore.Device car) {
        CarBluetooth.Outcome last = CarBluetooth.Outcome.NOT_CONNECTED;
        boolean connected = false;
        try {
            while (!stopRequested && System.currentTimeMillis() < endAt) {
                attempts++;
                refreshNotification();
                long remaining = endAt - System.currentTimeMillis();
                long wait = Math.min(RadioAlarmConstants.CAR_BLUETOOTH_SCHEDULE_WAIT_MS, Math.max(1000L, remaining));
                last = CarBluetooth.connect(this, car, wait);
                Log.d(TAG, "attempt " + attempts + ": " + last);

                if (last == CarBluetooth.Outcome.CONNECTED || last == CarBluetooth.Outcome.ALREADY_CONNECTED) {
                    connected = true;
                    break;
                }
                // 權限或車機設定在迴圈中途消失：再試也沒有意義
                if (last == CarBluetooth.Outcome.NO_PERMISSION || last == CarBluetooth.Outcome.NO_DEVICE) break;

                long gap = last == CarBluetooth.Outcome.ADAPTER_OFF
                        ? RadioAlarmConstants.CAR_BLUETOOTH_ADAPTER_OFF_GAP_MS
                        : RadioAlarmConstants.CAR_BLUETOOTH_RETRY_GAP_MS;
                if (!sleep(gap)) break;
            }
        } catch (Exception e) {
            Log.e(TAG, "connect loop failed", e);
        } finally {
            running = false;
            // 區段走完（不是被使用者停止、也不是連上）仍沒連上：給一鍵入口
            boolean timedOut = !connected && !stopRequested
                    && last != CarBluetooth.Outcome.NO_PERMISSION && last != CarBluetooth.Outcome.NO_DEVICE
                    && System.currentTimeMillis() >= endAt;
            if (timedOut) {
                CarBluetooth.notifyNotConnected(this, car.name,
                        last == CarBluetooth.Outcome.ADAPTER_OFF ? last : CarBluetooth.Outcome.NOT_CONNECTED);
            }
            stopForeground(true);
            stopSelf();
        }
    }

    /** 可被「停止」打斷的睡眠；被打斷回傳 false。 */
    private boolean sleep(long millis) {
        long until = System.currentTimeMillis() + millis;
        while (System.currentTimeMillis() < until) {
            if (stopRequested) return false;
            try {
                Thread.sleep(250L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return !stopRequested;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "車機連線中", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("連線排程的時間區段內持續嘗試連線車機；連上即消失");
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent stopIntent = new Intent(this, CarBluetoothConnectService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stop = PendingIntent.getService(
                this, 0, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        CarBluetoothStore.Device car = new CarBluetoothStore(this).get();
        String until = new SimpleDateFormat("HH:mm", Locale.US).format(new Date(endAt));
        String text = "持續嘗試中，到 " + until + " 為止"
                + (attempts > 0 ? "（第 " + attempts + " 次）" : "");
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("正在連線車機" + (car == null ? "" : " " + car.name))
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_car_bluetooth)
                .setOngoing(true)
                .addAction(0, "停止", stop)
                .build();
    }

    private void refreshNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            manager.notify(NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            Log.e(TAG, "failed to update notification", e);
        }
    }

    @Override
    public void onDestroy() {
        stopRequested = true;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
