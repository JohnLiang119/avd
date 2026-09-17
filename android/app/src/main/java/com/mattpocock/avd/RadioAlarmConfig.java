package com.mattpocock.avd;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 早報鬧鐘的設定：總開關、每日觸發時間清單、自訂串流網址。
 *
 * 這個類別刻意**不匯入任何 Android API**（只用 org.json 與 java.util），使其可在
 * JVM 單元測試中直接驗證。鬧鐘對不對，很大一部分取決於這裡的解析與驗證守不守得住，
 * 而那一層不該只能等到早上六點才在實機上驗出來。
 *
 * 權威來源在原生端（見 config-persistence 規格的「原生端為權威來源的設定」）：
 * WebView 未執行時鬧鐘仍須響，故設定不能只存在前端的 localStorage。
 *
 * fromJson 一律**不拋例外**：它面對的是可能被外力改壞的持久化內容，而「設定壞掉」
 * 不該讓鬧鐘整組無聲無息地消失 —— 壞掉的項目會被剔除或校正，其餘維持可用。
 * 使用者輸入的把關由前端負責（會顯示拒絕的原因），這裡是防守。
 */
public final class RadioAlarmConfig {

    /** 一筆每日觸發時間。 */
    public static final class Entry {
        /** 穩定識別，用於排程與取消（時間改了也不必重配 requestCode）。 */
        public final String id;
        /** 觸發時刻，已正規化為 HH:mm。 */
        public final String time;
        public final boolean enabled;
        /** 播放時長（分鐘），必在允許範圍內。 */
        public final int durationMin;

        public Entry(String id, String time, boolean enabled, int durationMin) {
            this.id = id;
            this.time = time;
            this.enabled = enabled;
            this.durationMin = durationMin;
        }
    }

    public final boolean masterEnabled;
    public final List<Entry> entries;
    /** 空字串代表「使用官方來源」，非空則直接使用且不查官方。 */
    public final String customStreamUrl;
    /**
     * 應用程式內的音量比例（0–100）。
     *
     * 這是**在系統鬧鐘音量之下**的縮放，不是系統音量本身：改系統音量會連使用者
     * 真正的鬧鐘一起改掉，那是替他做了沒要求的決定（見 design.md D11）。
     */
    public final int volumePercent;

    public RadioAlarmConfig(boolean masterEnabled, List<Entry> entries, String customStreamUrl,
                            int volumePercent) {
        this.masterEnabled = masterEnabled;
        this.entries = Collections.unmodifiableList(new ArrayList<Entry>(entries));
        this.customStreamUrl = customStreamUrl == null ? "" : customStreamUrl;
        this.volumePercent = clampVolume(volumePercent);
    }

    /** 全新安裝的預設值：**總開關關閉**、清單為空、音量比例 100%。 */
    public static RadioAlarmConfig defaults() {
        return new RadioAlarmConfig(false, new ArrayList<Entry>(), "",
                RadioAlarmConstants.DEFAULT_VOLUME_PERCENT);
    }

    /** 播放器要套用的增益（0.0–1.0）。 */
    public float volumeGain() {
        return volumePercent / 100f;
    }

    /** 首次開啟總開關且清單為空時預填的清單（06:00 與 07:00）。 */
    public static List<Entry> defaultEntries() {
        List<Entry> list = new ArrayList<Entry>();
        for (String time : RadioAlarmConstants.DEFAULT_TIMES) {
            list.add(new Entry(newId(time), time, true, RadioAlarmConstants.DEFAULT_DURATION_MIN));
        }
        return list;
    }

    /** 實際會被排程的項目：總開關開啟時的已啟用項目。 */
    public List<Entry> enabledEntries() {
        List<Entry> list = new ArrayList<Entry>();
        if (!masterEnabled) return list;
        for (Entry e : entries) {
            if (e.enabled) list.add(e);
        }
        return list;
    }

    // ---- 時間的解析與正規化 ----

    /**
     * 將時間字串解析為「當日第幾分鐘」。
     *
     * @return 0..1439；不合法時回傳 -1（不拋例外：呼叫端多半在批次處理整份清單）
     */
    public static int parseTimeToMinutes(String raw) {
        if (raw == null) return -1;
        String text = raw.trim();
        int colon = text.indexOf(':');
        if (colon <= 0 || colon == text.length() - 1) return -1;

        String hourPart = text.substring(0, colon).trim();
        String minutePart = text.substring(colon + 1).trim();
        if (!isAsciiDigits(hourPart) || !isAsciiDigits(minutePart)) return -1;
        if (hourPart.length() > 2 || minutePart.length() > 2) return -1;

        int hour = Integer.parseInt(hourPart);
        int minute = Integer.parseInt(minutePart);
        if (hour > 23 || minute > 59) return -1;
        return hour * 60 + minute;
    }

