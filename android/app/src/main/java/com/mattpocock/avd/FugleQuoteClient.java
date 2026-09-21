package com.mattpocock.avd;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * 富果（Fugle）行情 API 的報價查詢。
 *
 * 端點：GET https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/{symbol}
 * 驗證：X-API-KEY 標頭（使用者於 developer.fugle.tw 申請，存於原生端設定）。
 * 2026-09-21 依官方文件確認欄位：name、closePrice、lastPrice、previousClose、change、
 * changePercent、date、isClose、lastUpdated。
 *
 * fetch 碰網路；parseQuote 為純函式（只吃字串），JUnit 釘住「錯誤回應不會被念成股價」。
 */
public final class FugleQuoteClient {

    public static final String QUOTE_URL_PREFIX = "https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/";

    private FugleQuoteClient() {
    }

    /** 一支股票的查詢結果：成功時有價格與漲跌；失敗時 ok=false 且 error 為可念出的原因。 */
    public static final class StockQuote {
        public final String symbol;
        /** 名稱：API 回傳者優先，否則用設定中的名稱，再否則用代號。 */
        public final String name;
        public final boolean ok;
        public final double price;
        /** 相對前收的漲跌金額；正為漲、負為跌、0 為平盤。 */
        public final double change;
        public final double changePercent;
        /** 交易日 yyyy-MM-dd；取不到為空字串。 */
        public final String date;
        /** 是否已收盤。 */
        public final boolean isClose;
        public final String error;

        private StockQuote(String symbol, String name, boolean ok, double price, double change,
                           double changePercent, String date, boolean isClose, String error) {
            this.symbol = symbol;
            this.name = name;
            this.ok = ok;
            this.price = price;
            this.change = change;
            this.changePercent = changePercent;
            this.date = date == null ? "" : date;
            this.isClose = isClose;
            this.error = error == null ? "" : error;
        }

        public static StockQuote failed(String symbol, String fallbackName, String error) {
            String name = fallbackName == null || fallbackName.trim().isEmpty() ? symbol : fallbackName.trim();
            return new StockQuote(symbol, name, false, 0, 0, 0, "", false, error);
        }
    }

    /** HTTP 回應（狀態碼與內容），供 parse 分辨「金鑰錯」「代號錯」與「連不上」。 */
    public static final class Response {
        public final int code;
        public final String body;

        public Response(int code, String body) {
            this.code = code;
            this.body = body == null ? "" : body;
        }
    }

    /**
     * 自 API 回應解析一支股票的報價。純函式。
     *
     * @param symbol       查詢的代號
     * @param fallbackName 設定中的名稱（API 沒回名稱時用）
     * @param response     HTTP 回應；null 代表完全連不上
     */
    public static StockQuote parseQuote(String symbol, String fallbackName, Response response) {
        if (response == null) return StockQuote.failed(symbol, fallbackName, "連不上富果伺服器");

        JSONObject root;
        try {
            root = new JSONObject(response.body);
        } catch (JSONException e) {
            return StockQuote.failed(symbol, fallbackName, "回應無法解析（HTTP " + response.code + "）");
        }

        if (response.code < 200 || response.code >= 300) {
            String message = root.optString("message", "").trim();
            if (response.code == 401 || response.code == 403) {
                return StockQuote.failed(symbol, fallbackName, "富果 API 金鑰無效或未授權");
            }
            if (response.code == 404) {
                return StockQuote.failed(symbol, fallbackName, "找不到這個代號");
            }
            if (response.code == 429) {
                return StockQuote.failed(symbol, fallbackName, "查詢次數超過富果的限制");
            }
            return StockQuote.failed(symbol, fallbackName,
                    message.isEmpty() ? "富果回應 HTTP " + response.code : message);
        }

        String name = root.optString("name", "").trim();
        if (name.isEmpty()) name = fallbackName == null || fallbackName.trim().isEmpty() ? symbol : fallbackName.trim();

        double previousClose = root.optDouble("previousClose", Double.NaN);
        double price = positiveOrNaN(root.optDouble("closePrice", Double.NaN));
        if (Double.isNaN(price)) price = positiveOrNaN(root.optDouble("lastPrice", Double.NaN));
        if (Double.isNaN(price)) price = positiveOrNaN(previousClose);
        if (Double.isNaN(price)) {
            return StockQuote.failed(symbol, name, "回應中沒有價格");
        }

        double change = root.optDouble("change", Double.NaN);
        if (Double.isNaN(change)) {
            change = Double.isNaN(previousClose) ? 0 : price - previousClose;
        }
        double changePercent = root.optDouble("changePercent", Double.NaN);
        if (Double.isNaN(changePercent)) {
            changePercent = (Double.isNaN(previousClose) || previousClose == 0) ? 0 : change / previousClose * 100;
        }

        return new StockQuote(symbol, name, true, price, change, changePercent,
                root.optString("date", ""), root.optBoolean("isClose", false), "");
    }

    /**
     * 逐支查詢。這個方法會碰網路，MUST NOT 在主執行緒呼叫。
     * 沒有金鑰時不發任何請求，每支都以「尚未設定金鑰」失敗 —— 交由口說稿統一說明。
     */
    public static List<StockQuote> fetchAll(List<RadioAlarmConfig.StockItem> stocks, String apiKey) {
        List<StockQuote> results = new ArrayList<StockQuote>();
        boolean hasKey = apiKey != null && !apiKey.trim().isEmpty();
        for (RadioAlarmConfig.StockItem item : stocks) {
            if (!hasKey) {
                results.add(StockQuote.failed(item.symbol, item.name, "尚未設定富果 API 金鑰"));
                continue;
            }
            results.add(parseQuote(item.symbol, item.name, fetch(item.symbol, apiKey.trim())));
        }
        return results;
    }

    /** 查一支。任何連線層的失敗回傳 null（連不上）；HTTP 錯誤照樣回傳 code 與內容供 parse 分辨。 */
    public static Response fetch(String symbol, String apiKey) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(QUOTE_URL_PREFIX + symbol);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("X-API-KEY", apiKey);
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(RadioAlarmConstants.API_TIMEOUT_MS);
            conn.setReadTimeout(RadioAlarmConstants.API_TIMEOUT_MS);
            conn.setUseCaches(false);

            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = "";
            if (in != null) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    if (out.size() > 256 * 1024) break; // 一支股票的報價不該有這麼大
                }
                in.close();
                body = out.toString("UTF-8");
            }
            return new Response(code, body);
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static double positiveOrNaN(double value) {
        return (Double.isNaN(value) || value <= 0) ? Double.NaN : value;
    }
}
