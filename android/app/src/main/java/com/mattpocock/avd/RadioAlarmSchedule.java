package com.mattpocock.avd;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * 「下一次觸發是什麼時候」的計算。
 *
 * 抽成純函式的理由：這是整個鬧鐘唯一會**靜默算錯**的地方 —— 算錯一天不會有例外、
 * 不會有紅字，只會在早上沒有響。故它不依賴任何 Android API，可被 JUnit 直接釘住。
 *
 * 實作用 {@link Calendar} 而非 java.time：本專案 minSdk 為 24，而 java.time 需要
 * API 26，在未啟用 core library desugaring 的情況下會在 API 24／25 的裝置上直接
 * 崩潰。Calendar 自 API 1 起可用，且同樣能在 JVM 上測試。
 */
public final class RadioAlarmSchedule {

    private RadioAlarmSchedule() {
    }

    /**
     * 每天觸發的簡化版：等同 {@link #nextTrigger(long, String, int, TimeZone)} 帶全選星期。
     */
    public static long nextTrigger(long nowMillis, String time, TimeZone zone) {
        return nextTrigger(nowMillis, time, RadioAlarmConfig.ALL_WEEKDAYS, zone);
    }

    /**
     * 給定「現在」、一個每日時刻與星期遮罩，算出下一次觸發的絕對時間。
     *
     * 自今天起往後最多找 7 天，取第一個「時刻尚未到達且星期符合」者。今天的時刻
     * **已經到達或剛好等於現在**即不算 —— 鬧鐘剛響完隨即登錄下一次時正是這個情況，
     * 少了等號會在同一分鐘內再響一次。
     *
     * @param nowMillis 現在（epoch 毫秒）
     * @param time      HH:mm
     * @param weekdays  星期遮罩（bit 0 = 週日 … bit 6 = 週六）；空遮罩視為全選
     * @param zone      裝置目前時區
     * @return 下一次觸發的 epoch 毫秒；time 不合法時回傳 -1
     */
    public static long nextTrigger(long nowMillis, String time, int weekdays, TimeZone zone) {
        int minutes = RadioAlarmConfig.parseTimeToMinutes(time);
        if (minutes < 0) return -1L;
        int mask = RadioAlarmConfig.normalizeWeekdays(weekdays);

        // d = 0 是今天；d = 7 涵蓋「只選週一、今天週一但時刻已過 → 下週一」
        for (int d = 0; d <= 7; d++) {
            Calendar cal = Calendar.getInstance(zone == null ? TimeZone.getDefault() : zone);
            cal.setTimeInMillis(nowMillis);
            cal.set(Calendar.HOUR_OF_DAY, minutes / 60);
            cal.set(Calendar.MINUTE, minutes % 60);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            cal.add(Calendar.DAY_OF_MONTH, d);

            if (cal.getTimeInMillis() <= nowMillis) continue;
            int dayIndex = cal.get(Calendar.DAY_OF_WEEK) - 1;
            if (RadioAlarmConfig.hasWeekday(mask, dayIndex)) {
                return cal.getTimeInMillis();
            }
        }
        return -1L;
    }

    /**
     * 整份設定中最早的下一次觸發；沒有任何啟用鬧鐘時回傳 -1。
     */
    public static long earliestNextTrigger(RadioAlarmConfig config, long nowMillis, TimeZone zone) {
        long earliest = -1L;
        for (RadioAlarmConfig.Alarm alarm : config.enabledAlarms()) {
            long at = nextTrigger(nowMillis, alarm.time, alarm.weekdays, zone);
            if (at < 0) continue;
            if (earliest < 0 || at < earliest) earliest = at;
        }
        return earliest;
    }
}
