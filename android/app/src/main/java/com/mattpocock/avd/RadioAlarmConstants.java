package com.mattpocock.avd;

/**
 * 早報鬧鐘的固定值。
 *
 * 集中於此的理由與 {@link YoutubeDlPlugin#NETWORK_PROBE_URL} 相同：這些值會在
 * 排程、播放服務、解析器三處被引用，散落各處就會出現「改了一半」的版本。
 * 每個對外端點都附上來源與**實測確認日期** —— 串流位址不是規格，是外部現況，
 * 日後對不上時要能一眼看出這份值是什麼時候確認的。
 *
 * 本類別不匯入任何 Android API，可直接被 JVM 單元測試引用。
 */
public final class RadioAlarmConstants {

    private RadioAlarmConstants() {
    }

    /**
     * 中廣官方播放頁（http://www.bcc.com.tw/stream.html?c=2）以 jQuery 取用的頻道資訊端點，
     * 回傳五個頻道的目前串流位址與節目資訊。2026-09-17 實測可用。
     *
     * 之所以每次觸發都問它、而不是寫死串流位址：實測社群資料庫記載的串流 key 與官方
     * 現行值已經不同，代表 key 會輪替。寫死等於某天早上無聲無息地不響。
     */
    public static final String CHANNEL_INFO_URL =
            "https://www.bcc.com.tw/webapi/BCCRadioWebAPI/ChannelInfoBat";

    // ---- 內建頻道 ----
    //
    // id 是持久化用的穩定識別（設定檔與 last_good_url 的鍵都用它），apiName 是官方
    // 回應中 name 欄位的值。兩者分開：官方若改名，只需改 apiName，使用者的設定不受影響。

    public static final String CHANNEL_NEWS_ID = "bcc-news";
    public static final String CHANNEL_NEWS_API_NAME = "中廣新聞網";

    public static final String CHANNEL_POP_ID = "bcc-pop";
    public static final String CHANNEL_POP_API_NAME = "中廣流行網";

    /** 舊格式的 customStreamUrl 遷移後所建立的自訂頻道 id。 */
    public static final String LEGACY_CUSTOM_CHANNEL_ID = "custom-legacy";

    /**
     * 本地檔案頻道副本的根目錄名稱（位於 filesDir 之下）。
     *
     * 選檔後一律複製到這裡再播（design.md D15）：私有目錄不需權限、不受使用者整理
     * 檔案影響，是「6 點時檔案讀不到」唯一可靠的解法。設定中的 file 頻道路徑 MUST
     * 全部落在此目錄之下，否則剔除。
     */
    public static final String LOCAL_FILES_DIR_NAME = "radio_alarm";

    /** 股票報價頻道合成的語音檔所在的快取子目錄（design.md D16）。每次觸發覆寫同一個檔。 */
    public static final String TTS_CACHE_DIR_NAME = "radio_alarm_tts";

    /**
     * 股票報價頻道句與句之間的停頓（秒）：預設與允許範圍。使用者要求可調 ——
     * 語音引擎對句號的停頓不可控，故以靜音檔實作（見 SilenceWav）。
     */
    public static final double DEFAULT_STOCK_PAUSE_SECONDS = 1.0;
    public static final double MIN_STOCK_PAUSE_SECONDS = 1.0;
    public static final double MAX_STOCK_PAUSE_SECONDS = 600.0;

    /**
     * 退回鏈末端的內建串流位址。2026-09-17 自官方端點取得，新聞網以 curl 實測可讀到 ADTS AAC 音訊。
     *
     * 這是**最後**一道退回，不是首選：官方端點與上次成功的位址都取不到時才會用到它。
     */
    public static final String FALLBACK_STREAM_URL_NEWS =
            "https://stream.rcs.revma.com/fgtx07f3qtzuv";
    public static final String FALLBACK_STREAM_URL_POP =
            "https://stream.rcs.revma.com/s1zttsg3qtzuv";

    /** 依頻道 id 取內建退回位址；未知的 id 落到新聞網 —— 退回鏈末端必須有東西。 */
    public static String fallbackStreamUrlFor(String channelId) {
        if (CHANNEL_POP_ID.equals(channelId)) return FALLBACK_STREAM_URL_POP;
        return FALLBACK_STREAM_URL_NEWS;
    }

