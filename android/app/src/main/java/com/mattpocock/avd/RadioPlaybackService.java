package com.mattpocock.avd;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.OptIn;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 早報鬧鐘的播放服務。
 *
 * **這是唯一的播放入口**：正式觸發與介面上的試播都走這裡，差別只有結束時間。
 * 分成兩條路徑是本功能最糟的失敗模式 —— 試播成功讓人放心，早上卻不會響。
 *
 * 音訊屬性採 USAGE_ALARM：走系統的鬧鐘音量，勿擾或靜音時仍會出聲。改用 USAGE_MEDIA
 * 會在靜音時沒有聲音，與「鬧鐘」的預期相悖（見 design.md D3）。
 */
@OptIn(markerClass = UnstableApi.class)
public class RadioPlaybackService extends Service {

    private static final String TAG = "RadioPlaybackService";

    public static final String ACTION_START = "com.mattpocock.avd.RADIO_PLAY_START";
    public static final String ACTION_STOP = "com.mattpocock.avd.RADIO_PLAY_STOP";
    /** 設定中的音量比例已變更：播放中即時套用，不重建播放器。 */
    public static final String ACTION_SET_VOLUME = "com.mattpocock.avd.RADIO_SET_VOLUME";

    /** 預定開始時刻：失敗窗自此起算，而非自服務實際啟動起算。 */
    public static final String EXTRA_SCHEDULED_AT = "scheduledAt";
    public static final String EXTRA_END_AT = "endAt";
    /** 試播時為 true，僅影響結果的記錄方式。 */
    public static final String EXTRA_IS_TEST = "isTest";

    /** 供前端查詢目前是否正在播放（介面的試播按鈕據此切換為停止）。 */
    private static volatile boolean playing = false;

    public static boolean isPlaying() {
        return playing;
    }

    private final Handler handler = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private AudioManager audioManager;
    private AudioManager.OnAudioFocusChangeListener focusListener;

    private RadioAlarmStore store;

    private long scheduledAt = 0L;
    private long endAt = 0L;
    private boolean isTest = false;
    private boolean everReady = false;

    private final Runnable stopAtEnd = new Runnable() {
        @Override
        public void run() {
            Log.d(TAG, "planned end reached");
            if (!isTest) {
                store.recordSuccess(System.currentTimeMillis(), "播放完成");
            }
            stopEverything();
        }
    };

    /** 失敗窗：自預定開始時刻起算，播放仍未就緒即放棄。 */
    private final Runnable giveUp = new Runnable() {
        @Override
        public void run() {
            if (everReady) return;
            fail("在 " + (RadioAlarmConstants.FAILURE_WINDOW_MS / 60000)
                    + " 分鐘內無法開始播放（可能是沒有網路或串流暫時無法連線）。");
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        store = new RadioAlarmStore(this);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            if (!isTest && everReady) {
                store.recordSuccess(System.currentTimeMillis(), "使用者停止播放");
            }
            stopEverything();
            return START_NOT_STICKY;
        }

        if (ACTION_SET_VOLUME.equals(action)) {
            // 播放中變更音量比例 MUST 立即生效且不中斷播放。沒在播就什麼都不必做 ——
            // 下次播放時 preparePlayer 自然會讀到新值。
            applyVolume();
            return START_NOT_STICKY;
        }

        if (!ACTION_START.equals(action)) {
            stopEverything();
            return START_NOT_STICKY;
        }

        long requestedEnd = intent.getLongExtra(EXTRA_END_AT, 0L);
        long requestedScheduled = intent.getLongExtra(EXTRA_SCHEDULED_AT, System.currentTimeMillis());
        boolean requestedTest = intent.getBooleanExtra(EXTRA_IS_TEST, false);

        if (player != null) {
            // 已在播放：第二筆時間到達時 MUST NOT 中斷或重頭開始，只把結束時間延後到
            // 兩者中較晚者（規格的「兩筆時間的播放重疊」情境）。
            if (requestedEnd > endAt) {
                endAt = requestedEnd;
                handler.removeCallbacks(stopAtEnd);
                handler.postDelayed(stopAtEnd, Math.max(0L, endAt - System.currentTimeMillis()));
                updateNotification();
                Log.d(TAG, "extended end time to " + endAt);
            }
            return START_NOT_STICKY;
        }

        scheduledAt = requestedScheduled;
        endAt = requestedEnd;
        isTest = requestedTest;
        everReady = false;

        startForegroundWithNotification();
        acquireLocks();
        beginPlayback();
        return START_NOT_STICKY;
    }

