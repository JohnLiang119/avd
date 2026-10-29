package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

/**
 * 車機連線排程的「最早下一次」。
 *
 * 單筆的星期與跨日計算已由 {@link RadioAlarmScheduleTest} 釘住，這裡只驗證本類別
 * 自己的邏輯：停用的不算、多筆取最早、空清單回 -1。
 *
 * 日期基準：2026-09-17 是星期四。
 */
public class CarBluetoothScheduleTest {

    private static final TimeZone TAIPEI = TimeZone.getTimeZone("Asia/Taipei");
    private static final int ALL = RadioAlarmConfig.ALL_WEEKDAYS;

    private static long at(int day, int hour, int minute) {
        Calendar cal = Calendar.getInstance(TAIPEI);
        cal.clear();
        cal.set(2026, Calendar.SEPTEMBER, day, hour, minute, 0);
        return cal.getTimeInMillis();
    }

    private static CarBluetoothSchedule.Entry entry(String id, String time, boolean enabled) {
        return new CarBluetoothSchedule.Entry(id, time, ALL, enabled);
    }

    @Test
    public void picksTheEarliestOfSeveralEntries() {
        List<CarBluetoothSchedule.Entry> list = new ArrayList<CarBluetoothSchedule.Entry>();
        list.add(entry("evening", "18:00", true));
        list.add(entry("morning", "07:30", true));
        // 現在是 17 日 06:00：最早的是同日 07:30
        assertEquals(at(17, 7, 30),
                CarBluetoothSchedule.earliestNextTrigger(list, at(17, 6, 0), TAIPEI));
    }

    @Test
    public void disabledEntriesAreIgnored() {
        List<CarBluetoothSchedule.Entry> list = new ArrayList<CarBluetoothSchedule.Entry>();
        list.add(entry("morning", "07:30", false));
        list.add(entry("evening", "18:00", true));
        assertEquals(at(17, 18, 0),
                CarBluetoothSchedule.earliestNextTrigger(list, at(17, 6, 0), TAIPEI));
    }

    @Test
    public void noEnabledEntryMeansNoAlarm() {
        List<CarBluetoothSchedule.Entry> list = new ArrayList<CarBluetoothSchedule.Entry>();
        assertEquals(-1L, CarBluetoothSchedule.earliestNextTrigger(list, at(17, 6, 0), TAIPEI));
        list.add(entry("morning", "07:30", false));
        assertEquals(-1L, CarBluetoothSchedule.earliestNextTrigger(list, at(17, 6, 0), TAIPEI));
    }

    @Test
    public void justFiredRollsToTomorrow() {
        List<CarBluetoothSchedule.Entry> list = new ArrayList<CarBluetoothSchedule.Entry>();
        list.add(entry("morning", "07:30", true));
        // 剛好 07:30 觸發後重新登錄：不可在同一分鐘再響，要落到隔天
        assertTrue(CarBluetoothSchedule.earliestNextTrigger(list, at(17, 7, 30), TAIPEI) == at(18, 7, 30));
    }
}