    /** 查詢官方端點的連線與讀取逾時（毫秒）。逾時即退回，使用者不該為了查詢而等待。 */
    public static final int API_TIMEOUT_MS = 5000;

    /**
     * 自「預定開始時刻」起算，播放仍未就緒即放棄的窗口（毫秒）。
     *
     * 早上六點沒有人在旁邊按重試，所以要自己重試；但也不能無限重試到中午還在放，
     * 故設一個窗口，逾時就停止並留下可事後閱讀的失敗紀錄。
     */
    public static final long FAILURE_WINDOW_MS = 3 * 60 * 1000L;

    /** 試播長度（毫秒）。試播走與正式觸發完全相同的路徑，只有結束時間不同。 */
    public static final long TEST_PLAY_MS = 30 * 1000L;

    /**
     * 手動直播的長度上限（毫秒）。
     *
     * 「聽到我按停止為止」的正確實作**不是**無限：忘了關的前景服務會一直持有
     * WakeLock 與 WifiLock 放整天。設一個足夠長但有限的上限，通知上寫明預計
     * 停止時間，使用者要續聽再按一次即可。
     */
    public static final long LIVE_MAX_MS = 3 * 60 * 60 * 1000L;

    /** 播放時長的預設值與允許範圍（分鐘）。 */
    public static final int DEFAULT_DURATION_MIN = 30;
    public static final int MIN_DURATION_MIN = 1;
    public static final int MAX_DURATION_MIN = 180;

    /**
     * 應用程式內音量比例的預設值與允許範圍（%）。
     *
     * 這是**在系統鬧鐘音量之下**的縮放，預設 100% 即「完全照系統鬧鐘音量」——
     * 不加這個設定時的行為，故升級的使用者聽到的音量不會改變。
     */
    public static final int DEFAULT_VOLUME_PERCENT = 100;
    public static final int MIN_VOLUME_PERCENT = 0;
    public static final int MAX_VOLUME_PERCENT = 100;

    /**
     * 首次開啟總開關且清單為空時預填的時間。
     * 06:00 為《早安新聞》、07:00 為《中廣早報新聞》。
     */
    public static final String[] DEFAULT_TIMES = {"06:00", "07:00"};

    /** 播放通知的頻道 id 與通知 id。MUST 與下載用的 DownloadChannel／id 1 分開，否則兩者會互相覆蓋。 */
    public static final String PLAYBACK_CHANNEL_ID = "RadioAlarmChannel";
    public static final int PLAYBACK_NOTIFICATION_ID = 4101;

    /** 失敗通知的頻道 id 與通知 id（一般通知，非前景服務通知）。 */
    public static final String FAILURE_CHANNEL_ID = "RadioAlarmFailureChannel";
    public static final int FAILURE_NOTIFICATION_ID = 4102;

    /** 寫入錯誤紀錄時使用的情境名稱（error-journal 的 context 欄位）。 */
    public static final String JOURNAL_CONTEXT = "早報鬧鐘";

    /**
     * 自我測試用的識別。
     *
     * 存在的理由：**試播證明不了早上會響** —— 它直接啟動播放服務，完全繞過
     * AlarmManager、接收器與「程序已被回收後被系統叫醒」這一整段。而那一段正是
     * 使用者唯一真正擔心的部分（「App 關掉是不是就沒用了」），卻沒有任何辦法驗證。
     *
     * 自我測試登錄一次性的真鬧鐘，走與早上完全相同的路徑，使用者可以關掉 App 再等它響。
     */
    public static final String SELF_TEST_ID = "__selftest__";

    /** 自我測試的等待時間：夠久到可以關掉 App，又不必等太久。 */
    public static final long SELF_TEST_DELAY_MS = 2 * 60 * 1000L;

    /** 自我測試響起後的播放長度。聽到聲音即達成目的，不需要播滿一首。 */
    public static final long SELF_TEST_PLAY_MS = 60 * 1000L;
}
