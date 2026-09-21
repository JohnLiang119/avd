package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/** 以名稱找代號：解析、快取格式、排序。挑錯代號會讓早上念出別家公司的股價，所以釘住排序。 */
public class FugleTickerSearchTest {

    private static String j(String singleQuoted) {
        return singleQuoted.replace('\'', '"');
    }

    /** 依官方文件範例的結構，內容為常見股票。 */
    private static final String TWSE = j("{'date':'2026-09-19','type':'EQUITY','exchange':'TWSE','data':["
            + "{'symbol':'0050','name':'元大台灣50'},"
            + "{'symbol':'1303','name':'南亞'},"
            + "{'symbol':'1326','name':'台化'},"
            + "{'symbol':'2330','name':'台積電'},"
            + "{'symbol':'2317','name':'鴻海'},"
            + "{'symbol':'3711','name':'日月光投控'},"
            + "{'symbol':'bad!','name':'壞代號'},"
            + "{'symbol':'9999','name':''}"
            + "]}");

    @Test
    public void parsesTickersDroppingBadRows() {
        List<RadioAlarmConfig.StockItem> list = FugleTickerSearch.parseTickers(TWSE);
        assertEquals(6, list.size());
        assertEquals("2330", list.get(3).symbol);
        assertEquals("台積電", list.get(3).name);
        assertTrue(FugleTickerSearch.parseTickers("<html>").isEmpty());
        assertTrue(FugleTickerSearch.parseTickers(null).isEmpty());
    }

    @Test
    public void cacheRoundTrip() {
        List<RadioAlarmConfig.StockItem> list = FugleTickerSearch.parseTickers(TWSE);
        String cache = FugleTickerSearch.mergeToCacheJson(list);
        List<RadioAlarmConfig.StockItem> back = FugleTickerSearch.parseCacheJson(cache);
        assertEquals(list.size(), back.size());
        for (int i = 0; i < list.size(); i++) {
            assertEquals(list.get(i).symbol, back.get(i).symbol);
            assertEquals(list.get(i).name, back.get(i).name);
        }
    }

    @Test
    public void searchRanksExactThenPrefixThenContainsThenSymbol() {
        List<RadioAlarmConfig.StockItem> all = FugleTickerSearch.parseTickers(TWSE);

        List<RadioAlarmConfig.StockItem> tsmc = FugleTickerSearch.search(all, "台積電");
        assertEquals(1, tsmc.size());
        assertEquals("2330", tsmc.get(0).symbol);

        List<RadioAlarmConfig.StockItem> partial = FugleTickerSearch.search(all, "台");
        assertEquals("名稱以「台」開頭的先，含「台」的後", "台化", partial.get(0).name);
        assertEquals("台積電", partial.get(1).name);
        assertEquals("元大台灣50", partial.get(2).name);

        List<RadioAlarmConfig.StockItem> bySymbol = FugleTickerSearch.search(all, "23");
        assertEquals(2, bySymbol.size());
        assertEquals("2330", bySymbol.get(0).symbol);
        assertEquals("2317", bySymbol.get(1).symbol);

        assertTrue(FugleTickerSearch.search(all, "").isEmpty());
        assertTrue(FugleTickerSearch.search(all, "不存在").isEmpty());
        assertTrue(FugleTickerSearch.search(null, "台").isEmpty());
    }
}