    // ---- 播放 ----

    private void beginPlayback() {
        playing = true;
        // 讓開著的畫面把音量鍵切到鬧鐘音量上（見 design.md D11）
        MainActivity.notifyPlaybackStateChanged();

        long deadline = scheduledAt + RadioAlarmConstants.FAILURE_WINDOW_MS;
        handler.postDelayed(giveUp, Math.max(1000L, deadline - System.currentTimeMillis()));
        handler.postDelayed(stopAtEnd, Math.max(1000L, endAt - System.currentTimeMillis()));

        // 來源解析會碰網路，不可在主執行緒；解析完回到主執行緒建立播放器。
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String url = RadioStreamResolver.resolve(store);
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        preparePlayer(url);
                    }
                });
            }
        }, "radio-alarm-resolve").start();
    }

    private void preparePlayer(String url) {
        if (!playing) return; // 解析期間已被停止

        try {
            requestAudioFocus();

            player = new ExoPlayer.Builder(this).build();
            player.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(C.USAGE_ALARM)
                            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                            .build(),
                    false);
            player.setRepeatMode(Player.REPEAT_MODE_OFF);
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY && !everReady) {
                        everReady = true;
                        handler.removeCallbacks(giveUp);
                        Log.d(TAG, "playback ready");
                        updateNotification();
                    }
                    if (state == Player.STATE_ENDED) {
                        // 直播不該結束；真的結束就當作斷線，重新載入。
                        Log.w(TAG, "stream ended unexpectedly, retrying");
                        retry();
                    }
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    // 斷線、換網路、CDN 暫時性錯誤都會走到這裡。失敗窗未到就重試，
                    // 到了則由 giveUp 收尾 —— 早上沒有人在旁邊按重試。
                    Log.w(TAG, "player error, retrying", error);
                    retry();
                }
            });

            applyVolume();

            player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
            player.prepare();
            player.setPlayWhenReady(true);
            Log.d(TAG, "preparing " + url);
        } catch (Exception e) {
            fail("建立播放器失敗：" + e);
        }
    }

    /**
     * 套用設定中的音量比例。
     *
     * 這是**在系統鬧鐘音量之下**的縮放（`Player.setVolume`），不動裝置的鬧鐘音量設定 ——
     * 改後者會連使用者真正的鬧鐘一起改掉（見 design.md D11）。
     */
    private void applyVolume() {
        if (player == null) return;
        try {
            float gain = store.getConfig().volumeGain();
            player.setVolume(gain);
            Log.d(TAG, "volume gain applied: " + gain);
        } catch (Exception e) {
            Log.e(TAG, "failed to apply volume", e);
        }
    }

    private void retry() {
        if (!playing || player == null) return;
        if (System.currentTimeMillis() > scheduledAt + RadioAlarmConstants.FAILURE_WINDOW_MS && !everReady) {
            return; // 交給 giveUp 處理
        }
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!playing || player == null) return;
                player.prepare();
                player.setPlayWhenReady(true);
            }
        }, 3000L);
    }

    private void fail(String message) {
        Log.e(TAG, "playback failed: " + message);
        if (isTest) {
            store.recordFailure(System.currentTimeMillis(), "試播失敗：" + message);
        } else {
            store.recordFailure(System.currentTimeMillis(), message);
            showFailureNotification(message);
        }
        stopEverything();
    }

    private void stopEverything() {
        playing = false;
        // 還原音量鍵原本的行為，否則 App 平常的音量鍵會一直停在鬧鐘音量上
        MainActivity.notifyPlaybackStateChanged();
        handler.removeCallbacks(stopAtEnd);
        handler.removeCallbacks(giveUp);

        if (player != null) {
            try {
                player.stop();
                player.release();
            } catch (Exception e) {
                Log.e(TAG, "failed to release player", e);
            }
            player = null;
        }

        abandonAudioFocus();
        releaseLocks();
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        playing = false;
        handler.removeCallbacks(stopAtEnd);
        handler.removeCallbacks(giveUp);
        if (player != null) {
            player.release();
            player = null;
        }
        abandonAudioFocus();
        releaseLocks();
        super.onDestroy();
    }

    // ---- 音訊焦點 ----

    private void requestAudioFocus() {
        if (audioManager == null) return;
        focusListener = new AudioManager.OnAudioFocusChangeListener() {
            @Override
            public void onAudioFocusChange(int change) {
                // 鬧鐘刻意不因為失去焦點而停止：來電等情況由系統自行處理音量，
                // 而使用者要的是「早上被叫醒」，不是「被別的 App 靜音」。
                Log.d(TAG, "audio focus changed: " + change);
            }
        };
        try {
            audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_ALARM,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        } catch (Exception e) {
            Log.e(TAG, "failed to request audio focus", e);
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null || focusListener == null) return;
        try {
            audioManager.abandonAudioFocus(focusListener);
        } catch (Exception e) {
            Log.e(TAG, "failed to abandon audio focus", e);
        }
        focusListener = null;
    }

    // ---- 喚醒鎖 ----

    private void acquireLocks() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "avd::RadioAlarmWakeLock");
                // 上限取「到結束時間為止再加五分鐘」，避免程式出錯時鎖住 CPU 不放
                long timeout = Math.max(60_000L, endAt - System.currentTimeMillis() + 5 * 60_000L);
                wakeLock.acquire(timeout);
            }
            WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "avd::RadioAlarmWifiLock");
                wifiLock.acquire();
            }
        } catch (Exception e) {
            Log.e(TAG, "failed to acquire locks", e);
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception e) {
            Log.e(TAG, "failed to release wake lock", e);
        }
        wakeLock = null;
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception e) {
            Log.e(TAG, "failed to release wifi lock", e);
        }
        wifiLock = null;
    }

    // ---- 通知 ----

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel playback = new NotificationChannel(
                RadioAlarmConstants.PLAYBACK_CHANNEL_ID, "早報鬧鐘播放", NotificationManager.IMPORTANCE_LOW);
        playback.setDescription("播放進行中的持續性通知，含停止按鈕");
        manager.createNotificationChannel(playback);

        NotificationChannel failure = new NotificationChannel(
                RadioAlarmConstants.FAILURE_CHANNEL_ID, "早報鬧鐘失敗", NotificationManager.IMPORTANCE_DEFAULT);
        failure.setDescription("播放無法開始時的說明");
        manager.createNotificationChannel(failure);
    }

    private void startForegroundWithNotification() {
        try {
            startForeground(RadioAlarmConstants.PLAYBACK_NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
        }
    }

    private void updateNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            manager.notify(RadioAlarmConstants.PLAYBACK_NOTIFICATION_ID, buildNotification());
        } catch (Exception e) {
            Log.e(TAG, "failed to update notification", e);
        }
    }

    private Notification buildNotification() {
        Intent stopIntent = new Intent(this, RadioPlaybackService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this, 0, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String until = new SimpleDateFormat("HH:mm", Locale.US).format(new Date(endAt));
        String text = everReady
                ? "播放中，預計 " + until + " 停止"
                : "正在連線，預計 " + until + " 停止";

        return new NotificationCompat.Builder(this, RadioAlarmConstants.PLAYBACK_CHANNEL_ID)
                .setContentTitle(RadioAlarmConstants.STATION_LABEL + (isTest ? "（試播）" : ""))
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentIntent(RadioAlarmScheduler.buildShowIntent(this))
                .setOngoing(true)
                .addAction(0, "停止", stopPending)
                .build();
    }

    private void showFailureNotification(String message) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            Notification notification = new NotificationCompat.Builder(this, RadioAlarmConstants.FAILURE_CHANNEL_ID)
                    .setContentTitle("早報鬧鐘未能播放")
                    .setContentText(message)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                    .setSmallIcon(android.R.drawable.stat_notify_error)
                    .setContentIntent(RadioAlarmScheduler.buildShowIntent(this))
                    .setAutoCancel(true)
                    .build();
            manager.notify(RadioAlarmConstants.FAILURE_NOTIFICATION_ID, notification);
        } catch (Exception e) {
            Log.e(TAG, "failed to show failure notification", e);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
