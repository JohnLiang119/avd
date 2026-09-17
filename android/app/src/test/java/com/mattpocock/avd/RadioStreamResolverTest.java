package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * 自官方端點的回應中挑出「中廣新聞網」的串流網址。
 *
 * 挑錯不會有例外，只會在早上放出別台的節目，或什麼都沒放 —— 故以實測回應樣本釘住。
 */
public class RadioStreamResolverTest {

    /**
     * 2026-09-17 自 ChannelInfoBat 實測取得的回應（保留五個頻道的順序與欄位，
     * 節目資訊等與本功能無關的欄位已略去）。目標頻道刻意不排在第一個 ——
     * 實際回應中它排第三，而「挑第一個」這種寫法正好會在這裡被抓到。
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
    public void picksTheTargetChannelFromTheRealResponse() {
        assertEquals("https://stream.rcs.revma.com/fgtx07f3qtzuv",
                RadioStreamResolver.pickStreamUrl(REAL_SAMPLE));
    }

    @Test
    public void prefersHttpsOverThePlaintextAndroidField() {
        String json = ("[{'name':'中廣新聞網',"
                + "'androidStream':'http://plain.example.com/a',"
                + "'iosStream':'https://secure.example.com/b'}]").replace('\'', '"');
        assertEquals("https://secure.example.com/b", RadioStreamResolver.pickStreamUrl(json));
    }

    @Test
    public void fallsBackToAndroidFieldWhenIosIsMissing() {
        String json = ("[{'name':'中廣新聞網',"
                + "'androidStream':'https://secure.example.com/a'}]").replace('\'', '"');
        assertEquals("https://secure.example.com/a", RadioStreamResolver.pickStreamUrl(json));
    }

    @Test
    public void acceptsPlaintextWhenNothingSecureIsOffered() {
        String json = ("[{'name':'中廣新聞網',"
                + "'androidStream':'http://plain.example.com/a',"
                + "'iosStream':''}]").replace('\'', '"');
        assertEquals("http://plain.example.com/a", RadioStreamResolver.pickStreamUrl(json));
    }

    @Test
    public void toleratesSurroundingWhitespaceInTheChannelName() {
        String json = ("[{'name':'  中廣新聞網  ',"
                + "'iosStream':'https://secure.example.com/b'}]").replace('\'', '"');
        assertEquals("https://secure.example.com/b", RadioStreamResolver.pickStreamUrl(json));
    }

    @Test
    public void absentWhenTheTargetChannelHasNoUsableUrl() {
        String json = ("[{'name':'中廣新聞網','androidStream':'','iosStream':''}]").replace('\'', '"');
        assertNull(RadioStreamResolver.pickStreamUrl(json));

        String rtmpOnly = ("[{'name':'中廣新聞網','androidStream':'rtmp://x/y'}]").replace('\'', '"');
        assertNull(RadioStreamResolver.pickStreamUrl(rtmpOnly));
    }

    @Test
    public void absentWhenTheTargetChannelIsNotInTheResponse() {
        String json = ("[{'name':'中廣流行網',"
                + "'iosStream':'https://stream.rcs.revma.com/s1zttsg3qtzuv'}]").replace('\'', '"');
        assertNull(RadioStreamResolver.pickStreamUrl(json));
    }

    @Test
    public void absentOnUnusableInput() {
        assertNull(RadioStreamResolver.pickStreamUrl(null));
        assertNull(RadioStreamResolver.pickStreamUrl(""));
        assertNull(RadioStreamResolver.pickStreamUrl("   "));
        assertNull(RadioStreamResolver.pickStreamUrl("not json at all"));
        assertNull(RadioStreamResolver.pickStreamUrl("[]"));
        assertNull(RadioStreamResolver.pickStreamUrl("{}"));
        assertNull(RadioStreamResolver.pickStreamUrl("[null,null]"));
        assertNull(RadioStreamResolver.pickStreamUrl("[1,2,3]"));
    }
}
