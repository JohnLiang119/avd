package com.mattpocock.avd;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.Calendar;

/**
 * 車機藍牙的連線排程（OpenSpec car-bluetooth-connect）：每筆是一個**時間區段**
 * 「開始～結束 + 星期 + 啟用」。區段開始時開始嘗試連線車機，**區段內持續重試，
 * 連到就停**；區段結束仍沒連上才放棄並通知。不播放任何東西。
 *
 * 用途是上班、下班等「大約幾點上車」的情境：不必抓準時間，也不必手按磚。
 *
 * 區段的星期以**開始日**為準；結束時刻早於或等於開始時刻視為跨午夜（隔天結束）。
 * 開始時刻的下一次計算沿用 {@link RadioAlarmSchedule}。
 */
public final class CarBluetoothSchedule {

    /** 排程筆數上限；超出的丟棄。這不是日常會碰到的量，只防壞資料撐爆儲存。 */
    public static final int MAX_ENTRIES = 12;

    /** 結束時刻缺漏或不合法時，區段預設長度（分鐘）。 */
    public static final int DEFAULT_WINDOW_MIN = 30;

    /** 一筆排程。時刻已正規化為 HH:mm，星期已正規化（空遮罩＝全選）。 */
    public static final class Entry {
        public final String id;
        /** 區段開始。 */
        public final String time;
        /** 區段結束；早於或等於開始表示跨午夜。 */
        public final String endTime;
        public final int weekdays;
        public final boolean enabled;

        public Entry(String id, String time, String endTime, int weekdays, boolean enabled) {
            this.id = id;
            this.time = time;
            this.endTime = endTime;
            this.weekdays = weekdays;
            this.enabled = enabled;
        }

        /** 區段長度（分鐘）：1–1440。開始與結束相同視為整整 24 小時以外的非法值，由 parse 補預設長度。 */
        public int durationMinutes() {
            int start = RadioAlarmConfig.parseTimeToMinutes(time);
            int end = RadioAlarmConfig.parseTimeToMinutes(endTime);
            if (start < 0 || end < 0) return DEFAULT_WINDOW_MIN;
            int diff = (end - start + 1440) % 1440;
            return diff == 0 ? DEFAULT_WINDOW_MIN : diff;
        }
    }

    private CarBluetoothSchedule() {
    }

    private static String format(int minutesOfDay) {
        int m = ((minutesOfDay % 1440) + 1440) % 1440;
        return String.format(Locale.US, "%02d:%02d", m / 60, m % 60);
    }

    /**
     * 解析 JSON 陣列，剔除不合法的項目：開始時刻錯誤、id 空白或重複。
     * 結束時刻缺漏、不合法或與開始相同時，補上開始後 {@value #DEFAULT_WINDOW_MIN} 分鐘
     * （同時相容只有單一時刻的舊資料）。
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
                int start = RadioAlarmConfig.parseTimeToMinutes(o.optString("time", ""));
                if (id.isEmpty() || start < 0 || !seen.add(id)) continue;

                int end = RadioAlarmConfig.parseTimeToMinutes(o.optString("endTime", ""));
                if (end < 0 || end == start) end = start + DEFAULT_WINDOW_MIN;

                result.add(new Entry(
                        id,
                        format(start),
                        format(end),
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
                o.put("endTime", e.endTime);
                o.put("weekdays", e.weekdays);
                o.put("enabled", e.enabled);
                array.put(o);
            }
        } catch (JSONException ignored) {
            // put 的鍵與值皆為固定型別，不會發生
        }
        return array.toString();
    }

    /** 所有啟用項目中，最早的下一次**區段開始**；沒有任何啟用項目時回傳 -1。 */
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

    /**
     * 現在是否落在某個啟用的區段內；是的話回傳**最晚的結束時刻**（epoch 毫秒），否則 -1。
     *
     * 只看「今天開始」與「昨天開始」兩種區段（跨午夜的區段可能是昨天開始的）。
     * 區段含開始、不含結束：到了結束時刻即不再算。
     */
    public static long activeWindowEnd(List<Entry> entries, long nowMillis, TimeZone zone) {
        TimeZone tz = zone == null ? TimeZone.getDefault() : zone;
        long latest = -1L;
        for (Entry e : entries) {
            if (!e.enabled) continue;
            int start = RadioAlarmConfig.parseTimeToMinutes(e.time);
            if (start < 0) continue;
            for (int d = 0; d >= -1; d--) {
                Calendar cal = Calendar.getInstance(tz);
                cal.setTimeInMillis(nowMillis);
                cal.add(Calendar.DAY_OF_MONTH, d);
                cal.set(Calendar.HOUR_OF_DAY, start / 60);
                cal.set(Calendar.MINUTE, start % 60);
                cal.set(Calendar.SECOND, 0);
                cal.set(Calendar.MILLISECOND, 0);
                if (!RadioAlarmConfig.hasWeekday(e.weekdays, cal.get(Calendar.DAY_OF_WEEK) - 1)) continue;
                long startMs = cal.getTimeInMillis();
                long endMs = startMs + e.durationMinutes() * 60000L;
                if (startMs <= nowMillis && nowMillis < endMs && endMs > latest) latest = endMs;
            }
        }
        return latest;
    }
}
