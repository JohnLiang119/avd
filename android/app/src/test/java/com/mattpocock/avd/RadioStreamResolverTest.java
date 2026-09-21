package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 自官方端點的回應中依頻道名稱挑出串流網址。
 *
 * 挑錯不會有例外，只會在早上放出別台的節目，或什麼都沒放 —— 故以實測回應樣本釘住，
 * 且新聞與流行兩個頻道都要各自挑得對。
 */
public class RadioStreamResolverTest {

    private static final String NEWS = RadioAlarmConstants.CHANNEL_NEWS_API_NAME;
    private static final String POP = RadioAlarmConstants.CHANNEL_POP_API_NAME;

    /**
     * 2026-09-17 自 ChannelInfoBat 實測取得的回應（保留五個頻道的順序與欄位，
     * 節目資訊等無關欄位已略去）。新聞網刻意不排在第一個 ——
     * 「挑第一個」這種寫法正好會在這裡被抓到。
     */
    private static final String REAL_SAMPLE = ("["
            + "{'name':'中廣流行網',"
            + "'androidStream':'http://51.81.243.60/s1zttsg3qtzuv',"
            + "'iosStream':'https://stream.rcs.revma.com/s1zttsg3qtzuv'},"
            + "{'name':'中廣音樂網',"
            + "'androidStream':'http://51.81.243.116/ks4vsmg3qtzuv',"
            + "'iosStream':'https://stream.rcs.revma.com/ks4vsmg3qtzuv'},"
            + "{'name':'中廣新聞網',"
            + "'androidStream':'http://stream.rcs.revma.com/fgtx07f3qtzuv',"
            + "'iosStream':'https://stream.rcs.revma.com/fgtx07f3qtzuv'},"
            + "{'name':'中廣鄉親網',"
            + "'androidStream':'http://51.81.243.60/p2e3rfg3qtzuv',"
            + "'iosStream':'https://stream.rcs.revma.com/p2e3rfg3qtzuv'},"
            + "{'name':'中廣 I GO',"
            + "'androidStream':'http://51.81.243.60/1qxn2vg3qtzuv',"
            + "'iosStream':'https://stream.rcs.revma.com/1qxn2vg3qtzuv'}"
            + "]").replace('\'', '"');

    @Test
    public void picksNewsFromTheRealResponse() {
        assertEquals("https://stream.rcs.revma.com/fgtx07f3qtzuv",
                RadioStreamResolver.pickStreamUrl(REAL_SAMPLE, NEWS));
    }

    @Test
    public void picksPopFromTheSameResponse() {
        assertEquals("https://stream.rcs.revma.com/s1zttsg3qtzuv",
                RadioStreamResolver.pickStreamUrl(REAL_SAMPLE, POP));
    }

    @Test
    public void builtInFallbacksMatchTheRealResponse() {
        // 內建常數是退回鏈末端；它們必須就是官方目前給的值，否則退回等於換台
        assertEquals(RadioStreamResolver.pickStreamUrl(REAL_SAMPLE, NEWS),
                RadioAlarmConstants.fallbackStreamUrlFor(RadioAlarmConstants.CHANNEL_NEWS_ID));
        assertEquals(RadioStreamResolver.pickStreamUrl(REAL_SAMPLE, POP),
                RadioAlarmConstants.fallbackStreamUrlFor(RadioAlarmConstants.CHANNEL_POP_ID));
        assertEquals("未知的頻道落到新聞網", RadioAlarmConstants.FALLBACK_STREAM_URL_NEWS,
                RadioAlarmConstants.fallbackStreamUrlFor("nope"));
    }

    @Test
    public void prefersHttpsOverThePlaintextAndroidField() {
        String json = ("[{'name':'中廣新聞網',"
                + "'androidStream':'http://plain.example.com/a',"
                + "'iosStream':'https://secure.example.com/b'}]").replace('\'', '"');
        assertEquals("https://secure.example.com/b", RadioStreamResolver.pickStreamUrl(json, NEWS));
    }

    @Test
    public void fallsBackToAndroidFieldWhenIosIsMissing() {
        String json = ("[{'name':'中廣新聞網',"
                + "'androidStream':'https://secure.example.com/a'}]").replace('\'', '"');
        assertEquals("https://secure.example.com/a", RadioStreamResolver.pickStreamUrl(json, NEWS));
    }

    @Test
    public void acceptsPlaintextWhenNothingSecureIsOffered() {
        String json = ("[{'name':'中廣新聞網',"
                + "'androidStream':'http://plain.example.com/a',"
                + "'iosStream':''}]").replace('\'', '"');
        assertEquals("http://plain.example.com/a", RadioStreamResolver.pickStreamUrl(json, NEWS));
    }

