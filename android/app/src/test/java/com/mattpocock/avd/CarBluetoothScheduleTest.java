package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

/**
 * 車機連線排程的時間區段。
 *
 * 單筆開始時刻的星期與跨日計算已由 {@link RadioAlarmScheduleTest} 釘住，這裡驗證本類別
 * 自己的邏輯：最早的區段開始、停用的不算、「現在是否在區段內」與其結束時刻（含跨午夜與
 * 星期以開始日為準），以及區段長度的邊界。
 *
 * 日期基準：2026-09-17 是星期四（18 週五、19 週六）。
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

    private static CarBluetoothSchedule.Entry window(String id, String start, String end, int weekdays, boolean enabled) {
        return new CarBluetoothSchedule.Entry(id, start, end, weekdays, enabled);
    }

    private static List<CarBluetoothSchedule.Entry> list(CarBluetoothSchedule.Entry... entries) {
        List<CarBluetoothSchedule.Entry> result = new ArrayList<CarBluetoothSchedule.Entry>();
        for (CarBluetoothSchedule.Entry e : entries) result.add(e);
        return result;
    }

    // ---- 區段開始 ----

    @Test
    public void picksTheEarliestWindowStart() {
        List<CarBluetoothSchedule.Entry> entries = list(
                window("evening", "18:00", "18:30", ALL, true),
                window("morning", "07:30", "08:00", ALL, true));
        assertEquals(at(17, 7, 30), CarBluetoothSchedule.earliestNextTrigger(entries, at(17, 6, 0), TAIPEI));
    }

    @Test
    public void disabledWindowsAreIgnoredAndEmptyMeansNoAlarm() {
        assertEquals(-1L, CarBluetoothSchedule.earliestNextTrigger(list(), at(17, 6, 0), TAIPEI));
        assertEquals(-1L, CarBluetoothSchedule.earliestNextTrigger(
                list(window("m", "07:30", "08:00", ALL, false)), at(17, 6, 0), TAIPEI));
        assertEquals(at(17, 18, 0), CarBluetoothSchedule.earliestNextTrigger(
                list(window("m", "07:30", "08:00", ALL, false), window("e", "18:00", "18:30", ALL, true)),
                at(17, 6, 0), TAIPEI));
    }

    @Test
    public void justStartedRollsToTomorrow() {
        List<CarBluetoothSchedule.Entry> entries = list(window("m", "07:30", "08:00", ALL, true));
        assertEquals(at(18, 7, 30), CarBluetoothSchedule.earliestNextTrigger(entries, at(17, 7, 30), TAIPEI));
    }

    // ---- 現在是否在區段內 ----

    @Test
    public void insideWindowReturnsItsEnd() {
        List<CarBluetoothSchedule.Entry> entries = list(window("m", "07:30", "08:00", ALL, true));
        assertEquals(at(17, 8, 0), CarBluetoothSchedule.activeWindowEnd(entries, at(17, 7, 45), TAIPEI));
    }

    @Test
    public void windowIncludesStartButNotEnd() {
        List<CarBluetoothSchedule.Entry> entries = list(window("m", "07:30", "08:00", ALL, true));
        assertEquals(at(17, 8, 0), CarBluetoothSchedule.activeWindowEnd(entries, at(17, 7, 30), TAIPEI));
        assertEquals(-1L, CarBluetoothSchedule.activeWindowEnd(entries, at(17, 8, 0), TAIPEI));
        assertEquals(-1L, CarBluetoothSchedule.activeWindowEnd(entries, at(17, 7, 29), TAIPEI));
    }

    @Test
    public void disabledWindowIsNeverActive() {
        List<CarBluetoothSchedule.Entry> entries = list(window("m", "07:30", "08:00", ALL, false));
        assertEquals(-1L, CarBluetoothSchedule.activeWindowEnd(entries, at(17, 7, 45), TAIPEI));
    }

    @Test
    public void weekdayIsDecidedByTheStartDay() {
        // 只選週四：週四 23:00 開始、隔天（週五）01:00 結束的區段，週五 00:30 仍在區段內
        int thursdayOnly = 1 << (Calendar.THURSDAY - 1);
        List<CarBluetoothSchedule.Entry> entries = list(window("night", "23:00", "01:00", thursdayOnly, true));
        assertEquals(at(18, 1, 0), CarBluetoothSchedule.activeWindowEnd(entries, at(18, 0, 30), TAIPEI));
        assertEquals(at(18, 1, 0), CarBluetoothSchedule.activeWindowEnd(entries, at(17, 23, 30), TAIPEI));
        // 週五 23:30 不是週四開始的區段，不算
        assertEquals(-1L, CarBluetoothSchedule.activeWindowEnd(entries, at(18, 23, 30), TAIPEI));
    }

    @Test
    public void overlappingWindowsReturnTheLatestEnd() {
        List<CarBluetoothSchedule.Entry> entries = list(
                window("a", "07:00", "08:00", ALL, true),
                window("b", "07:30", "09:00", ALL, true));
        assertEquals(at(17, 9, 0), CarBluetoothSchedule.activeWindowEnd(entries, at(17, 7, 45), TAIPEI));
    }

    // ---- 區段長度與解析 ----

    @Test
    public void durationHandlesMidnightAndIdenticalTimes() {
        assertEquals(30, window("a", "07:30", "08:00", ALL, true).durationMinutes());
        assertEquals(120, window("b", "23:00", "01:00", ALL, true).durationMinutes());
        // 開始與結束相同不是「整天」，視為非法並套用預設長度
        assertEquals(CarBluetoothSchedule.DEFAULT_WINDOW_MIN, window("c", "07:30", "07:30", ALL, true).durationMinutes());
    }
}
