package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * 設定的解析、驗證與序列化。
 *
 * 這裡釘住的是「壞掉的設定不會讓鬧鐘靜默消失」與「不合法的值進不來」——
 * 兩者在實機上都只表現為「早上沒有響」，是最難事後查出原因的失敗。
 */
public class RadioAlarmConfigTest {

    // ---- 時間解析 ----

    @Test
    public void parsesValidTimes() {
        assertEquals(0, RadioAlarmConfig.parseTimeToMinutes("00:00"));
        assertEquals(6 * 60, RadioAlarmConfig.parseTimeToMinutes("06:00"));
        assertEquals(7 * 60, RadioAlarmConfig.parseTimeToMinutes("7:00"));
        assertEquals(23 * 60 + 59, RadioAlarmConfig.parseTimeToMinutes("23:59"));
        assertEquals(6 * 60 + 5, RadioAlarmConfig.parseTimeToMinutes("  6:5  "));
    }

    @Test
    public void rejectsOutOfRangeAndMalformedTimes() {
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("24:10"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("06:60"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("-1"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("-1:00"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("0600"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("abc"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("06:"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes(":00"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("006:00"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes(""));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes(null));
    }

    @Test
    public void normalizesToTwoDigitForm() {
        assertEquals("06:00", RadioAlarmConfig.normalizeTime("6:0"));
        assertEquals("06:05", RadioAlarmConfig.normalizeTime("6:5"));
        assertEquals("23:59", RadioAlarmConfig.normalizeTime("23:59"));
        assertNull(RadioAlarmConfig.normalizeTime("24:10"));
    }

    // ---- 時長與網址 ----

    @Test
    public void clampsDurationIntoRange() {
        assertEquals(RadioAlarmConstants.MIN_DURATION_MIN, RadioAlarmConfig.clampDuration(-1));
        assertEquals(RadioAlarmConstants.MIN_DURATION_MIN, RadioAlarmConfig.clampDuration(0));
        assertEquals(RadioAlarmConstants.MAX_DURATION_MIN, RadioAlarmConfig.clampDuration(181));
        assertEquals(30, RadioAlarmConfig.clampDuration(30));
        assertEquals(1, RadioAlarmConfig.clampDuration(1));
        assertEquals(180, RadioAlarmConfig.clampDuration(180));
    }

    @Test
    public void clampsVolumeIntoRange() {
        assertEquals(RadioAlarmConstants.MIN_VOLUME_PERCENT, RadioAlarmConfig.clampVolume(-1));
        assertEquals(RadioAlarmConstants.MAX_VOLUME_PERCENT, RadioAlarmConfig.clampVolume(101));
        assertEquals(0, RadioAlarmConfig.clampVolume(0));
        assertEquals(50, RadioAlarmConfig.clampVolume(50));
        assertEquals(100, RadioAlarmConfig.clampVolume(100));
    }

    @Test
    public void volumeGainIsTheFractionAppliedToThePlayer() {
        List<RadioAlarmConfig.Entry> none = new ArrayList<RadioAlarmConfig.Entry>();
        assertEquals(1.0f, new RadioAlarmConfig(true, none, "", 100).volumeGain(), 0.0001f);
        assertEquals(0.5f, new RadioAlarmConfig(true, none, "", 50).volumeGain(), 0.0001f);
        assertEquals(0.0f, new RadioAlarmConfig(true, none, "", 0).volumeGain(), 0.0001f);
    }

    @Test
    public void acceptsOnlyHttpStreamUrls() {
        assertTrue(RadioAlarmConfig.isValidStreamUrl(""));
        assertTrue(RadioAlarmConfig.isValidStreamUrl(null));
        assertTrue(RadioAlarmConfig.isValidStreamUrl("   "));
        assertTrue(RadioAlarmConfig.isValidStreamUrl("https://example.com/live.aac"));
        assertTrue(RadioAlarmConfig.isValidStreamUrl("http://example.com/live.aac"));
        assertFalse(RadioAlarmConfig.isValidStreamUrl("rtmp://example.com/live"));
        assertFalse(RadioAlarmConfig.isValidStreamUrl("example.com/live"));
    }

    // ---- 預設值 ----

    @Test
    public void defaultsAreSilent() {
        RadioAlarmConfig config = RadioAlarmConfig.defaults();
        assertFalse("升級的使用者 MUST NOT 被無預警叫醒", config.masterEnabled);
        assertTrue(config.entries.isEmpty());
        assertEquals("", config.customStreamUrl);
        assertTrue(config.enabledEntries().isEmpty());
        assertEquals("預設 100% 即「完全照系統鬧鐘音量」，升級的使用者聽到的音量不變",
                RadioAlarmConstants.DEFAULT_VOLUME_PERCENT, config.volumePercent);
    }

    @Test
    public void volumeSurvivesAndIsClampedWhenParsed() {
        String json = "{'masterEnabled':true,'volumePercent':40,'entries':[]}";
        assertEquals(40, RadioAlarmConfig.fromJson(json.replace('\'', '"')).volumePercent);

        String tooHigh = "{'masterEnabled':true,'volumePercent':999,'entries':[]}";
        assertEquals(100, RadioAlarmConfig.fromJson(tooHigh.replace('\'', '"')).volumePercent);

        String negative = "{'masterEnabled':true,'volumePercent':-5,'entries':[]}";
        assertEquals(0, RadioAlarmConfig.fromJson(negative.replace('\'', '"')).volumePercent);

        String garbage = "{'masterEnabled':true,'volumePercent':'loud','entries':[]}";
        assertEquals("非數字時回到預設，而非讓整份設定失效",
                100, RadioAlarmConfig.fromJson(garbage.replace('\'', '"')).volumePercent);

        String missing = "{'masterEnabled':true,'entries':[]}";
        assertEquals("舊版寫入的設定沒有這個欄位，必須讀成預設的 100",
                100, RadioAlarmConfig.fromJson(missing.replace('\'', '"')).volumePercent);
    }

    @Test
    public void defaultEntriesAreTheTwoMorningSlots() {
        List<RadioAlarmConfig.Entry> entries = RadioAlarmConfig.defaultEntries();
        assertEquals(2, entries.size());
        assertEquals("06:00", entries.get(0).time);
        assertEquals("07:00", entries.get(1).time);
        for (RadioAlarmConfig.Entry entry : entries) {
            assertTrue(entry.enabled);
            assertEquals(RadioAlarmConstants.DEFAULT_DURATION_MIN, entry.durationMin);
            assertNotNull(entry.id);
            assertFalse(entry.id.isEmpty());
        }
    }

    @Test
    public void enabledEntriesRespectMasterSwitchAndPerEntrySwitch() {
        List<RadioAlarmConfig.Entry> entries = new ArrayList<RadioAlarmConfig.Entry>();
        entries.add(new RadioAlarmConfig.Entry("a", "06:00", true, 30));
        entries.add(new RadioAlarmConfig.Entry("b", "07:00", false, 30));

        assertEquals(1, new RadioAlarmConfig(true, entries, "", 100).enabledEntries().size());
        assertEquals(0, new RadioAlarmConfig(false, entries, "", 100).enabledEntries().size());
    }

    // ---- 反序列化的防守 ----

    @Test
    public void parsesWellFormedJson() {
        String json = "{"
                + "'masterEnabled':true,"
                + "'customStreamUrl':'https://example.com/live.aac',"
                + "'entries':["
                + "{'id':'a','time':'06:00','enabled':true,'durationMin':10},"
                + "{'id':'b','time':'7:0','enabled':false,'durationMin':25}"
                + "]}";

        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json.replace('\'', '"'));
        assertTrue(config.masterEnabled);
        assertEquals("https://example.com/live.aac", config.customStreamUrl);
        assertEquals(2, config.entries.size());
        assertEquals("06:00", config.entries.get(0).time);
        assertEquals(10, config.entries.get(0).durationMin);
        assertEquals("07:00", config.entries.get(1).time);
        assertFalse(config.entries.get(1).enabled);
    }

    @Test
    public void dropsEntriesWithInvalidTimeButKeepsTheRest() {
        String json = "{'masterEnabled':true,'entries':["
                + "{'id':'a','time':'24:10','enabled':true,'durationMin':30},"
                + "{'id':'b','time':'06:00','enabled':true,'durationMin':30}"
                + "]}";

        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json.replace('\'', '"'));
        assertEquals(1, config.entries.size());
        assertEquals("06:00", config.entries.get(0).time);
    }

    @Test
    public void dropsDuplicateTimesKeepingTheFirst() {
        String json = "{'masterEnabled':true,'entries':["
                + "{'id':'a','time':'06:00','enabled':true,'durationMin':10},"
                + "{'id':'b','time':'6:00','enabled':false,'durationMin':90}"
                + "]}";

        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json.replace('\'', '"'));
        assertEquals(1, config.entries.size());
        assertEquals("a", config.entries.get(0).id);
        assertEquals(10, config.entries.get(0).durationMin);
    }

    @Test
    public void clampsOutOfRangeDurationInsteadOfDroppingTheEntry() {
        String json = "{'masterEnabled':true,'entries':["
                + "{'id':'a','time':'06:00','enabled':true,'durationMin':-1},"
                + "{'id':'b','time':'07:00','enabled':true,'durationMin':181}"
                + "]}";

        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json.replace('\'', '"'));
        assertEquals(2, config.entries.size());
        assertEquals(RadioAlarmConstants.MIN_DURATION_MIN, config.entries.get(0).durationMin);
        assertEquals(RadioAlarmConstants.MAX_DURATION_MIN, config.entries.get(1).durationMin);
    }

    @Test
    public void dropsUnusableCustomStreamUrl() {
        String json = "{'masterEnabled':true,'customStreamUrl':'rtmp://x/y','entries':[]}";
        assertEquals("", RadioAlarmConfig.fromJson(json.replace('\'', '"')).customStreamUrl);
    }

    @Test
    public void fallsBackToDefaultsOnUnusableInput() {
        assertFalse(RadioAlarmConfig.fromJson(null).masterEnabled);
        assertFalse(RadioAlarmConfig.fromJson("").masterEnabled);
        assertFalse(RadioAlarmConfig.fromJson("   ").masterEnabled);
        assertFalse(RadioAlarmConfig.fromJson("not json at all").masterEnabled);
        assertFalse(RadioAlarmConfig.fromJson("[1,2,3]").masterEnabled);
        assertTrue(RadioAlarmConfig.fromJson("{}").entries.isEmpty());
        assertTrue(RadioAlarmConfig.fromJson("{'entries':'nope'}".replace('\'', '"')).entries.isEmpty());
    }

    @Test
    public void entriesWithoutIdGetOne() {
        String json = "{'masterEnabled':true,'entries':[{'time':'06:00'}]}";
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json.replace('\'', '"'));
        assertEquals(1, config.entries.size());
        assertFalse(config.entries.get(0).id.isEmpty());
        assertTrue("未指定時預設為啟用", config.entries.get(0).enabled);
        assertEquals(RadioAlarmConstants.DEFAULT_DURATION_MIN, config.entries.get(0).durationMin);
    }

    // ---- 來回一致 ----

    @Test
    public void survivesRoundTrip() {
        List<RadioAlarmConfig.Entry> entries = new ArrayList<RadioAlarmConfig.Entry>();
        entries.add(new RadioAlarmConfig.Entry("a", "06:00", true, 10));
        entries.add(new RadioAlarmConfig.Entry("b", "07:00", false, 25));
        RadioAlarmConfig original = new RadioAlarmConfig(true, entries, "https://example.com/live.aac", 70);

        RadioAlarmConfig restored = RadioAlarmConfig.fromJson(original.toJson());

        assertEquals(original.masterEnabled, restored.masterEnabled);
        assertEquals(original.customStreamUrl, restored.customStreamUrl);
        assertEquals(original.volumePercent, restored.volumePercent);
        assertEquals(original.entries.size(), restored.entries.size());
        for (int i = 0; i < original.entries.size(); i++) {
            assertEquals(original.entries.get(i).id, restored.entries.get(i).id);
            assertEquals(original.entries.get(i).time, restored.entries.get(i).time);
            assertEquals(original.entries.get(i).enabled, restored.entries.get(i).enabled);
            assertEquals(original.entries.get(i).durationMin, restored.entries.get(i).durationMin);
        }
    }
}
