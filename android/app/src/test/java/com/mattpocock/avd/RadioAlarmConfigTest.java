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
 * 設定的解析、驗證、序列化與舊格式遷移。
 *
 * 這裡釘住的是「壞掉的設定不會讓鬧鐘靜默消失」與「不合法的值進不來」——
 * 兩者在實機上都只表現為「早上沒有響」，是最難事後查出原因的失敗。
 */
public class RadioAlarmConfigTest {

    private static final String NEWS = RadioAlarmConstants.CHANNEL_NEWS_ID;
    private static final String POP = RadioAlarmConstants.CHANNEL_POP_ID;

    private static String j(String singleQuoted) {
        return singleQuoted.replace('\'', '"');
    }

    private static int mask(int... days) {
        int m = 0;
        for (int d : days) m |= 1 << d;
        return m;
    }

    private static RadioAlarmConfig.Alarm alarm(String id, String time, int weekdays, String channelId,
                                                boolean enabled) {
        return new RadioAlarmConfig.Alarm(id, time, weekdays, channelId, 30, enabled);
    }

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
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("0600"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("abc"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes("06:"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes(":00"));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes(""));
        assertEquals(-1, RadioAlarmConfig.parseTimeToMinutes(null));
    }

    @Test
    public void normalizesToTwoDigitForm() {
        assertEquals("06:00", RadioAlarmConfig.normalizeTime("6:0"));
        assertEquals("06:05", RadioAlarmConfig.normalizeTime("6:5"));
        assertNull(RadioAlarmConfig.normalizeTime("24:10"));
    }

    // ---- 星期遮罩 ----

    @Test
    public void weekdayMaskBitsFollowCalendarOrder() {
        // bit 0 = 週日 … bit 6 = 週六，與 Calendar.DAY_OF_WEEK - 1 及 JS getDay() 一致
        assertTrue(RadioAlarmConfig.hasWeekday(mask(0), 0));
        assertTrue(RadioAlarmConfig.hasWeekday(mask(6), 6));
        assertFalse(RadioAlarmConfig.hasWeekday(mask(1, 2, 3, 4, 5), 0));
        assertFalse(RadioAlarmConfig.hasWeekday(mask(1, 2, 3, 4, 5), 6));
        assertTrue(RadioAlarmConfig.hasWeekday(RadioAlarmConfig.ALL_WEEKDAYS, 3));
        assertFalse(RadioAlarmConfig.hasWeekday(RadioAlarmConfig.ALL_WEEKDAYS, 7));
        assertFalse(RadioAlarmConfig.hasWeekday(RadioAlarmConfig.ALL_WEEKDAYS, -1));
    }

    @Test
    public void emptyOrGarbageMaskBecomesEveryDay() {
        // 空遮罩在鬧鐘 App 通常代表「只響一次」，對廣播用處不大且容易被誤認為壞了
        assertEquals(RadioAlarmConfig.ALL_WEEKDAYS, RadioAlarmConfig.normalizeWeekdays(0));
        assertEquals(RadioAlarmConfig.ALL_WEEKDAYS, RadioAlarmConfig.normalizeWeekdays(0x80));
        assertEquals(mask(1, 5), RadioAlarmConfig.normalizeWeekdays(mask(1, 5) | 0x100));
        assertEquals(mask(2), RadioAlarmConfig.normalizeWeekdays(mask(2)));
    }

    // ---- 時長、音量、網址 ----

    @Test
    public void clampsDurationAndVolume() {
        assertEquals(1, RadioAlarmConfig.clampDuration(-1));
        assertEquals(180, RadioAlarmConfig.clampDuration(181));
        assertEquals(30, RadioAlarmConfig.clampDuration(30));
        assertEquals(0, RadioAlarmConfig.clampVolume(-1));
        assertEquals(100, RadioAlarmConfig.clampVolume(101));
        assertEquals(50, RadioAlarmConfig.clampVolume(50));
    }

