package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

/**
 * 「下一次觸發是什麼時候」。
 *
 * 這是整個鬧鐘唯一會靜默算錯的地方：算錯一天不會有例外、不會有紅字，
 * 只會在早上沒有響。故每個邊界都在這裡釘死，實機只剩「系統會不會照做」那一層。
 *
 * 日期基準：2026-09-17 是星期四（14 週一、17 週四、19 週六、20 週日、21 週一）。
 */
public class RadioAlarmScheduleTest {

    private static final TimeZone TAIPEI = TimeZone.getTimeZone("Asia/Taipei");
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");
    private static final int ALL = RadioAlarmConfig.ALL_WEEKDAYS;

    private static int mask(int... days) {
        int m = 0;
        for (int d : days) m |= 1 << d;
        return m;
    }

    /** 在指定時區組出一個絕對時刻，讓測試不受執行機器的預設時區影響。 */
    private static long at(TimeZone zone, int year, int month, int day, int hour, int minute, int second) {
        Calendar cal = Calendar.getInstance(zone);
        cal.clear();
        cal.set(year, month - 1, day, hour, minute, second);
        return cal.getTimeInMillis();
    }

    @Test
    public void dateBaselineIsThursday() {
        Calendar cal = Calendar.getInstance(TAIPEI);
        cal.setTimeInMillis(at(TAIPEI, 2026, 9, 17, 12, 0, 0));
        assertEquals(Calendar.THURSDAY, cal.get(Calendar.DAY_OF_WEEK));
    }

    // ---- 每天 ----

