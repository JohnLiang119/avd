package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 股票報價的解析、口說稿與停頓用的靜音檔。
 *
 * 這裡的失敗方式都是靜默的：挑錯欄位不會有例外，只會在早上念出錯的數字；
 * 錯誤回應若被當成報價，會念出「0 元」。所以逐條釘住。
 */
public class StockReportScriptTest {

    private static String j(String singleQuoted) {
        return singleQuoted.replace('\'', '"');
    }

    /** 2026-09-21 依官方文件範例整理（欄位名稱與型別相同，數字為範例）。 */
    private static final String TSMC_JSON = j("{'date':'2026-09-19','type':'EQUITY','exchange':'TWSE','market':'TSE',"
            + "'symbol':'2330','name':'台積電','referencePrice':990,'previousClose':990,'openPrice':995,"
            + "'highPrice':1005,'lowPrice':992,'closePrice':1000,'change':10,'changePercent':1.01,"
            + "'lastPrice':1000,'isClose':true,'lastUpdated':1789999200000000}");

    private static FugleQuoteClient.Response ok(String body) {
        return new FugleQuoteClient.Response(200, body);
    }

    // ---- 解析 ----

    @Test
    public void parsesTheDocumentedShape() {
        FugleQuoteClient.StockQuote q = FugleQuoteClient.parseQuote("2330", "", ok(TSMC_JSON));
        assertTrue(q.ok);
        assertEquals("台積電", q.name);
        assertEquals(1000, q.price, 0.0001);
        assertEquals(10, q.change, 0.0001);
        assertEquals(1.01, q.changePercent, 0.0001);
        assertEquals("2026-09-19", q.date);
        assertTrue(q.isClose);
    }

    @Test
    public void fallsBackToLastPriceThenPreviousCloseAndComputesChange() {
        String intraday = j("{'symbol':'2330','name':'台積電','previousClose':990,'lastPrice':1000,'isClose':false}");
        FugleQuoteClient.StockQuote q = FugleQuoteClient.parseQuote("2330", "", ok(intraday));
        assertTrue(q.ok);
        assertEquals(1000, q.price, 0.0001);
        assertEquals("沒有 change 欄位時自前收計算", 10, q.change, 0.0001);
        assertEquals(1.0101, q.changePercent, 0.001);
        assertFalse(q.isClose);

        String preOpen = j("{'symbol':'2330','name':'台積電','previousClose':990}");
        FugleQuoteClient.StockQuote q2 = FugleQuoteClient.parseQuote("2330", "", ok(preOpen));
        assertTrue(q2.ok);
        assertEquals(990, q2.price, 0.0001);
        assertEquals(0, q2.change, 0.0001);
    }

    @Test
    public void errorResponsesAreNeverReadAsPrices() {
        FugleQuoteClient.StockQuote unauthorized = FugleQuoteClient.parseQuote("2330", "台積電",
                new FugleQuoteClient.Response(401, j("{'statusCode':401,'message':'Unauthorized'}")));
        assertFalse(unauthorized.ok);
        assertTrue(unauthorized.error.contains("金鑰"));
        assertEquals("失敗時沿用設定中的名稱", "台積電", unauthorized.name);

        FugleQuoteClient.StockQuote notFound = FugleQuoteClient.parseQuote("9999", "",
                new FugleQuoteClient.Response(404, j("{'statusCode':404,'message':'Not Found'}")));
        assertFalse(notFound.ok);
        assertTrue(notFound.error.contains("代號"));
        assertEquals("沒有名稱時用代號", "9999", notFound.name);

        FugleQuoteClient.StockQuote offline = FugleQuoteClient.parseQuote("2330", "", null);
        assertFalse(offline.ok);

        FugleQuoteClient.StockQuote garbage = FugleQuoteClient.parseQuote("2330", "", ok("<html>"));
        assertFalse(garbage.ok);

        FugleQuoteClient.StockQuote noPrice = FugleQuoteClient.parseQuote("2330", "", ok(j("{'name':'台積電'}")));
        assertFalse(noPrice.ok);
    }

    @Test
    public void missingKeyFailsEveryStockWithoutTouchingTheNetwork() {
        List<RadioAlarmConfig.StockItem> stocks = Arrays.asList(
                new RadioAlarmConfig.StockItem("2330", "台積電"),
                new RadioAlarmConfig.StockItem("2317", "鴻海"));
        List<FugleQuoteClient.StockQuote> quotes = FugleQuoteClient.fetchAll(stocks, "");
        assertEquals(2, quotes.size());
        for (FugleQuoteClient.StockQuote q : quotes) {
            assertFalse(q.ok);
            assertTrue(q.error.contains("金鑰"));
        }
        assertTrue(StockReportScript.allFailed(quotes));
    }

