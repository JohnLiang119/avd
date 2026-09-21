package com.mattpocock.avd;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * 把多支股票的報價組成**要念出來**的句子。
 *
 * 純函式、不匯入 Android API，JUnit 釘住。**極簡**（使用者實機聽過第一版後要求）：
 * 每支只念「名稱 價格」，不念頻道名、日期、漲跌與漲跌幅 —— 那些在第一版裡讓一輪
 * 變得又長又多停頓；要看細節打開 App 就好，鬧鐘要的是一聽就知道的兩個字加一個數字。
 *
 * 回傳的是**一句一個元素的清單**，不是一段文字：句與句之間的停頓由播放端插入
 * 指定秒數的靜音（使用者要求停頓長度可調），引擎自己對句號的停頓長度不可控。
 * 播放器循環整串，聽起來就是「南亞 213。（停）台化 89。（停）南亞 213。…」。
 */
public final class StockReportScript {

    private StockReportScript() {
    }

    /** 這個頻道一支股票都沒有時念的話。 */
    public static final String EMPTY_CHANNEL_TEXT = "尚未加入任何股票。";

    /**
     * 組稿：依清單順序，每支一句「名稱 價格。」；取不到的那支念「名稱 無法取得。」，
     * 位置不變（聽的人才知道少的是哪一支）。全部失敗時念「無法取得股價。」再逐一念原因。
     *
     * @param quotes 逐支查詢結果（含失敗的）
     * @return 至少一句；每句句尾帶句號讓引擎收尾語調正確
     */
    public static List<String> buildSentences(List<FugleQuoteClient.StockQuote> quotes) {
        List<String> sentences = new ArrayList<String>();
        if (quotes == null || quotes.isEmpty()) {
            sentences.add(EMPTY_CHANNEL_TEXT);
            return sentences;
        }

        boolean anyOk = false;
        for (FugleQuoteClient.StockQuote q : quotes) {
            if (q.ok) {
                anyOk = true;
                break;
            }
        }

        if (!anyOk) {
            // 全部失敗：把原因念出來。同一個原因只念一次（例如金鑰沒設，每支都是同一句）。
            sentences.add("無法取得股價。");
            for (FugleQuoteClient.StockQuote q : quotes) {
                String reason = q.error.isEmpty() ? "" : q.error + "。";
                if (!reason.isEmpty() && !sentences.contains(reason)) sentences.add(reason);
            }
            return sentences;
        }

        for (FugleQuoteClient.StockQuote q : quotes) {
            sentences.add(q.name + " " + (q.ok ? formatNumber(q.price) : "無法取得") + "。");
        }
        return sentences;
    }

    /** 整段文字（供紀錄與測試閱讀）；播放端請用 {@link #buildSentences}。 */
    public static String build(List<FugleQuoteClient.StockQuote> quotes) {
        StringBuilder sb = new StringBuilder();
        for (String s : buildSentences(quotes)) sb.append(s);
        return sb.toString();
    }

    /** 是否連一支都沒取到（呼叫端據此把這次記為失敗）。空清單不算失敗 —— 那是設定問題，念出來就好。 */
    public static boolean allFailed(List<FugleQuoteClient.StockQuote> quotes) {
        if (quotes == null || quotes.isEmpty()) return false;
        for (FugleQuoteClient.StockQuote q : quotes) {
            if (q.ok) return false;
        }
        return true;
    }

    /** 失敗時寫進上次結果的摘要（給人看的，不是念的）。 */
    public static String describeFailures(List<FugleQuoteClient.StockQuote> quotes) {
        StringBuilder sb = new StringBuilder("股價全部取不到：");
        boolean first = true;
        for (FugleQuoteClient.StockQuote q : quotes) {
            if (!first) sb.append("；");
            first = false;
            sb.append(q.symbol).append(" ").append(q.error);
        }
        return sb.toString();
    }

    /**
     * 數字念法：最多兩位小數、去掉尾端的零與多餘的小數點。
     * 1000.0 → 1000；52.35 → 52.35；0.5 → 0.5；1.005 → 1.01（四捨五入）。
     */
    public static String formatNumber(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) return "0";
        // valueOf 走 Double.toString（1.005 就是 1.005），new BigDecimal(double) 會拿到 1.00499…而四捨五入成 1
        BigDecimal bd = BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros();
        String text = bd.toPlainString();
        return "-0".equals(text) ? "0" : text;
    }
}
