package com.mattpocock.avd;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * 把多支股票的報價組成一段**要念出來**的繁體中文。
 *
 * 純函式、不匯入 Android API，JUnit 釘住。寫法以「念出來聽得懂」為準，不是給人看的：
 * 百分比寫成「百分之 1.01」而非「1.01%」（語音引擎對 % 的念法不一），
 * 數字去掉多餘的零（1000 而非 1000.0），每支股票一句、句尾句號讓引擎停頓。
 *
 * 全部失敗時仍回傳一段話 —— 鬧鐘的第一要務是把人叫醒，聽到「無法取得股價」
 * 比一片安靜好；成敗另由 {@link #allFailed} 判定並記進上次結果。
 */
public final class StockReportScript {

    private StockReportScript() {
    }

    /** 這個頻道一支股票都沒有時念的話。 */
    public static final String EMPTY_CHANNEL_TEXT = "這個頻道尚未加入任何股票。";

    /**
     * 組稿。
     *
     * @param channelName 頻道名稱，作為開場
     * @param quotes      逐支查詢結果（含失敗的）
     */
    public static String build(String channelName, List<FugleQuoteClient.StockQuote> quotes) {
        String title = channelName == null || channelName.trim().isEmpty() ? "股市報價" : channelName.trim();
        if (quotes == null || quotes.isEmpty()) {
            return title + "。" + EMPTY_CHANNEL_TEXT;
        }

        List<FugleQuoteClient.StockQuote> ok = new ArrayList<FugleQuoteClient.StockQuote>();
        List<FugleQuoteClient.StockQuote> failed = new ArrayList<FugleQuoteClient.StockQuote>();
        for (FugleQuoteClient.StockQuote q : quotes) {
            if (q.ok) ok.add(q);
            else failed.add(q);
        }

        StringBuilder sb = new StringBuilder();
        sb.append(title).append("。");

        if (ok.isEmpty()) {
            // 全部失敗：把原因念出來。同一個原因只念一次（例如金鑰沒設，每支都是同一句）。
            sb.append("無法取得股價。");
            List<String> reasons = new ArrayList<String>();
            for (FugleQuoteClient.StockQuote q : failed) {
                if (!q.error.isEmpty() && !reasons.contains(q.error)) reasons.add(q.error);
            }
            for (String reason : reasons) {
                sb.append(reason).append("。");
            }
            return sb.toString();
        }

        String date = formatDate(ok.get(0).date);
        if (!date.isEmpty()) sb.append("資料日期 ").append(date).append("。");

        for (FugleQuoteClient.StockQuote q : ok) {
            sb.append(q.name).append("，");
            sb.append(q.isClose ? "收盤 " : "目前 ").append(formatNumber(q.price)).append(" 元，");
            if (Math.abs(q.change) < 0.0001) {
                sb.append("平盤。");
            } else {
                boolean up = q.change > 0;
                sb.append(up ? "上漲 " : "下跌 ").append(formatNumber(Math.abs(q.change))).append(" 元，");
                sb.append(up ? "漲幅百分之 " : "跌幅百分之 ").append(formatNumber(Math.abs(q.changePercent))).append("。");
            }
        }

        if (!failed.isEmpty()) {
            sb.append("另有 ").append(failed.size()).append(" 支無法取得報價：");
            for (int i = 0; i < failed.size(); i++) {
                if (i > 0) sb.append("、");
                sb.append(failed.get(i).name);
            }
            sb.append("。");
        }

        sb.append("以上是 ").append(ok.size()).append(" 支股票的報價。");
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

    /** yyyy-MM-dd → 「9 月 19 日」；格式不符回傳空字串（不念）。 */
    public static String formatDate(String isoDate) {
        if (isoDate == null) return "";
        String[] parts = isoDate.trim().split("-");
        if (parts.length != 3) return "";
        try {
            int month = Integer.parseInt(parts[1]);
            int day = Integer.parseInt(parts[2]);
            if (month < 1 || month > 12 || day < 1 || day > 31) return "";
            return month + " 月 " + day + " 日";
        } catch (NumberFormatException e) {
            return "";
        }
    }
}