    @Test
    public void customChannelUrlMustBeHttp() {
        assertTrue(RadioAlarmConfig.isValidStreamUrl("https://example.com/live.aac"));
        assertTrue(RadioAlarmConfig.isValidStreamUrl("http://example.com/live.aac"));
        assertFalse(RadioAlarmConfig.isValidStreamUrl("rtmp://example.com/live"));
        assertFalse(RadioAlarmConfig.isValidStreamUrl(""));
        assertFalse(RadioAlarmConfig.isValidStreamUrl(null));
    }

    // ---- 預設值 ----

    @Test
    public void defaultsAreSilentAndCarryBuiltInChannels() {
        RadioAlarmConfig config = RadioAlarmConfig.defaults();
        assertTrue("升級的使用者 MUST NOT 被無預警叫醒 —— 預設沒有任何鬧鐘", config.alarms.isEmpty());
        assertTrue(config.enabledAlarms().isEmpty());
        assertEquals(2, config.channels.size());
        assertEquals(NEWS, config.channels.get(0).id);
        assertEquals(POP, config.channels.get(1).id);
        assertEquals(NEWS, config.defaultChannel().id);
        assertEquals(100, config.volumePercent);
    }

    @Test
    public void unknownChannelIdFallsBackToDefaultChannel() {
        RadioAlarmConfig config = RadioAlarmConfig.defaults();
        assertEquals(NEWS, config.channelById("nope").id);
        assertEquals(NEWS, config.channelById(null).id);
        assertEquals(POP, config.channelById(POP).id);
    }

    // ---- 新格式的解析 ----

    @Test
    public void parsesSchemaTwo() {
        String json = j("{'schemaVersion':2,'volumePercent':60,"
                + "'channels':[{'id':'bcc-news','name':'中廣新聞網','kind':'bcc','source':'中廣新聞網'},"
                + "{'id':'bcc-pop','name':'中廣流行網','kind':'bcc','source':'中廣流行網'},"
                + "{'id':'c1','name':'我的台','kind':'url','source':'https://example.com/a.aac'}],"
                + "'alarms':[{'id':'a','time':'6:0','weekdays':62,'channelId':'bcc-pop','durationMin':10,'enabled':true},"
                + "{'id':'b','time':'07:00','weekdays':65,'channelId':'c1','durationMin':25,'enabled':false}]}");

        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json);
        assertEquals(60, config.volumePercent);
        assertEquals(3, config.channels.size());
        assertEquals(2, config.alarms.size());

        RadioAlarmConfig.Alarm a = config.alarms.get(0);
        assertEquals("06:00", a.time);
        assertEquals(mask(1, 2, 3, 4, 5), a.weekdays);
        assertEquals(POP, a.channelId);
        assertEquals(10, a.durationMin);
        assertTrue(a.enabled);

