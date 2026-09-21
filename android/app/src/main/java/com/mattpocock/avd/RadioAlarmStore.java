package com.mattpocock.avd;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;

/**
 * 早報鬧鐘的持久化：設定本身、上次成功的串流網址，以及上次播放的結果。
 *
 * **這是本功能設定的唯一權威來源**（見 config-persistence 規格的「原生端為權威來源
 * 的設定」）。理由是硬性的：鬧鐘必須在 WebView 沒有執行時響，而前端的儲存埠
 * （localStorage／Tauri Store）此時讀不到 —— 前端因此不持有可獨立寫入的副本，
 * 每次開啟設定介面都經插件回來這裡讀。
 *
 * 使用獨立的 SharedPreferences 檔（avd_radio_alarm）而非既有的 avd_prefs：
 * 兩者的生命週期與讀取時機完全不同，混在一起只會讓「誰寫壞了誰」難以追查。
 */
public final class RadioAlarmStore {

    private static final String PREFS_NAME = "avd_radio_alarm";

    private static final String KEY_CONFIG = "config";
    private static final String KEY_LAST_GOOD_URL = "last_good_url";
    /** 已登錄鬧鐘的項目 id 清單，供 rescheduleAll 精準取消已不存在的項目。 */
    private static final String KEY_SCHEDULED_IDS = "scheduled_ids";

    /** 自我測試：已登錄的觸發時刻，以及實際響起的時刻。 */
    private static final String KEY_SELF_TEST_AT = "self_test_at";
    private static final String KEY_SELF_TEST_FIRED_AT = "self_test_fired_at";

    private static final String KEY_RESULT_TIME = "last_result_time";
    private static final String KEY_RESULT_SUCCESS = "last_result_success";
    private static final String KEY_RESULT_MESSAGE = "last_result_message";
    private static final String KEY_RESULT_PENDING = "last_result_pending_journal";

    /** 上次播放的結果，供介面顯示與延遞寫入錯誤紀錄。 */
    public static final class Result {
        /** 事件實際發生的時間（epoch 毫秒），不是寫入錯誤紀錄的時間。 */
        public final long time;
        public final boolean success;
        /** 未經截斷的訊息原文（error-journal 的要求）。 */
        public final String message;
        /** 是否仍待寫入前端的錯誤紀錄。 */
        public final boolean pendingJournal;

        public Result(long time, boolean success, String message, boolean pendingJournal) {
            this.time = time;
            this.success = success;
            this.message = message == null ? "" : message;
            this.pendingJournal = pendingJournal;
        }
    }

    private final SharedPreferences prefs;
    /** 本地檔案頻道副本的根目錄；file 頻道的路徑 MUST 落在其下，否則解析時剔除。 */
    private final String localFileRoot;

    public RadioAlarmStore(Context context) {
        Context app = context.getApplicationContext();
        this.prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.localFileRoot = RadioAlarmFiles.rootPath(app);
    }

    // ---- 設定 ----

    public RadioAlarmConfig getConfig() {
        return parseConfig(prefs.getString(KEY_CONFIG, null));
    }

    /**
     * 以本裝置的私有目錄為準解析一份設定 JSON。
     *
     * 所有「從外部進來的設定」（持久化內容、前端寫回）都 MUST 經過這裡，
     * 路徑把關才會一致地套用。
     */
    public RadioAlarmConfig parseConfig(String json) {
        return RadioAlarmConfig.fromJson(json, localFileRoot);
    }

    public void setConfig(RadioAlarmConfig config) {
        prefs.edit().putString(KEY_CONFIG, config.toJson()).apply();
    }

    // ---- 上次成功的串流網址（退回鏈的中間層），按頻道存 ----
    //
    // 新聞網的後備不能拿去放流行網，故鍵帶頻道 id。舊格式只有一個鍵（那時只有新聞網），
    // 讀新聞網且新鍵不存在時退回舊鍵，讓升級後第一次退回仍有東西可用。

    public String getLastGoodUrl(String channelId) {
        String value = prefs.getString(KEY_LAST_GOOD_URL + "." + channelId, "");
        if ((value == null || value.isEmpty()) && RadioAlarmConstants.CHANNEL_NEWS_ID.equals(channelId)) {
            value = prefs.getString(KEY_LAST_GOOD_URL, "");
        }
        return value == null ? "" : value;
    }