    // ---- 口說稿 ----

    @Test
    public void numbersAreSpokenWithoutTrailingZeros() {
        assertEquals("1000", StockReportScript.formatNumber(1000.0));
        assertEquals("52.35", StockReportScript.formatNumber(52.35));
        assertEquals("0.5", StockReportScript.formatNumber(0.5));
        assertEquals("1.01", StockReportScript.formatNumber(1.005));
        assertEquals("0", StockReportScript.formatNumber(Double.NaN));
    }

    @Test
    public void scriptIsJustNameAndPricePerStockInOrder() {
        // 使用者要的形式：「南亞 213。台化 89。」循環 —— 沒有開場、日期、漲跌、結尾
        List<FugleQuoteClient.StockQuote> quotes = new ArrayList<FugleQuoteClient.StockQuote>();
        quotes.add(FugleQuoteClient.parseQuote("1303", "", ok(j(
                "{'name':'南亞','previousClose':210,'closePrice':213,'change':3,'changePercent':1.43,'date':'2026-09-19','isClose':true}"))));
        quotes.add(FugleQuoteClient.parseQuote("1326", "", ok(j(
                "{'name':'台化','previousClose':90,'closePrice':89,'change':-1,'changePercent':-1.11,'date':'2026-09-19','isClose':true}"))));

        assertEquals(Arrays.asList("南亞 213。", "台化 89。"), StockReportScript.buildSentences(quotes));
        assertEquals("南亞 213。台化 89。", StockReportScript.build(quotes));
        assertFalse(StockReportScript.allFailed(quotes));
    }

    @Test
    public void partialFailureKeepsItsSlot() {
        List<FugleQuoteClient.StockQuote> quotes = new ArrayList<FugleQuoteClient.StockQuote>();
        quotes.add(FugleQuoteClient.parseQuote("2330", "", ok(TSMC_JSON)));
        quotes.add(FugleQuoteClient.parseQuote("9999", "", new FugleQuoteClient.Response(404, "{}")));

        assertEquals(Arrays.asList("台積電 1000。", "9999 無法取得。"), StockReportScript.buildSentences(quotes));
        assertFalse("有一支成功就不算全部失敗", StockReportScript.allFailed(quotes));
    }

    @Test
    public void totalFailureStillProducesSomethingToSay() {
        List<FugleQuoteClient.StockQuote> quotes = new ArrayList<FugleQuoteClient.StockQuote>();
        quotes.add(FugleQuoteClient.parseQuote("2330", "台積電", null));
        quotes.add(FugleQuoteClient.parseQuote("2317", "鴻海", null));

        List<String> sentences = StockReportScript.buildSentences(quotes);
        assertEquals("同一個原因只念一次", Arrays.asList("無法取得股價。", "連不上富果伺服器。"), sentences);
        assertTrue(StockReportScript.allFailed(quotes));
        assertTrue(StockReportScript.describeFailures(quotes).contains("2330 連不上富果伺服器"));
    }

    @Test
    public void emptyChannelIsSpokenNotFailed() {
        List<FugleQuoteClient.StockQuote> none = new ArrayList<FugleQuoteClient.StockQuote>();
        assertEquals(Arrays.asList(StockReportScript.EMPTY_CHANNEL_TEXT), StockReportScript.buildSentences(none));
        assertFalse(StockReportScript.allFailed(none));
    }

    // ---- 停頓用的靜音檔 ----

    @Test
    public void silenceWavHasAValidHeaderAndExactLength() throws IOException {
        File out = File.createTempFile("avd-silence", ".wav");
        out.deleteOnExit();

        File written = SilenceWav.write(out, 1.5);
        int dataBytes = SilenceWav.dataBytesFor(1.5);
        assertEquals("16 kHz 單聲道 16 位元：1.5 秒 = 48000 位元組", 48000, dataBytes);
        assertEquals(44L + dataBytes, written.length());

        byte[] header = SilenceWav.header(dataBytes);
        assertEquals('R', header[0]);
        assertEquals('W', header[8]);
        assertEquals("PCM", 1, header[20]);
        assertEquals("data 長度小端序", (byte) (dataBytes & 0xff), header[40]);

        assertEquals("零秒與負數不產生樣本", 0, SilenceWav.dataBytesFor(0));
        assertEquals(0, SilenceWav.dataBytesFor(-1));
    }
}