    @Test
    public void toleratesSurroundingWhitespaceInNames() {
        String json = ("[{'name':'  中廣新聞網  ',"
                + "'iosStream':'https://secure.example.com/b'}]").replace('\'', '"');
        assertEquals("https://secure.example.com/b", RadioStreamResolver.pickStreamUrl(json, NEWS));
        assertEquals("https://secure.example.com/b", RadioStreamResolver.pickStreamUrl(json, "  中廣新聞網 "));
    }

    @Test
    public void absentWhenTheChannelHasNoUsableUrl() {
        String json = ("[{'name':'中廣新聞網','androidStream':'','iosStream':''}]").replace('\'', '"');
        assertNull(RadioStreamResolver.pickStreamUrl(json, NEWS));

        String rtmpOnly = ("[{'name':'中廣新聞網','androidStream':'rtmp://x/y'}]").replace('\'', '"');
        assertNull(RadioStreamResolver.pickStreamUrl(rtmpOnly, NEWS));
    }

    @Test
    public void absentWhenTheChannelIsNotInTheResponse() {
        String json = ("[{'name':'中廣流行網',"
                + "'iosStream':'https://stream.rcs.revma.com/s1zttsg3qtzuv'}]").replace('\'', '"');
        assertNull(RadioStreamResolver.pickStreamUrl(json, NEWS));
    }

    @Test
    public void absentOnUnusableInput() {
        assertNull(RadioStreamResolver.pickStreamUrl(null, NEWS));
        assertNull(RadioStreamResolver.pickStreamUrl("", NEWS));
        assertNull(RadioStreamResolver.pickStreamUrl("not json at all", NEWS));
        assertNull(RadioStreamResolver.pickStreamUrl("[]", NEWS));
        assertNull(RadioStreamResolver.pickStreamUrl("{}", NEWS));
        assertNull(RadioStreamResolver.pickStreamUrl("[null,null]", NEWS));
        assertNull(RadioStreamResolver.pickStreamUrl(REAL_SAMPLE, null));
        assertNull(RadioStreamResolver.pickStreamUrl(REAL_SAMPLE, ""));
    }

    // ---- 檔案頻道：不碰網路、沒有退回鏈（design.md D15）----

    private static File tempFileWithBytes(String name, int size) throws IOException {
        File f = File.createTempFile("avd-radio-" + name, ".bin");
        f.deleteOnExit();
        FileOutputStream out = new FileOutputStream(f);
        try {
            out.write(new byte[size]);
        } finally {
            out.close();
        }
        return f;
    }

    private static RadioAlarmConfig.Channel fileChannel(List<RadioAlarmConfig.LocalFile> files) {
        return new RadioAlarmConfig.Channel("f1", "歌單", RadioAlarmConfig.CHANNEL_KIND_FILE, "", files);
    }

    @Test
    public void localResolutionKeepsOrderAndSkipsMissingFiles() throws IOException {
        File a = tempFileWithBytes("a", 10);
        File b = tempFileWithBytes("b", 10);
        File gone = tempFileWithBytes("gone", 10);
        assertTrue(gone.delete());

        List<RadioAlarmConfig.LocalFile> files = new ArrayList<RadioAlarmConfig.LocalFile>();
        files.add(new RadioAlarmConfig.LocalFile(a.getAbsolutePath(), "a.mp3"));
        files.add(new RadioAlarmConfig.LocalFile(gone.getAbsolutePath(), "gone.mp3"));
        files.add(new RadioAlarmConfig.LocalFile(b.getAbsolutePath(), "b.mp3"));

        RadioStreamResolver.Resolution r = RadioStreamResolver.resolveLocal(fileChannel(files));
        assertTrue(r.local);
        assertEquals("跳過讀不到的，其餘照播", 2, r.sources.size());
        assertEquals("順序 MUST 維持清單順序", a.getAbsolutePath(), r.sources.get(0));
        assertEquals(b.getAbsolutePath(), r.sources.get(1));
        assertEquals("上次結果要能載明數量", 1, r.missingCount);
    }

    @Test
    public void localResolutionWithNothingReadableIsEmptyNotAFallback() throws IOException {
        File gone = tempFileWithBytes("gone2", 10);
        assertTrue(gone.delete());
        File empty = tempFileWithBytes("empty", 0);

        List<RadioAlarmConfig.LocalFile> files = new ArrayList<RadioAlarmConfig.LocalFile>();
        files.add(new RadioAlarmConfig.LocalFile(gone.getAbsolutePath(), "gone.mp3"));
        files.add(new RadioAlarmConfig.LocalFile(empty.getAbsolutePath(), "empty.mp3"));

        RadioStreamResolver.Resolution r = RadioStreamResolver.resolveLocal(fileChannel(files));
        assertTrue("讀不到就是失敗，MUST NOT 退回電台網址", r.isEmpty());
        assertEquals(2, r.missingCount);
        assertTrue(r.local);
    }
}