    @Test
    public void todayWhenTheTimeHasNotArrivedYet() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        assertEquals(at(TAIPEI, 2026, 9, 17, 6, 0, 0), RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TAIPEI));
    }

    @Test
    public void tomorrowWhenTheTimeHasPassed() {
        long now = at(TAIPEI, 2026, 9, 17, 6, 30, 0);
        assertEquals(at(TAIPEI, 2026, 9, 18, 6, 0, 0), RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TAIPEI));
    }

    /** 鬧鐘剛響完隨即登錄下一次，正是「現在恰好等於觸發時刻」的情況；少了等號會同一分鐘再響。 */
    @Test
    public void tomorrowWhenNowIsExactlyTheTriggerInstant() {
        long now = at(TAIPEI, 2026, 9, 17, 6, 0, 0);
        assertEquals(at(TAIPEI, 2026, 9, 18, 6, 0, 0), RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TAIPEI));
    }

    @Test
    public void handlesTheLastMinuteOfTheDay() {
        long now = at(TAIPEI, 2026, 9, 17, 23, 59, 30);
        assertEquals(at(TAIPEI, 2026, 9, 18, 23, 59, 0), RadioAlarmSchedule.nextTrigger(now, "23:59", ALL, TAIPEI));
    }

    @Test
    public void crossesTheMonthBoundary() {
        long now = at(TAIPEI, 2026, 9, 30, 7, 0, 0);
        assertEquals(at(TAIPEI, 2026, 10, 1, 6, 0, 0), RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TAIPEI));
    }

    @Test
    public void threeArgOverloadMeansEveryDay() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        assertEquals(RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TAIPEI),
                RadioAlarmSchedule.nextTrigger(now, "06:00", TAIPEI));
    }

    // ---- 星期 ----

    @Test
    public void todayWhenTodayIsSelectedAndTimeNotPassed() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0); // 週四
        assertEquals(at(TAIPEI, 2026, 9, 17, 6, 0, 0),
                RadioAlarmSchedule.nextTrigger(now, "06:00", mask(1, 2, 3, 4, 5), TAIPEI));
    }

    @Test
    public void nextSelectedDayWhenTodayIsSelectedButTimePassed() {
        long now = at(TAIPEI, 2026, 9, 17, 7, 0, 0); // 週四 07:00
        assertEquals(at(TAIPEI, 2026, 9, 18, 6, 0, 0), // 週五
                RadioAlarmSchedule.nextTrigger(now, "06:00", mask(1, 2, 3, 4, 5), TAIPEI));
    }

    @Test
    public void skipsTodayWhenTodayIsNotSelected() {
        long now = at(TAIPEI, 2026, 9, 19, 5, 0, 0); // 週六 05:00，只選一至五
        assertEquals(at(TAIPEI, 2026, 9, 21, 6, 0, 0), // 下週一
                RadioAlarmSchedule.nextTrigger(now, "06:00", mask(1, 2, 3, 4, 5), TAIPEI));
    }

    @Test
    public void weekendOnlyAlarmFromAWeekday() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0); // 週四，只選六日
        assertEquals(at(TAIPEI, 2026, 9, 19, 6, 0, 0), // 週六
                RadioAlarmSchedule.nextTrigger(now, "06:00", mask(0, 6), TAIPEI));
    }

    @Test
    public void onlyMondayFromTuesdayGoesToNextMonday() {
        long now = at(TAIPEI, 2026, 9, 15, 5, 0, 0); // 週二
        assertEquals(at(TAIPEI, 2026, 9, 21, 6, 0, 0),
                RadioAlarmSchedule.nextTrigger(now, "06:00", mask(1), TAIPEI));
    }

    /** 只選週一、今天週一但時刻已過 → 下週一。這需要往後看滿 7 天，少一天就回傳 -1。 */
    @Test
    public void onlyMondayFromMondayAfterTheTimeGoesToNextWeek() {
        long now = at(TAIPEI, 2026, 9, 14, 6, 30, 0); // 週一 06:30
        assertEquals(at(TAIPEI, 2026, 9, 21, 6, 0, 0),
                RadioAlarmSchedule.nextTrigger(now, "06:00", mask(1), TAIPEI));
    }

    @Test
    public void emptyMaskIsTreatedAsEveryDay() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        assertEquals(RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TAIPEI),
                RadioAlarmSchedule.nextTrigger(now, "06:00", 0, TAIPEI));
    }

    // ---- 時區與不合法輸入 ----

    /** 同一個絕對時刻，時區不同則「當地的 06:00」不同 —— 時區變更後 MUST 以新時區計算。 */
    @Test
    public void usesTheSuppliedTimeZone() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        long taipei = RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TAIPEI);
        long utc = RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, UTC);
        assertEquals(at(TAIPEI, 2026, 9, 17, 6, 0, 0), taipei);
        assertEquals(at(UTC, 2026, 9, 17, 6, 0, 0), utc);
        assertTrue(taipei != utc);
    }

    @Test
    public void nullZoneFallsBackToDeviceDefault() {
        long now = System.currentTimeMillis();
        assertEquals(RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, TimeZone.getDefault()),
                RadioAlarmSchedule.nextTrigger(now, "06:00", ALL, null));
    }

    @Test
    public void invalidTimeYieldsNoTrigger() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        assertEquals(-1L, RadioAlarmSchedule.nextTrigger(now, "24:10", ALL, TAIPEI));
        assertEquals(-1L, RadioAlarmSchedule.nextTrigger(now, "", ALL, TAIPEI));
        assertEquals(-1L, RadioAlarmSchedule.nextTrigger(now, null, ALL, TAIPEI));
    }

    // ---- 整份設定的最早觸發 ----

    private static RadioAlarmConfig configOf(RadioAlarmConfig.Alarm... alarms) {
        List<RadioAlarmConfig.Alarm> list = new ArrayList<RadioAlarmConfig.Alarm>();
        for (RadioAlarmConfig.Alarm a : alarms) list.add(a);
        return new RadioAlarmConfig(list, RadioAlarmConfig.builtInChannels(), 100);
    }

    @Test
    public void earliestAcrossEnabledAlarmsRespectsWeekdays() {
        long now = at(TAIPEI, 2026, 9, 17, 6, 30, 0); // 週四 06:30
        RadioAlarmConfig config = configOf(
                new RadioAlarmConfig.Alarm("a", "06:00", ALL, "bcc-news", 30, true),         // 已過 → 週五 06:00
                new RadioAlarmConfig.Alarm("b", "07:00", mask(0, 6), "bcc-pop", 30, true));  // 週六 07:00
        assertEquals(at(TAIPEI, 2026, 9, 18, 6, 0, 0),
                RadioAlarmSchedule.earliestNextTrigger(config, now, TAIPEI));
    }

    @Test
    public void earliestIgnoresDisabledAlarms() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        RadioAlarmConfig config = configOf(
                new RadioAlarmConfig.Alarm("a", "06:00", ALL, "bcc-news", 30, false),
                new RadioAlarmConfig.Alarm("b", "07:00", ALL, "bcc-news", 30, true));
        assertEquals(at(TAIPEI, 2026, 9, 17, 7, 0, 0),
                RadioAlarmSchedule.earliestNextTrigger(config, now, TAIPEI));
    }

    @Test
    public void earliestIsAbsentWhenNothingIsScheduled() {
        assertEquals(-1L, RadioAlarmSchedule.earliestNextTrigger(
                RadioAlarmConfig.defaults(), System.currentTimeMillis(), TAIPEI));
    }
}