        RadioAlarmConfig.Alarm b = config.alarms.get(1);
        assertEquals(mask(0, 6), b.weekdays);
        assertEquals("c1", b.channelId);
        assertFalse(b.enabled);
        assertEquals(1, config.enabledAlarms().size());
    }

    @Test
    public void sameTimeMayAppearTwice() {
        // 06:00 平日新聞、06:00 週末流行是正常用法，MUST NOT 以時間重複為由剔除
        String json = j("{'schemaVersion':2,'alarms':["
                + "{'id':'a','time':'06:00','weekdays':62,'channelId':'bcc-news'},"
                + "{'id':'b','time':'06:00','weekdays':65,'channelId':'bcc-pop'}]}");
        assertEquals(2, RadioAlarmConfig.fromJson(json).alarms.size());
    }

    @Test
    public void alarmPointingAtMissingChannelIsKeptOnDefaultChannel() {
        String json = j("{'schemaVersion':2,'alarms':[{'id':'a','time':'06:00','channelId':'gone'}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json);
        assertEquals("鬧鐘 MUST NOT 因頻道消失而不見", 1, config.alarms.size());
        assertEquals(NEWS, config.alarms.get(0).channelId);
    }

    @Test
    public void emptyWeekdaysInStorageBecomeEveryDay() {
        String json = j("{'schemaVersion':2,'alarms':[{'id':'a','time':'06:00','weekdays':0}]}");
        assertEquals(RadioAlarmConfig.ALL_WEEKDAYS, RadioAlarmConfig.fromJson(json).alarms.get(0).weekdays);
    }

    @Test
    public void builtInChannelsAreAlwaysPresentEvenIfOmittedOrPartial() {
        String noChannels = j("{'schemaVersion':2,'alarms':[]}");
        assertEquals(2, RadioAlarmConfig.fromJson(noChannels).channels.size());

        String onlyPop = j("{'schemaVersion':2,'channels':[{'id':'bcc-pop','name':'流行','kind':'bcc','source':'中廣流行網'}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(onlyPop);
        assertEquals(2, config.channels.size());
        assertEquals(NEWS, config.channels.get(0).id);
        assertEquals("允許改名：既有的內建項目維持原樣", "流行", config.channels.get(1).name);
    }

    @Test
    public void customChannelWithBadUrlIsDropped() {
        String json = j("{'schemaVersion':2,"
                + "'channels':[{'id':'c1','name':'壞','kind':'url','source':'rtmp://x/y'}],"
                + "'alarms':[{'id':'a','time':'06:00','channelId':'c1'}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json);
        assertEquals(2, config.channels.size());
        assertEquals("指向被剔除頻道的鬧鐘落到預設頻道", NEWS, config.alarms.get(0).channelId);
    }

    @Test
    public void dropsAlarmsWithInvalidTimeButKeepsTheRest() {
        String json = j("{'schemaVersion':2,'alarms':["
                + "{'id':'a','time':'24:10'},{'id':'b','time':'06:00'}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json);
        assertEquals(1, config.alarms.size());
        assertEquals("06:00", config.alarms.get(0).time);
    }

    @Test
    public void fallsBackToDefaultsOnUnusableInput() {
        assertTrue(RadioAlarmConfig.fromJson(null).alarms.isEmpty());
        assertTrue(RadioAlarmConfig.fromJson("").alarms.isEmpty());
        assertTrue(RadioAlarmConfig.fromJson("not json").alarms.isEmpty());
        assertTrue(RadioAlarmConfig.fromJson("[1,2,3]").alarms.isEmpty());
        assertEquals(2, RadioAlarmConfig.fromJson("{}").channels.size());
    }

    @Test
    public void survivesRoundTrip() {
        List<RadioAlarmConfig.Channel> channels = RadioAlarmConfig.builtInChannels();
        channels.add(new RadioAlarmConfig.Channel("c1", "我的台", RadioAlarmConfig.CHANNEL_KIND_URL,
                "https://example.com/a.aac"));
        List<RadioAlarmConfig.Alarm> alarms = new ArrayList<RadioAlarmConfig.Alarm>();
        alarms.add(alarm("a", "06:00", mask(1, 2, 3, 4, 5), NEWS, true));
        alarms.add(alarm("b", "06:00", mask(0, 6), "c1", false));
        RadioAlarmConfig original = new RadioAlarmConfig(alarms, channels, 70);

        RadioAlarmConfig restored = RadioAlarmConfig.fromJson(original.toJson());

        assertEquals(original.volumePercent, restored.volumePercent);
        assertEquals(original.channels.size(), restored.channels.size());
        assertEquals(original.alarms.size(), restored.alarms.size());
        for (int i = 0; i < original.alarms.size(); i++) {
            RadioAlarmConfig.Alarm o = original.alarms.get(i);
            RadioAlarmConfig.Alarm r = restored.alarms.get(i);
            assertEquals(o.id, r.id);
            assertEquals(o.time, r.time);
            assertEquals(o.weekdays, r.weekdays);
            assertEquals(o.channelId, r.channelId);
            assertEquals(o.durationMin, r.durationMin);
            assertEquals(o.enabled, r.enabled);
        }
    }

    // ---- 舊格式遷移（v1.0.98～1.0.103 的「每日時間清單」）----

    /** 舊格式的實際樣本：總開關開、兩筆時間、無自訂網址、音量 60。 */
    private static final String LEGACY_PLAIN = j("{'masterEnabled':true,'customStreamUrl':'','volumePercent':60,"
            + "'entries':[{'id':'t1_0600','time':'06:00','enabled':true,'durationMin':30},"
            + "{'id':'t2_0700','time':'07:00','enabled':false,'durationMin':45}]}");

    @Test
    public void migratesLegacyEntriesToEverydayAlarmsOnNewsChannel() {
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(LEGACY_PLAIN);

        assertEquals(2, config.alarms.size());
        assertEquals(60, config.volumePercent);
        assertEquals(2, config.channels.size());

        RadioAlarmConfig.Alarm a = config.alarms.get(0);
        assertEquals("t1_0600", a.id);
        assertEquals("06:00", a.time);
        assertEquals(RadioAlarmConfig.ALL_WEEKDAYS, a.weekdays);
        assertEquals(NEWS, a.channelId);
        assertEquals(30, a.durationMin);
        assertTrue(a.enabled);

        RadioAlarmConfig.Alarm b = config.alarms.get(1);
        assertEquals(45, b.durationMin);
        assertFalse("舊的逐筆停用要沿用", b.enabled);
    }

    @Test
    public void migratesLegacyCustomUrlIntoACustomChannelUsedByAllAlarms() {
        String json = j("{'masterEnabled':true,'customStreamUrl':'https://example.com/live.aac',"
                + "'entries':[{'id':'a','time':'06:00','enabled':true,'durationMin':30},"
                + "{'id':'b','time':'07:00','enabled':true,'durationMin':30}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json);

        assertEquals(3, config.channels.size());
        RadioAlarmConfig.Channel custom = config.channelById(RadioAlarmConstants.LEGACY_CUSTOM_CHANNEL_ID);
        assertEquals(RadioAlarmConfig.CHANNEL_KIND_URL, custom.kind);
        assertEquals("https://example.com/live.aac", custom.source);
        for (RadioAlarmConfig.Alarm a : config.alarms) {
            assertEquals("舊網址對所有時間生效，遷移後行為 MUST 相同", custom.id, a.channelId);
        }
    }

    @Test
    public void migratesLegacyMasterOffToAllDisabled() {
        String json = j("{'masterEnabled':false,'entries':["
                + "{'id':'a','time':'06:00','enabled':true,'durationMin':30}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json);
        assertEquals(1, config.alarms.size());
        assertFalse("舊總開關關著就是不響", config.alarms.get(0).enabled);
        assertTrue(config.enabledAlarms().isEmpty());
    }

    @Test
    public void legacyWithoutSchemaVersionAndWithoutEntriesIsJustEmpty() {
        assertTrue(RadioAlarmConfig.fromJson(j("{'masterEnabled':true}")).alarms.isEmpty());
    }

    @Test
    public void migrationRunsOnceBecauseOutputCarriesTheNewVersion() {
        RadioAlarmConfig migrated = RadioAlarmConfig.fromJson(LEGACY_PLAIN);
        String persisted = migrated.toJson();
        assertTrue(persisted.contains("\"schemaVersion\":" + RadioAlarmConfig.SCHEMA_VERSION));

        // 再讀一次：走新格式路徑，內容不變 —— 不會被第二次「遷移」改掉
        RadioAlarmConfig again = RadioAlarmConfig.fromJson(persisted);
        assertEquals(migrated.alarms.size(), again.alarms.size());
        for (int i = 0; i < migrated.alarms.size(); i++) {
            assertEquals(migrated.alarms.get(i).id, again.alarms.get(i).id);
            assertEquals(migrated.alarms.get(i).weekdays, again.alarms.get(i).weekdays);
            assertEquals(migrated.alarms.get(i).channelId, again.alarms.get(i).channelId);
            assertEquals(migrated.alarms.get(i).enabled, again.alarms.get(i).enabled);
        }
        assertNotNull(again.defaultChannel());
    }

    // ---- 本地檔案頻道（design.md D15）----

    private static final String ROOT = "/data/user/0/com.mattpocock.avd/files/radio_alarm";

    private static final String FILE_CHANNEL_JSON = j("{'schemaVersion':2,"
            + "'channels':[{'id':'f1','name':'早晨歌單','kind':'file','source':'',"
            + "'files':[{'path':'" + ROOT + "/f1/001_a.mp3','displayName':'a.mp3'},"
            + "{'path':'" + ROOT + "/f1/002_b.mp3','displayName':'b.mp3'},"
            + "{'path':'" + ROOT + "/f1/003_c.mp4','displayName':'c.mp4'}]}],"
            + "'alarms':[{'id':'a','time':'06:00','channelId':'f1'}]}");

    @Test
    public void localPathMustLiveUnderTheRoot() {
        assertTrue(RadioAlarmConfig.isValidLocalFilePath(ROOT + "/f1/001_a.mp3", ROOT));
        assertTrue("root 結尾多一個斜線也要能比對", RadioAlarmConfig.isValidLocalFilePath(ROOT + "/f1/001_a.mp3", ROOT + "/"));
        assertFalse("私有目錄以外一律拒絕", RadioAlarmConfig.isValidLocalFilePath("/storage/emulated/0/Music/a.mp3", ROOT));
        assertFalse("同前綴的其他目錄不算在 root 之下", RadioAlarmConfig.isValidLocalFilePath(ROOT + "_evil/a.mp3", ROOT));
        assertFalse("`..` 不得逃出 root", RadioAlarmConfig.isValidLocalFilePath(ROOT + "/f1/../../a.mp3", ROOT));
        assertFalse("root 本身不是檔案", RadioAlarmConfig.isValidLocalFilePath(ROOT, ROOT));
        assertFalse("沒有 root 就沒有「之下」可言", RadioAlarmConfig.isValidLocalFilePath(ROOT + "/f1/a.mp3", null));
        assertFalse(RadioAlarmConfig.isValidLocalFilePath(null, ROOT));
        assertFalse(RadioAlarmConfig.isValidLocalFilePath("", ROOT));
    }

    @Test
    public void parsesFileChannelKeepingOrderAndNames() {
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(FILE_CHANNEL_JSON, ROOT);
        assertEquals(3, config.channels.size());

        RadioAlarmConfig.Channel f1 = config.channelById("f1");
        assertEquals(RadioAlarmConfig.CHANNEL_KIND_FILE, f1.kind);
        assertTrue(f1.isLocalFile());
        assertFalse(f1.isBuiltIn());
        assertEquals("早晨歌單", f1.name);
        assertEquals("順序即播放順序，MUST NOT 重排", 3, f1.files.size());
        assertEquals(ROOT + "/f1/001_a.mp3", f1.files.get(0).path);
        assertEquals("a.mp3", f1.files.get(0).displayName);
        assertEquals("c.mp4", f1.files.get(2).displayName);
        assertEquals("f1", config.alarms.get(0).channelId);
    }

    @Test
    public void fileChannelIsDroppedWithoutARootAndAlarmFallsBackToDefault() {
        // 單參數 fromJson 沒有 root：等同舊版讀到新版寫入的頻道 —— 剔除，鬧鐘落回預設頻道
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(FILE_CHANNEL_JSON);
        assertEquals(2, config.channels.size());
        assertEquals("鬧鐘 MUST NOT 因頻道消失而不見", 1, config.alarms.size());
        assertEquals(NEWS, config.alarms.get(0).channelId);
    }

    @Test
    public void filePathsOutsideTheRootAreDroppedAndEmptyChannelDisappears() {
        String mixed = j("{'schemaVersion':2,'channels':[{'id':'f1','kind':'file',"
                + "'files':[{'path':'/storage/emulated/0/Music/x.mp3'},{'path':'" + ROOT + "/f1/002_b.mp3'}]}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(mixed, ROOT);
        RadioAlarmConfig.Channel f1 = config.channelById("f1");
        assertEquals("越界的路徑剔除、其餘保留", 1, f1.files.size());
        assertEquals("002_b.mp3", f1.files.get(0).displayName);
        assertEquals("沒有名稱時用第一個檔案的顯示名稱", "002_b.mp3", f1.name);

        String allOutside = j("{'schemaVersion':2,'channels':[{'id':'f2','kind':'file',"
                + "'files':[{'path':'/sdcard/a.mp3'}]}],'alarms':[{'id':'a','time':'06:00','channelId':'f2'}]}");
        RadioAlarmConfig config2 = RadioAlarmConfig.fromJson(allOutside, ROOT);
        assertFalse("清單剔到空即剔除整個頻道", config2.hasChannel("f2"));
        assertEquals(NEWS, config2.alarms.get(0).channelId);

        String emptyList = j("{'schemaVersion':2,'channels':[{'id':'f3','kind':'file','files':[]}]}");
        assertFalse(RadioAlarmConfig.fromJson(emptyList, ROOT).hasChannel("f3"));
    }

    @Test
    public void unknownKindIsDropped() {
        String json = j("{'schemaVersion':2,'channels':[{'id':'x','name':'X','kind':'weird','source':'s'}],"
                + "'alarms':[{'id':'a','time':'06:00','channelId':'x'}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json, ROOT);
        assertEquals(2, config.channels.size());
        assertEquals(NEWS, config.alarms.get(0).channelId);
    }

    @Test
    public void streamChannelsIgnoreTheRoot() {
        // bcc 與 url 的 source 行為不因 root 參數而改變
        String json = j("{'schemaVersion':2,'channels':[{'id':'c1','name':'我的台','kind':'url','source':'https://example.com/a.aac'}]}");
        RadioAlarmConfig withRoot = RadioAlarmConfig.fromJson(json, ROOT);
        RadioAlarmConfig withoutRoot = RadioAlarmConfig.fromJson(json);
        assertEquals("https://example.com/a.aac", withRoot.channelById("c1").source);
        assertEquals("https://example.com/a.aac", withoutRoot.channelById("c1").source);
        assertTrue(withRoot.channelById("c1").files.isEmpty());
        assertTrue(withRoot.channelById(NEWS).files.isEmpty());
    }

    @Test
    public void fileChannelSurvivesRoundTrip() {
        RadioAlarmConfig original = RadioAlarmConfig.fromJson(FILE_CHANNEL_JSON, ROOT);
        String persisted = original.toJson();
        assertTrue(persisted.contains("\"files\""));

        RadioAlarmConfig restored = RadioAlarmConfig.fromJson(persisted, ROOT);
        RadioAlarmConfig.Channel f1 = restored.channelById("f1");
        assertEquals(RadioAlarmConfig.CHANNEL_KIND_FILE, f1.kind);
        assertEquals("早晨歌單", f1.name);
        assertEquals(3, f1.files.size());
        for (int i = 0; i < 3; i++) {
            assertEquals(original.channels.get(2).files.get(i).path, f1.files.get(i).path);
            assertEquals(original.channels.get(2).files.get(i).displayName, f1.files.get(i).displayName);
        }
        assertEquals("f1", restored.alarms.get(0).channelId);
    }

    // ---- 股票報價頻道（design.md D16）----

    @Test
    public void stockSymbolsAreNormalized() {
        assertEquals("2330", RadioAlarmConfig.normalizeStockSymbol(" 2330 "));
        assertEquals("0050B", RadioAlarmConfig.normalizeStockSymbol("0050b"));
        assertNull(RadioAlarmConfig.normalizeStockSymbol("23-30"));
        assertNull(RadioAlarmConfig.normalizeStockSymbol("台積電"));
        assertNull(RadioAlarmConfig.normalizeStockSymbol(""));
        assertNull(RadioAlarmConfig.normalizeStockSymbol("12345678901"));
        assertNull(RadioAlarmConfig.normalizeStockSymbol(null));
    }

    @Test
    public void parsesStockChannelAndApiKeyDroppingBadOrDuplicateSymbols() {
        String json = j("{'schemaVersion':2,'fugleApiKey':' abc123 ',"
                + "'channels':[{'id':'s1','name':'','kind':'stock','source':'',"
                + "'stocks':[{'symbol':'2330','name':'台積電'},{'symbol':'2330'},{'symbol':'x!'},{'symbol':'2317','name':'鴻海'}]}],"
                + "'alarms':[{'id':'a','time':'06:00','channelId':'s1'}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json, ROOT);
        assertEquals("abc123", config.fugleApiKey);

        RadioAlarmConfig.Channel s1 = config.channelById("s1");
        assertTrue(s1.isStock());
        assertFalse(s1.isBuiltIn());
        assertEquals("沒有名稱時用預設", "股市晨報", s1.name);
        assertEquals("重複與不合法的代號剔除", 2, s1.stocks.size());
        assertEquals("2330", s1.stocks.get(0).symbol);
        assertEquals("台積電", s1.stocks.get(0).name);
        assertEquals("2317", s1.stocks.get(1).symbol);
        assertEquals("s1", config.alarms.get(0).channelId);
    }

    @Test
    public void stockPauseIsClampedAndRoundTripped() {
        assertEquals(1.0, RadioAlarmConfig.clampPauseSeconds(Double.NaN), 0.0001);
        assertEquals("不允許 0：兩句會黏在一起", 1.0, RadioAlarmConfig.clampPauseSeconds(0), 0.0001);
        assertEquals(1.0, RadioAlarmConfig.clampPauseSeconds(-3), 0.0001);
        assertEquals(99.0, RadioAlarmConfig.clampPauseSeconds(99), 0.0001);
        assertEquals(600.0, RadioAlarmConfig.clampPauseSeconds(9999), 0.0001);
        assertEquals("整數秒", 3.0, RadioAlarmConfig.clampPauseSeconds(2.54), 0.0001);
        assertEquals(2.0, RadioAlarmConfig.clampPauseSeconds(2.2), 0.0001);

        String json = j("{'schemaVersion':2,'channels':[{'id':'s1','kind':'stock','stocks':[],'pauseSeconds':3}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json, ROOT);
        assertEquals(3.0, config.channelById("s1").pauseSeconds, 0.0001);
        assertEquals(3.0, RadioAlarmConfig.fromJson(config.toJson(), ROOT).channelById("s1").pauseSeconds, 0.0001);

        String missing = j("{'schemaVersion':2,'channels':[{'id':'s2','kind':'stock','stocks':[]}]}");
        assertEquals("缺欄位用預設 1 秒", 1.0, RadioAlarmConfig.fromJson(missing, ROOT).channelById("s2").pauseSeconds, 0.0001);
    }

    @Test
    public void emptyStockChannelIsKeptSoItCanSpeakTheProblem() {
        String json = j("{'schemaVersion':2,'channels':[{'id':'s1','name':'晨報','kind':'stock','stocks':[]}]}");
        RadioAlarmConfig config = RadioAlarmConfig.fromJson(json, ROOT);
        assertTrue(config.hasChannel("s1"));
        assertTrue(config.channelById("s1").stocks.isEmpty());
    }

    @Test
    public void stockChannelSurvivesRoundTrip() {
        String json = j("{'schemaVersion':2,'fugleApiKey':'k','channels':[{'id':'s1','name':'晨報','kind':'stock',"
                + "'stocks':[{'symbol':'2330','name':'台積電'},{'symbol':'00878','name':'國泰永續高股息'}]}]}");
        RadioAlarmConfig original = RadioAlarmConfig.fromJson(json, ROOT);
        RadioAlarmConfig restored = RadioAlarmConfig.fromJson(original.toJson(), ROOT);
        assertEquals("k", restored.fugleApiKey);
        RadioAlarmConfig.Channel s1 = restored.channelById("s1");
        assertEquals(2, s1.stocks.size());
        assertEquals("00878", s1.stocks.get(1).symbol);
        assertEquals("國泰永續高股息", s1.stocks.get(1).name);
        assertTrue("其他種類的 stocks 為空", restored.channelById(NEWS).stocks.isEmpty());
    }
}
