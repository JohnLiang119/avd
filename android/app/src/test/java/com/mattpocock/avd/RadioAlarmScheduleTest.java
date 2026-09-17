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
 */
public class RadioAlarmScheduleTest {

    private static final TimeZone TAIPEI = TimeZone.getTimeZone("Asia/Taipei");
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    /** 在指定時區組出一個絕對時刻，讓測試不受執行機器的預設時區影響。 */
    private static long at(TimeZone zone, int year, int month, int day, int hour, int minute, int second) {
        Calendar cal = Calendar.getInstance(zone);
        cal.clear();
        cal.set(year, month - 1, day, hour, minute, second);
        return cal.getTimeInMillis();
    }

    @Test
    public void todayWhenTheTimeHasNotArrivedYet() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        long expected = at(TAIPEI, 2026, 9, 17, 6, 0, 0);
        assertEquals(expected, RadioAlarmSchedule.nextTrigger(now, "06:00", TAIPEI));
    }

    @Test
    public void tomorrowWhenTheTimeHasPassed() {
        long now = at(TAIPEI, 2026, 9, 17, 6, 30, 0);
        long expected = at(TAIPEI, 2026, 9, 18, 6, 0, 0);
        assertEquals(expected, RadioAlarmSchedule.nextTrigger(now, "06:00", TAIPEI));
    }

    /**
     * 鬧鐘剛響完隨即登錄下一次，正是「現在恰好等於觸發時刻」這個情況。
     * 少了等號，同一分鐘內會再響一次。
     */
    @Test
    public void tomorrowWhenNowIsExactlyTheTriggerInstant() {
        long now = at(TAIPEI, 2026, 9, 17, 6, 0, 0);
        long expected = at(TAIPEI, 2026, 9, 18, 6, 0, 0);
        assertEquals(expected, RadioAlarmSchedule.nextTrigger(now, "06:00", TAIPEI));
    }

    @Test
    public void tomorrowWhenNowIsWithinTheSameMinuteButLater() {
        long now = at(TAIPEI, 2026, 9, 17, 6, 0, 30);
        long expected = at(TAIPEI, 2026, 9, 18, 6, 0, 0);
        assertEquals(expected, RadioAlarmSchedule.nextTrigger(now, "06:00", TAIPEI));
    }

    @Test
    public void handlesTheLastMinuteOfTheDay() {
        long now = at(TAIPEI, 2026, 9, 17, 23, 59, 30);
        long expected = at(TAIPEI, 2026, 9, 18, 23, 59, 0);
        assertEquals(expected, RadioAlarmSchedule.nextTrigger(now, "23:59", TAIPEI));

        long beforeMidnight = at(TAIPEI, 2026, 9, 17, 23, 58, 0);
        long sameDay = at(TAIPEI, 2026, 9, 17, 23, 59, 0);
        assertEquals(sameDay, RadioAlarmSchedule.nextTrigger(beforeMidnight, "23:59", TAIPEI));
    }

    @Test
    public void crossesTheMonthBoundary() {
        long now = at(TAIPEI, 2026, 9, 30, 7, 0, 0);
        long expected = at(TAIPEI, 2026, 10, 1, 6, 0, 0);
        assertEquals(expected, RadioAlarmSchedule.nextTrigger(now, "06:00", TAIPEI));
    }

    /** 同一個絕對時刻，時區不同則「當地的 06:00」不同 —— 時區變更後 MUST 以新時區計算。 */
    @Test
    public void usesTheSuppliedTimeZone() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);

        long taipei = RadioAlarmSchedule.nextTrigger(now, "06:00", TAIPEI);
        long utc = RadioAlarmSchedule.nextTrigger(now, "06:00", UTC);

        assertEquals(at(TAIPEI, 2026, 9, 17, 6, 0, 0), taipei);
        assertEquals(at(UTC, 2026, 9, 17, 6, 0, 0), utc);
        assertTrue("兩個時區算出的絕對時刻必然不同", taipei != utc);
    }

    @Test
    public void nullZoneFallsBackToDeviceDefault() {
        long now = System.currentTimeMillis();
        long withNull = RadioAlarmSchedule.nextTrigger(now, "06:00", null);
        long withDefault = RadioAlarmSchedule.nextTrigger(now, "06:00", TimeZone.getDefault());
        assertEquals(withDefault, withNull);
    }

    @Test
    public void invalidTimeYieldsNoTrigger() {
        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);
        assertEquals(-1L, RadioAlarmSchedule.nextTrigger(now, "24:10", TAIPEI));
        assertEquals(-1L, RadioAlarmSchedule.nextTrigger(now, "", TAIPEI));
        assertEquals(-1L, RadioAlarmSchedule.nextTrigger(now, null, TAIPEI));
    }

    // ---- 整份設定的最早觸發 ----

    @Test
    public void earliestAcrossEnabledEntries() {
        List<RadioAlarmConfig.Entry> entries = new ArrayList<RadioAlarmConfig.Entry>();
        entries.add(new RadioAlarmConfig.Entry("a", "06:00", true, 30));
        entries.add(new RadioAlarmConfig.Entry("b", "07:00", true, 30));
        RadioAlarmConfig config = new RadioAlarmConfig(true, entries, "", 100);

        long now = at(TAIPEI, 2026, 9, 17, 6, 30, 0);

        // 06:00 已過（次日），07:00 尚未到（今日）-> 最早者是今天的 07:00
        assertEquals(at(TAIPEI, 2026, 9, 17, 7, 0, 0),
                RadioAlarmSchedule.earliestNextTrigger(config, now, TAIPEI));
    }

    @Test
    public void earliestIgnoresDisabledEntriesAndMasterSwitch() {
        List<RadioAlarmConfig.Entry> entries = new ArrayList<RadioAlarmConfig.Entry>();
        entries.add(new RadioAlarmConfig.Entry("a", "06:00", false, 30));
        entries.add(new RadioAlarmConfig.Entry("b", "07:00", true, 30));

        long now = at(TAIPEI, 2026, 9, 17, 5, 0, 0);

        assertEquals(at(TAIPEI, 2026, 9, 17, 7, 0, 0),
                RadioAlarmSchedule.earliestNextTrigger(new RadioAlarmConfig(true, entries, "", 100), now, TAIPEI));
        assertEquals(-1L,
                RadioAlarmSchedule.earliestNextTrigger(new RadioAlarmConfig(false, entries, "", 100), now, TAIPEI));
    }

    @Test
    public void earliestIsAbsentWhenNothingIsScheduled() {
        assertEquals(-1L, RadioAlarmSchedule.earliestNextTrigger(
                RadioAlarmConfig.defaults(), System.currentTimeMillis(), TAIPEI));
    }
}
