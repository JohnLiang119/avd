package com.mattpocock.avd;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

/**
 * 車機藍牙的連線排程（OpenSpec car-bluetooth-connect）：每筆為「時刻 + 星期 + 啟用」，
 * 時間一到自動盡力連線選定的車機，不播放任何東西。
 *
 * 用途是上班、下班等固定上車時間：不必等廣播鬧鐘，也不必手按磚。
 *
 * 下一次觸發的計算沿用 {@link RadioAlarmSchedule}（同一套星期遮罩與「剛響完不重複」
 * 的判斷），本類別只負責資料模型與 JSON。
 */
public final class CarBluetoothSchedule {

    /** 排程筆數上限；超出的丟棄。這不是日常會碰到的量，只防壞資料撐爆儲存。 */
    public static final int MAX_ENTRIES = 12;

    /** 一筆排程。時刻已正規化為 HH:mm，星期已正規化（空遮罩＝全選）。 */
    public static final class Entry {
        public final String id;
        public final String time;
        public final int weekdays;
        public final boolean enabled;

        public Entry(String id, String time, int weekdays, boolean enabled) {
            this.id = id;
            this.time = time;
            this.weekdays = weekdays;
            this.enabled = enabled;
        }
    }

    private CarBluetoothSchedule() {
    }

    /**
     * 解析 JSON 陣列，剔除不合法的項目：時刻錯誤、id 空白或重複。
     * 無法解析整體時回傳空清單 —— 寧可沒有排程，也不要讓壞資料使接收器崩潰。
     */
    public static List<Entry> parse(String json) {
        List<Entry> result = new ArrayList<Entry>();
        if (json == null || json.isEmpty()) return result;
        try {
            JSONArray array = new JSONArray(json);
            Set<String> seen = new HashSet<String>();
            for (int i = 0; i < array.length() && result.size() < MAX_ENTRIES; i++) {
                JSONObject o = array.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", "").trim();
                int minutes = RadioAlarmConfig.parseTimeToMinutes(o.optString("time", ""));
                if (id.isEmpty() || minutes < 0 || !seen.add(id)) continue;
                result.add(new Entry(
                        id,
                        String.format(java.util.Locale.US, "%02d:%02d", minutes / 60, minutes % 60),
                        RadioAlarmConfig.normalizeWeekdays(o.optInt("weekdays", RadioAlarmConfig.ALL_WEEKDAYS)),
                        o.optBoolean("enabled", true)));
            }
        } catch (JSONException e) {
            return new ArrayList<Entry>();
        }
        return result;
    }

    public static String toJson(List<Entry> entries) {
        JSONArray array = new JSONArray();
        try {
            for (Entry e : entries) {
                JSONObject o = new JSONObject();
                o.put("id", e.id);
                o.put("time", e.time);
                o.put("weekdays", e.weekdays);
                o.put("enabled", e.enabled);
                array.put(o);
            }
        } catch (JSONException ignored) {
            // put 的鍵與值皆為固定型別，不會發生
        }
        return array.toString();
    }

    /** 所有啟用項目中最早的下一次觸發；沒有任何啟用項目時回傳 -1。 */
    public static long earliestNextTrigger(List<Entry> entries, long nowMillis, TimeZone zone) {
        long earliest = -1L;
        for (Entry e : entries) {
            if (!e.enabled) continue;
            long at = RadioAlarmSchedule.nextTrigger(nowMillis, e.time, e.weekdays, zone);
            if (at < 0) continue;
            if (earliest < 0 || at < earliest) earliest = at;
        }
        return earliest;
    }

    public static List<Entry> empty() {
        return Collections.emptyList();
    }
}
