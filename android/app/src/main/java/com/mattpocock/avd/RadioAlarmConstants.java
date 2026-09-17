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

    /** 要在 {@link #CHANNEL_INFO_URL} 的回應中尋找的頻道名稱（須與回應的 name 欄位完全相同）。 */
    public static final String TARGET_CHANNEL_NAME = "中廣新聞網";

    /** 顯示用的電台名稱（通知與介面）。 */
    public static final String STATION_LABEL = "中廣新聞網";

    /**
     * 退回鏈末端的內建串流位址。2026-09-17 自官方端點取得並以 curl 實測可讀到 ADTS AAC 音訊。
     *
     * 這是**最後**一道退回，不是首選：官方端點與上次成功的位址都取不到時才會用到它。
     */
    public static final String FALLBACK_STREAM_URL =
            "https://stream.rcs.revma.com/fgtx07f3qtzuv";

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
}
