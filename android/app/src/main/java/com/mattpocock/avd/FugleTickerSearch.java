package com.mattpocock.avd;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 以**名稱**找股票代號：富果的 intraday/tickers 端點一次回傳整個市場的代號與名稱，
 * 抓回來（上市＋上櫃的一般股票，約三千筆、幾十 KB）快取一天，之後在本機比對。
 *
 * 端點：GET https://api.fugle.tw/marketdata/v1.0/stock/intraday/tickers?type=EQUITY&exchange=TWSE|TPEx
 * 回應：{ date, type, exchange, data: [ { symbol, name }, … ] }（2026-09-21 依官方文件確認）。
 *
 * parse 與 search 為純函式，JUnit 釘住「台積」找得到 2330、精確名稱排最前。
 */
public final class FugleTickerSearch {

    public static final String TICKERS_URL_PREFIX = "https://api.fugle.tw/marketdata/v1.0/stock/intraday/tickers?type=EQUITY&exchange=";
    public static final String[] EXCHANGES = {"TWSE", "TPEx"};
    /** 快取有效期：股票清單一天變不了幾筆，早上加股票時不必每次都抓。 */
    public static final long CACHE_TTL_MS = 24L * 60 * 60 * 1000;
    public static final int MAX_RESULTS = 10;

    private FugleTickerSearch() {
    }

    /** 自一份 tickers 回應解析出代號與名稱；回應不可解析回傳空清單。 */
    public static List<RadioAlarmConfig.StockItem> parseTickers(String json) {
        List<RadioAlarmConfig.StockItem> list = new ArrayList<RadioAlarmConfig.StockItem>();
        if (json == null || json.trim().isEmpty()) return list;
        try {
            JSONObject root = new JSONObject(json);
            JSONArray data = root.optJSONArray("data");
            if (data == null) return list;
            for (int i = 0; i < data.length(); i++) {
                JSONObject item = data.optJSONObject(i);
                if (item == null) continue;
                String symbol = RadioAlarmConfig.normalizeStockSymbol(item.optString("symbol", ""));
                String name = item.optString("name", "").trim();
                if (symbol == null || name.isEmpty()) continue;
                list.add(new RadioAlarmConfig.StockItem(symbol, name));
            }
        } catch (JSONException e) {
            return list;
        }
        return list;
    }

    /** 把多份回應（上市、上櫃）合成一份清單的 JSON，供快取。 */
    public static String mergeToCacheJson(List<RadioAlarmConfig.StockItem> items) {
        JSONArray arr = new JSONArray();
        for (RadioAlarmConfig.StockItem it : items) {
            JSONObject o = new JSONObject();
            try {
                o.put("symbol", it.symbol);
                o.put("name", it.name);
            } catch (JSONException e) {
                continue;
            }
            arr.put(o);
        }
        return arr.toString();
    }

    /** 讀回 {@link #mergeToCacheJson} 的格式。 */
    public static List<RadioAlarmConfig.StockItem> parseCacheJson(String json) {
        List<RadioAlarmConfig.StockItem> list = new ArrayList<RadioAlarmConfig.StockItem>();
        if (json == null || json.trim().isEmpty()) return list;
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String symbol = RadioAlarmConfig.normalizeStockSymbol(o.optString("symbol", ""));
                String name = o.optString("name", "").trim();
                if (symbol == null || name.isEmpty()) continue;
                list.add(new RadioAlarmConfig.StockItem(symbol, name));
            }
        } catch (JSONException e) {
            return list;
        }
        return list;
    }

    /**
     * 依名稱或代號搜尋。順序：名稱完全相同 → 名稱以查詢開頭 → 名稱包含 → 代號以查詢開頭；
     * 每一層內維持清單原順序。最多 {@link #MAX_RESULTS} 筆。空查詢回傳空清單。
     */
    public static List<RadioAlarmConfig.StockItem> search(List<RadioAlarmConfig.StockItem> all, String query) {
        List<RadioAlarmConfig.StockItem> result = new ArrayList<RadioAlarmConfig.StockItem>();
        if (all == null || query == null) return result;
        String q = query.trim();
        if (q.isEmpty()) return result;
        String qUpper = q.toUpperCase(Locale.US);

        List<RadioAlarmConfig.StockItem> exact = new ArrayList<RadioAlarmConfig.StockItem>();
        List<RadioAlarmConfig.StockItem> prefix = new ArrayList<RadioAlarmConfig.StockItem>();
        List<RadioAlarmConfig.StockItem> contains = new ArrayList<RadioAlarmConfig.StockItem>();
        List<RadioAlarmConfig.StockItem> symbolPrefix = new ArrayList<RadioAlarmConfig.StockItem>();
        for (RadioAlarmConfig.StockItem it : all) {
            if (it.name.equals(q)) exact.add(it);
            else if (it.name.startsWith(q)) prefix.add(it);
            else if (it.name.contains(q)) contains.add(it);
            else if (it.symbol.startsWith(qUpper)) symbolPrefix.add(it);
        }
        for (List<RadioAlarmConfig.StockItem> bucket : new List[]{exact, prefix, contains, symbolPrefix}) {
            for (RadioAlarmConfig.StockItem it : bucket) {
                if (result.size() >= MAX_RESULTS) return result;
                result.add(it);
            }
        }
        return result;
    }

    /**
     * 抓上市與上櫃的全部一般股票。會碰網路，MUST NOT 在主執行緒呼叫。
     *
     * @return 合併後的清單；任一交易所抓不到就略過它（另一個仍可用）；兩個都失敗回傳空清單
     */
    public static List<RadioAlarmConfig.StockItem> fetchAll(String apiKey) {
        List<RadioAlarmConfig.StockItem> all = new ArrayList<RadioAlarmConfig.StockItem>();
        for (String exchange : EXCHANGES) {
            FugleQuoteClient.Response r = FugleQuoteClient.fetchUrl(TICKERS_URL_PREFIX + exchange, apiKey);
            if (r == null || r.code < 200 || r.code >= 300) continue;
            all.addAll(parseTickers(r.body));
        }
        return all;
    }
}