    public void setLastGoodUrl(String channelId, String url) {
        if (url == null || url.trim().isEmpty() || channelId == null) return;
        prefs.edit().putString(KEY_LAST_GOOD_URL + "." + channelId, url.trim()).apply();
    }

    // ---- 已登錄的鬧鐘 id ----

    public List<String> getScheduledIds() {
        List<String> ids = new ArrayList<String>();
        String raw = prefs.getString(KEY_SCHEDULED_IDS, "");
        if (raw == null || raw.trim().isEmpty()) return ids;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                String id = arr.optString(i, "");
                if (!id.isEmpty()) ids.add(id);
            }
        } catch (JSONException e) {
            // 讀不出來就當作沒有登錄過；下一輪 rescheduleAll 會重新寫入正確內容
        }
        return ids;
    }

    public void setScheduledIds(List<String> ids) {
        JSONArray arr = new JSONArray();
        for (String id : ids) {
            arr.put(id);
        }
        prefs.edit().putString(KEY_SCHEDULED_IDS, arr.toString()).apply();
    }

    // ---- 自我測試 ----
    //
    // 與設定分開存：自我測試是一次性的驗證，不該出現在使用者的時間清單裡，
    // 也不該被 rescheduleAll 連帶取消。

    /** @return 已登錄的自我測試觸發時刻；沒有登錄時回傳 -1 */
    public long getSelfTestAt() {
        return prefs.getLong(KEY_SELF_TEST_AT, -1L);
    }

    public void setSelfTestAt(long at) {
        prefs.edit().putLong(KEY_SELF_TEST_AT, at).apply();
    }

    /**
     * 自我測試實際響起的時刻；從未響過回傳 -1。
     *
     * **這一筆是本功能最有說服力的證據**：它是在使用者把 App 關掉之後才被寫入的，
     * 代表系統確實把程序叫了起來。
     */
    public long getSelfTestFiredAt() {
        return prefs.getLong(KEY_SELF_TEST_FIRED_AT, -1L);
    }

    public void recordSelfTestFired(long at) {
        prefs.edit()
                .putLong(KEY_SELF_TEST_FIRED_AT, at)
                .putLong(KEY_SELF_TEST_AT, -1L)
                .apply();
    }

    public void clearSelfTest() {
        prefs.edit().putLong(KEY_SELF_TEST_AT, -1L).apply();
    }

    // ---- 上次播放結果 ----

    /** @return 從未觸發過時回傳 null */
    public Result getLastResult() {
        long time = prefs.getLong(KEY_RESULT_TIME, 0L);
        if (time <= 0L) return null;
        return new Result(
                time,
                prefs.getBoolean(KEY_RESULT_SUCCESS, false),
                prefs.getString(KEY_RESULT_MESSAGE, ""),
                prefs.getBoolean(KEY_RESULT_PENDING, false));
    }

    public void recordSuccess(long time, String message) {
        prefs.edit()
                .putLong(KEY_RESULT_TIME, time)
                .putBoolean(KEY_RESULT_SUCCESS, true)
                .putString(KEY_RESULT_MESSAGE, message == null ? "" : message)
                .putBoolean(KEY_RESULT_PENDING, false)
                .apply();
    }

    /**
     * 記錄一次失敗，並標記為待寫入前端的錯誤紀錄。
     *
     * 不當場寫入錯誤紀錄的原因：紀錄住在 WebView 的儲存中，而失敗發生時
     * WebView 多半沒有在跑。改由前端啟動時取走（見 consumeJournal）。
     */
    public void recordFailure(long time, String message) {
        prefs.edit()
                .putLong(KEY_RESULT_TIME, time)
                .putBoolean(KEY_RESULT_SUCCESS, false)
                .putString(KEY_RESULT_MESSAGE, message == null ? "" : message)
                .putBoolean(KEY_RESULT_PENDING, true)
                .apply();
    }

    /**
     * 取走待寫入錯誤紀錄的失敗摘要並清除待寫標記。
     *
     * 清除標記是「不重複寫入」的依據 —— 規格明訂寫入後 MUST NOT 重複寫入。
     *
     * @return 待寫入的失敗結果；沒有待寫入者回傳 null
     */
    public Result consumeJournal() {
        Result result = getLastResult();
        if (result == null || !result.pendingJournal) return null;
        prefs.edit().putBoolean(KEY_RESULT_PENDING, false).apply();
        return new Result(result.time, result.success, result.message, true);
    }
}
