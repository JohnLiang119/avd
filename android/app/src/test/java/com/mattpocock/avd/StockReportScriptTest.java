package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 股票報價的解析與口說稿。
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
    public void numbersAreSpokenWithoutTrailingZerosOrPercentSigns() {
        assertEquals("1000", StockReportScript.formatNumber(1000.0));
        assertEquals("52.35", StockReportScript.formatNumber(52.35));
        assertEquals("0.5", StockReportScript.formatNumber(0.5));
        assertEquals("1.01", StockReportScript.formatNumber(1.005));
        assertEquals("0", StockReportScript.formatNumber(Double.NaN));
        assertEquals("9 月 19 日", StockReportScript.formatDate("2026-09-19"));
        assertEquals("", StockReportScript.formatDate("bad"));
        assertEquals("", StockReportScript.formatDate(null));
    }

    @Test
    public void scriptReadsEachStockOnceWithDirectionAndPercent() {
        List<FugleQuoteClient.StockQuote> quotes = new ArrayList<FugleQuoteClient.StockQuote>();
        quotes.add(FugleQuoteClient.parseQuote("2330", "", ok(TSMC_JSON)));
        quotes.add(FugleQuoteClient.parseQuote("2317", "", ok(j(
                "{'name':'鴻海','previousClose':200,'closePrice':198,'change':-2,'changePercent':-1,'date':'2026-09-19','isClose':true}"))));
        quotes.add(FugleQuoteClient.parseQuote("2412", "", ok(j(
                "{'name':'中華電','previousClose':120,'closePrice':120,'change':0,'changePercent':0,'date':'2026-09-19','isClose':true}"))));

        String text = StockReportScript.build("股市晨報", quotes);
        assertTrue(text.startsWith("股市晨報。資料日期 9 月 19 日。"));
        assertTrue(text.contains("台積電，收盤 1000 元，上漲 10 元，漲幅百分之 1.01。"));
        assertTrue(text.contains("鴻海，收盤 198 元，下跌 2 元，跌幅百分之 1。"));
        assertTrue(text.contains("中華電，收盤 120 元，平盤。"));
        assertTrue(text.endsWith("以上是 3 支股票的報價。"));
        assertFalse("念出來的稿不該出現 % 符號", text.contains("%"));
        assertFalse(StockReportScript.allFailed(quotes));
    }

    @Test
    public void partialFailureIsSpokenAndCounted() {
        List<FugleQuoteClient.StockQuote> quotes = new ArrayList<FugleQuoteClient.StockQuote>();
        quotes.add(FugleQuoteClient.parseQuote("2330", "", ok(TSMC_JSON)));
        quotes.add(FugleQuoteClient.parseQuote("9999", "", new FugleQuoteClient.Response(404, "{}")));

        String text = StockReportScript.build("晨報", quotes);
        assertTrue(text.contains("另有 1 支無法取得報價：9999。"));
        assertTrue(text.endsWith("以上是 1 支股票的報價。"));
        assertFalse("有一支成功就不算全部失敗", StockReportScript.allFailed(quotes));
    }

    @Test
    public void totalFailureStillProducesSomethingToSay() {
        List<FugleQuoteClient.StockQuote> quotes = new ArrayList<FugleQuoteClient.StockQuote>();
        quotes.add(FugleQuoteClient.parseQuote("2330", "台積電", null));
        quotes.add(FugleQuoteClient.parseQuote("2317", "鴻海", null));

        String text = StockReportScript.build("晨報", quotes);
        assertTrue(text.contains("無法取得股價。"));
        assertEquals("同一個原因只念一次", 1, text.split("連不上富果伺服器").length - 1);
        assertTrue(StockReportScript.allFailed(quotes));
        assertTrue(StockReportScript.describeFailures(quotes).contains("2330 連不上富果伺服器"));
    }

    @Test
    public void emptyChannelIsSpokenNotFailed() {
        List<FugleQuoteClient.StockQuote> none = new ArrayList<FugleQuoteClient.StockQuote>();
        assertTrue(StockReportScript.build("晨報", none).contains(StockReportScript.EMPTY_CHANNEL_TEXT));
        assertFalse(StockReportScript.allFailed(none));
    }
}
