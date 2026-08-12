package com.mattpocock.avd;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import android.os.PowerManager;
import android.net.wifi.WifiManager;
import android.content.Context;

public class KeepAliveService extends Service {
    public static final String CHANNEL_ID = "DownloadChannel";
    public static int runningTasks = 0;
    
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if ("START".equals(action)) {
                runningTasks++;
                // If it's the first task, start the foreground service
                if (runningTasks == 1) {
                    Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                            .setContentTitle("AVD Downloader")
                            .setContentText("背景下載中，請勿關閉網路...")
                            .setSmallIcon(android.R.drawable.stat_sys_download)
                            .build();
                    try {
                        startForeground(1, notification);
                        
                        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
                        if (powerManager != null) {
                            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "avd::KeepAliveWakeLock");
                            wakeLock.acquire(10 * 60 * 1000L /*10 minutes max*/);
                        }
                        
                        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                        if (wifiManager != null) {
                            wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "avd::KeepAliveWifiLock");
                            wifiLock.acquire();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            } else if ("STOP".equals(action)) {
                runningTasks--;
                if (runningTasks <= 0) {
                    if (wakeLock != null && wakeLock.isHeld()) {
                        wakeLock.release();
                        wakeLock = null;
                    }
                    if (wifiLock != null && wifiLock.isHeld()) {
                        wifiLock.release();
                        wifiLock = null;
                    }
                    stopForeground(true);
                    stopSelf();
                    runningTasks = 0;
                }
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "背景下載通知",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
}
