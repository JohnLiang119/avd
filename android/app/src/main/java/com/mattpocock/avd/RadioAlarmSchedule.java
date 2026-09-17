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
     * 給定「現在」與一個每日時刻，算出下一次該時刻的絕對時間。
     *
     * 若該時刻於今日**已經到達或剛好等於現在**，回傳次日的同一時刻 —— 鬧鐘剛響完
     * 隨即登錄下一次時正是這個情況，少了等號會在同一分鐘內再響一次。
     *
     * @param nowMillis 現在（epoch 毫秒）
     * @param time      HH:mm
     * @param zone      裝置目前時區
     * @return 下一次觸發的 epoch 毫秒；time 不合法時回傳 -1
     */
    public static long nextTrigger(long nowMillis, String time, TimeZone zone) {
        int minutes = RadioAlarmConfig.parseTimeToMinutes(time);
        if (minutes < 0) return -1L;

        Calendar cal = Calendar.getInstance(zone == null ? TimeZone.getDefault() : zone);
        cal.setTimeInMillis(nowMillis);
        cal.set(Calendar.HOUR_OF_DAY, minutes / 60);
        cal.set(Calendar.MINUTE, minutes % 60);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);

        if (cal.getTimeInMillis() <= nowMillis) {
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }
        return cal.getTimeInMillis();
    }

    /**
     * 整份設定中最早的下一次觸發；沒有任何啟用項目時回傳 -1。
     * 供介面顯示「下一次觸發時間」。
     */
    public static long earliestNextTrigger(RadioAlarmConfig config, long nowMillis, TimeZone zone) {
        long earliest = -1L;
        for (RadioAlarmConfig.Entry entry : config.enabledEntries()) {
            long at = nextTrigger(nowMillis, entry.time, zone);
            if (at < 0) continue;
            if (earliest < 0 || at < earliest) earliest = at;
        }
        return earliest;
    }
}