    /** 正規化為 HH:mm；不合法時回傳 null。 */
    public static String normalizeTime(String raw) {
        int minutes = parseTimeToMinutes(raw);
        if (minutes < 0) return null;
        return String.format(Locale.US, "%02d:%02d", minutes / 60, minutes % 60);
    }

    /** 播放時長夾在允許範圍內，而非丟棄整筆 —— 時長怪不該讓一筆鬧鐘消失。 */
    public static int clampDuration(int value) {
        if (value < RadioAlarmConstants.MIN_DURATION_MIN) return RadioAlarmConstants.MIN_DURATION_MIN;
        if (value > RadioAlarmConstants.MAX_DURATION_MIN) return RadioAlarmConstants.MAX_DURATION_MIN;
        return value;
    }

    /** 音量比例夾在 0–100；與時長同樣是夾值而非丟棄，怪值不該讓整份設定失效。 */
    public static int clampVolume(int value) {
        if (value < RadioAlarmConstants.MIN_VOLUME_PERCENT) return RadioAlarmConstants.MIN_VOLUME_PERCENT;
        if (value > RadioAlarmConstants.MAX_VOLUME_PERCENT) return RadioAlarmConstants.MAX_VOLUME_PERCENT;
        return value;
    }

    /** 自訂串流網址是否可用：空字串（代表用官方）或 http(s) 網址。 */
    public static boolean isValidStreamUrl(String raw) {
        if (raw == null) return true;
        String text = raw.trim();
        if (text.isEmpty()) return true;
        return text.startsWith("http://") || text.startsWith("https://");
    }

    /** 產生一筆新項目的識別。 */
    public static String newId(String time) {
        String suffix = time == null ? "x" : time.replace(":", "");
        return "t" + System.currentTimeMillis() + "_" + suffix;
    }

    // ---- 序列化 ----

    /**
     * 自持久化內容還原。**永不拋例外**：內容為 null、空、非 JSON 或結構不符時回傳預設值；
     * 個別項目不合法時剔除該項並保留其餘。
     */
    public static RadioAlarmConfig fromJson(String json) {
        if (json == null || json.trim().isEmpty()) return defaults();

        JSONObject root;
        try {
            root = new JSONObject(json);
        } catch (JSONException e) {
            return defaults();
        }

        boolean master = root.optBoolean("masterEnabled", false);

        String custom = root.optString("customStreamUrl", "").trim();
        if (!isValidStreamUrl(custom)) custom = "";

        List<Entry> parsed = new ArrayList<Entry>();
        Set<String> seenTimes = new HashSet<String>();
        JSONArray arr = root.optJSONArray("entries");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;

                String time = normalizeTime(item.optString("time", ""));
                if (time == null) continue;
                if (!seenTimes.add(time)) continue;

                String id = item.optString("id", "").trim();
                if (id.isEmpty()) id = newId(time);

                boolean enabled = item.optBoolean("enabled", true);
                int duration = clampDuration(
                        item.optInt("durationMin", RadioAlarmConstants.DEFAULT_DURATION_MIN));

                parsed.add(new Entry(id, time, enabled, duration));
            }
        }

        int volume = clampVolume(
                root.optInt("volumePercent", RadioAlarmConstants.DEFAULT_VOLUME_PERCENT));

        return new RadioAlarmConfig(master, parsed, custom, volume);
    }

    public String toJson() {
        JSONObject root = new JSONObject();
        try {
            root.put("masterEnabled", masterEnabled);
            root.put("customStreamUrl", customStreamUrl);
            root.put("volumePercent", volumePercent);
            JSONArray arr = new JSONArray();
            for (Entry e : entries) {
                JSONObject item = new JSONObject();
                item.put("id", e.id);
                item.put("time", e.time);
                item.put("enabled", e.enabled);
                item.put("durationMin", e.durationMin);
                arr.put(item);
            }
            root.put("entries", arr);
        } catch (JSONException e) {
            // put 只在 key 為 null 或值為 NaN 時拋出，兩者於此皆不可能
            return "{}";
        }
        return root.toString();
    }

    private static boolean isAsciiDigits(String text) {
        if (text.isEmpty()) return false;
        for (int i = 0; i < text.length(); i++) {
            int c = text.charAt(i);
            if (c < 48 || c > 57) return false;
        }
        return true;
    }
}
