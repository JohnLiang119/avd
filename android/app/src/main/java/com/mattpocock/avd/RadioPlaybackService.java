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
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 中廣新聞網的播放服務。
 *
 * **這是唯一的播放入口**：鬧鐘觸發、試播、手動直播三者都走這裡，共用同一套來源
 * 解析、重試與通知。分成多條路徑是本功能最糟的失敗模式 —— 試播成功讓人放心，
 * 早上卻不會響。
 *
 * 三種模式只在兩件事上不同（見 {@link #MODE_ALARM} 等的說明）：
 *
 * <pre>
 *   模式    音訊語意        失敗的處理
 *   alarm   鬧鐘音量        發通知 + 留給錯誤紀錄
 *   test    鬧鐘音量        只留紀錄（使用者正看著畫面）
 *   live    媒體音量        只留紀錄
 * </pre>
 *
 * 鬧鐘與試播採 USAGE_ALARM：走系統鬧鐘音量，勿擾或靜音時仍會出聲（見 design.md D3）。
 * 手動直播採 USAGE_MEDIA —— 鬧鐘能蓋過靜音是因為使用者要求被叫醒，手動按播放
 * 並沒有這個要求（見 design.md D12）。
 *
 * 來源有直播與本地檔案兩種（design.md D15），差別是**參數**而非分岔：檔案頻道以多個
 * MediaItem 加 REPEAT_MODE_ALL 循環到時長結束、停用影像軌只解音訊、播放器出錯即失敗
 * （本機沒有「斷線重連」可言）；建播放器的地方仍只有一處。
 *
 * 股票報價頻道（design.md D16）在播放前多兩步：抓報價、文字轉語音**合成成檔**；
 * 合成出來的 wav 就當作一個本地檔案交給同一個播放器，之後的路徑與檔案頻道完全相同。
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
    /** 要播的頻道 id；缺省或找不到時落到設定的預設頻道。 */
    public static final String EXTRA_CHANNEL_ID = "channelId";
    /** 本次播放屬於哪一種：{@link #MODE_ALARM}、{@link #MODE_TEST} 或 {@link #MODE_LIVE}。 */
    public static final String EXTRA_MODE = "mode";

    /** 鬧鐘觸發。走鬧鐘音量，失敗要發通知並留給錯誤紀錄。 */
    public static final String MODE_ALARM = "alarm";
    /**
     * 試播。**刻意與鬧鐘完全相同的音訊語意** —— 它的用途就是驗證早上會不會響，
     * 換成媒體音量就驗不到真正要驗的東西。差別只有長度與「不發失敗通知」
     * （使用者正看著畫面）。
     */
    public static final String MODE_TEST = "test";
    /**
     * 手動直播（「我現在就想聽」）。走**媒體音量**：鬧鐘之所以能蓋過靜音與勿擾，
     * 是因為使用者要求被叫醒；手動按下播放並沒有這個要求，在會議中蓋過靜音
     * 放出聲音是錯的。
     */
    public static final String MODE_LIVE = "live";

    /** 供前端查詢目前是否正在播放（介面的播放鍵據此切換為停止）。 */
    private static volatile boolean playing = false;
    private static volatile String activeMode = MODE_ALARM;
    private static volatile String activeChannelId = "";

    /** 目前播放中的頻道 id；沒在播放時為空字串。介面據此把該頻道的播放鍵換成停止。 */
    public static String activeChannelId() {
        return playing ? activeChannelId : "";
    }

    public static boolean isPlaying() {
        return playing;
    }

    /**
     * 目前播放中的是否為鬧鐘語意（鬧鐘或試播）。
     * {@link MainActivity} 據此決定音量鍵要調哪一條串流。
     */
    public static boolean isAlarmAudioActive() {
        return playing && !MODE_LIVE.equals(activeMode);
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
    private String mode = MODE_ALARM;
    private RadioAlarmConfig.Channel channel;
    private boolean everReady = false;
    /** 本次播的是否為本機檔案（決定循環、影像軌、出錯的處理）。 */
    private boolean localPlayback = false;
    /** 檔案頻道中被跳過的檔案數；上次結果要載明，使用者才知道少了東西。 */
    private int missingFiles = 0;
    /**
     * 股票報價全部取不到：仍會念出原因（鬧鐘要響），但這次的結果要記為失敗，
     * 而不是 stopAtEnd 的「播放完成」。
     */
    private String stockFailureMessage = null;

    private final Runnable stopAtEnd = new Runnable() {
        @Override
        public void run() {
            Log.d(TAG, "planned end reached");
            // 只有鬧鐘的結果才記進「上次播放」—— 試播與手動直播不是鬧鐘的成敗
            if (stockFailureMessage != null) {
                // 有響、但念的是「取不到股價」：以失敗記錄，使用者下次開 App 才看得到原因
                store.recordFailure(System.currentTimeMillis(), stockFailureMessage);
            } else if (MODE_ALARM.equals(mode)) {
                store.recordSuccess(System.currentTimeMillis(), "播放完成" + missingFilesSuffix());
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
            if (stockFailureMessage != null && everReady) {
                store.recordFailure(System.currentTimeMillis(), stockFailureMessage);
            } else if (MODE_ALARM.equals(mode) && everReady) {
                store.recordSuccess(System.currentTimeMillis(), "使用者停止播放" + missingFilesSuffix());
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
        String requestedMode = intent.getStringExtra(EXTRA_MODE);
        if (requestedMode == null) requestedMode = MODE_ALARM;

        if (player != null) {
            // 已在播放：第二筆時間到達時 MUST NOT 中斷或重頭開始，只把結束時間延後到
            // 兩者中較晚者（規格的「兩筆時間的播放重疊」情境）。頻道維持第一筆的，
            // 不中途切換 —— 切換等於重頭開始。
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
        mode = requestedMode;
        activeMode = requestedMode;
        channel = store.getConfig().channelById(intent.getStringExtra(EXTRA_CHANNEL_ID));
        activeChannelId = channel.id;
        everReady = false;
        localPlayback = false;
        missingFiles = 0;
        stockFailureMessage = null;

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

        if (channel.isStock()) {
            beginStockReport();
            return;
        }

        // 來源解析會碰網路（直播）或檔案系統（檔案），不可在主執行緒；解析完回到主執行緒建立播放器。
        new Thread(new Runnable() {
            @Override
            public void run() {
                final RadioStreamResolver.Resolution resolution = RadioStreamResolver.resolve(store, channel);
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        preparePlayer(resolution);
                    }
                });
            }
        }, "radio-alarm-resolve").start();
    }

    /**
     * 股票報價頻道：抓報價（網路，背景執行緒）→ 組稿 → 文字轉語音合成成 wav（引擎回呼）
     * → 當作本地檔案交給 preparePlayer。三步任一步在 playing 已為 false 時即放棄。
     */
    private void beginStockReport() {
        final RadioAlarmConfig config = store.getConfig();
        new Thread(new Runnable() {
            @Override
            public void run() {
                final List<FugleQuoteClient.StockQuote> quotes =
                        FugleQuoteClient.fetchAll(channel.stocks, config.fugleApiKey);
                final List<String> sentences = StockReportScript.buildSentences(quotes);
                final String failure = StockReportScript.allFailed(quotes)
                        ? StockReportScript.describeFailures(quotes) : null;

                // 停頓用靜音檔實作（引擎對句號的停頓不可控）；兩個秒數都是頻道的設定：
                // 股票之間一個、念完最後一支回到第一支前一個。在這條背景執行緒先寫好，
                // 合成完直接夾進播放清單。
                final File ttsDir = new File(getCacheDir(), RadioAlarmConstants.TTS_CACHE_DIR_NAME);
                File silenceFile = null;
                File roundSilenceFile = null;
                String silenceError = null;
                try {
                    silenceFile = SilenceWav.write(
                            new File(ttsDir, "pause_" + Math.round(channel.pauseSeconds * 10) + ".wav"),
                            channel.pauseSeconds);
                    roundSilenceFile = SilenceWav.write(
                            new File(ttsDir, "pause_" + Math.round(channel.roundPauseSeconds * 10) + ".wav"),
                            channel.roundPauseSeconds);
                } catch (Exception e) {
                    silenceError = e.getMessage();
                }
                final File silence = silenceFile;
                final File roundSilence = roundSilenceFile;
                final String silenceFailure = silenceError;

                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (silenceFailure != null) {
                            fail("無法建立停頓用的靜音檔：" + silenceFailure);
                            return;
                        }
                        synthesizeAndPlay(sentences, ttsDir, silence, roundSilence, failure);
                    }
                });
            }
        }, "radio-alarm-stock").start();
    }

    /**
     * 合成每一句，再把「句、停頓、句、停頓…、最後一句、下一輪停頓」串成播放清單。
     * 兩種停頓各自可調（使用者要求）：股票之間用 silence，最後一支之後用 roundSilence，
     * 循環回第一支時聽到的就是「下一輪停頓」。
     */
    private void synthesizeAndPlay(final List<String> sentences, File ttsDir, final File silence,
                                   final File roundSilence, String failure) {
        if (!playing) return;
        stockFailureMessage = failure;
        Log.d(TAG, "stock report: " + sentences);

        RadioAlarmConfig cfg = store.getConfig();
        RadioTts.synthesizeAll(this, sentences, ttsDir, cfg.ttsVoice, cfg.ttsSpeechRate, new RadioTts.Callback() {
            @Override
            public void onDone(final List<File> files) {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        List<String> sources = new ArrayList<String>();
                        for (int i = 0; i < files.size(); i++) {
                            sources.add(files.get(i).getAbsolutePath());
                            File gap = (i == files.size() - 1) ? roundSilence : silence;
                            if (gap != null) sources.add(gap.getAbsolutePath());
                        }
                        preparePlayer(new RadioStreamResolver.Resolution(sources, true, 0));
                    }
                });
            }

            @Override
            public void onError(final String message) {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        fail("文字轉語音失敗：" + message);
                    }
                });
            }
        });
    }

    private void preparePlayer(RadioStreamResolver.Resolution resolution) {
        if (!playing) return; // 解析期間已被停止

        localPlayback = resolution.local;
        missingFiles = resolution.missingCount;

        if (resolution.isEmpty()) {
            // 檔案頻道讀不到就是失敗：不出聲、不退回電台（design.md D15）。
            // 直播不會走到這裡 —— 退回鏈末端一定有內建常數。
            fail(localPlayback
                    ? "頻道「" + channel.name + "」的檔案不存在或無法讀取，未播放。"
                    : "找不到可播放的來源。");
            return;
        }

        try {
            requestAudioFocus();

            player = new ExoPlayer.Builder(this).build();
            player.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(MODE_LIVE.equals(mode) ? C.USAGE_MEDIA : C.USAGE_ALARM)
                            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                            .build(),
                    false);
            // 檔案頻道：清單播畢自第一個重新開始，直到時長到達（REPEAT_MODE_ALL 由
            // 播放器自己換歌，不在 STATE_ENDED 裡手動接續）。直播維持不循環。
            player.setRepeatMode(localPlayback ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF);
            if (localPlayback) {
                // mp4 沒有 surface 也會把影像軌解碼再丟掉，6 點時 CPU 白跑整段時長；
                // 停用影像軌只解音訊。這是參數而不是換一套 RenderersFactory —— 建播放器仍只有一處。
                TrackSelectionParameters audioOnly = player.getTrackSelectionParameters()
                        .buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true)
                        .build();
                player.setTrackSelectionParameters(audioOnly);
            }
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
                        if (localPlayback) {
                            // REPEAT_MODE_ALL 下理論上不會結束；真的結束就只記錄，
                            // 本機檔案沒有「斷線」可以重連。
                            Log.w(TAG, "local playlist ended unexpectedly");
                            return;
                        }
                        // 直播不該結束；真的結束就當作斷線，重新載入。
                        Log.w(TAG, "stream ended unexpectedly, retrying");
                        retry();
                    }
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    if (localPlayback) {
                        // 本機檔案出錯（損毀、格式不支援）重試也不會好，直接依失敗流程處理。
                        fail("播放檔案失敗：" + error.getMessage());
                        return;
                    }
                    // 斷線、換網路、CDN 暫時性錯誤都會走到這裡。失敗窗未到就重試，
                    // 到了則由 giveUp 收尾 —— 早上沒有人在旁邊按重試。
                    Log.w(TAG, "player error, retrying", error);
                    retry();
                }
            });

            applyVolume();

            List<MediaItem> items = new ArrayList<MediaItem>();
            for (String source : resolution.sources) {
                Uri uri = localPlayback ? Uri.fromFile(new File(source)) : Uri.parse(source);
                items.add(MediaItem.fromUri(uri));
            }
            player.setMediaItems(items);
            player.prepare();
            player.setPlayWhenReady(true);
            Log.d(TAG, "preparing " + items.size() + " item(s), first: " + resolution.sources.get(0));
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

    /** 上次結果的補述：有檔案被跳過時使用者要知道，成功但有話要說。 */
    private String missingFilesSuffix() {
        if (!localPlayback || missingFiles <= 0) return "";
        return "（有 " + missingFiles + " 個檔案無法讀取，已跳過）";
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
        if (MODE_TEST.equals(mode)) {
            store.recordFailure(System.currentTimeMillis(), "試播失敗：" + message);
        } else if (MODE_LIVE.equals(mode)) {
            store.recordFailure(System.currentTimeMillis(), "直播失敗：" + message);
        } else {
            // 只有鬧鐘會發失敗通知：試播與手動直播時使用者正看著畫面，
            // 狀態那一行就會顯示原因，再發一則通知只是重複打擾。
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
            audioManager.requestAudioFocus(focusListener,
                    MODE_LIVE.equals(mode) ? AudioManager.STREAM_MUSIC : AudioManager.STREAM_ALARM,
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
        String state = everReady
                ? (MODE_LIVE.equals(mode) ? "直播中" : "播放中")
                : "正在連線";
        String text = state + "，預計 " + until + " 停止";

        String suffix = "";
        if (MODE_TEST.equals(mode)) suffix = "（試播）";
        else if (MODE_LIVE.equals(mode)) suffix = "（直播）";

        return new NotificationCompat.Builder(this, RadioAlarmConstants.PLAYBACK_CHANNEL_ID)
                .setContentTitle((channel == null ? "" : channel.name) + suffix)
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
