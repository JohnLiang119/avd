package com.mattpocock.avd;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 決定「這次要播哪一個網址」。
 *
 * 退回鏈（見 design.md D4）：
 *
 * <pre>
 *   自訂網址有值  ---------------------->  直接用（不查官方）
 *   否則  查官方端點（逾時 5 秒）
 *           成功 -> 播放並記為 last_good_url
 *           失敗 -> last_good_url -> 內建常數
 * </pre>
 *
 * pickStreamUrl 為純函式（只吃字串、不碰網路與 Android API），可被 JUnit 釘住；
 * resolve 才碰網路。分開的理由是「從回應中挑哪一個網址」有明確的優先順序，
 * 而它出錯的方式同樣是靜默的 —— 挑錯不會有例外，只會在早上放出別台的節目。
 */
public final class RadioStreamResolver {

    private RadioStreamResolver() {
    }

    /**
     * 自官方端點的回應中挑出目標頻道的串流網址。
     *
     * 順序：目標頻道的 iosStream（https）→ androidStream（https）→ iosStream（http）
     * → androidStream（http）。優先 https 的理由是官方的 android 欄位目前給的是明文 http。
     *
     * @return 串流網址；回應不可解析、找不到該頻道或該頻道無可用網址時回傳 null
     */
    public static String pickStreamUrl(String json) {
        if (json == null || json.trim().isEmpty()) return null;

        JSONArray arr;
        try {
            arr = new JSONArray(json);
        } catch (JSONException e) {
            return null;
        }

        for (int i = 0; i < arr.length(); i++) {
            JSONObject channel = arr.optJSONObject(i);
            if (channel == null) continue;

            String name = channel.optString("name", "").trim();
            if (!RadioAlarmConstants.TARGET_CHANNEL_NAME.equals(name)) continue;

            String ios = channel.optString("iosStream", "").trim();
            String android = channel.optString("androidStream", "").trim();

            if (isHttps(ios)) return ios;
            if (isHttps(android)) return android;
            if (isHttp(ios)) return ios;
            if (isHttp(android)) return android;
            return null;
        }
        return null;
    }

    /**
     * 取得本次播放要用的網址，依退回鏈決定。
     *
     * 這個方法會碰網路，MUST NOT 在主執行緒呼叫。
     *
     * @param store 供讀取自訂網址與 last_good_url，並於成功時回寫
     * @return 一定回傳可嘗試的網址（最差為內建常數），不會回傳 null ——
     *         「查不到來源」不該是一種失敗，真正的失敗是「連不上」，那由播放端判定
     */
    public static String resolve(RadioAlarmStore store) {
        String custom = store.getConfig().customStreamUrl;
        if (custom != null && !custom.trim().isEmpty()) {
            return custom.trim();
        }

        String fetched = pickStreamUrl(fetchChannelInfo());
        if (fetched != null) {
            store.setLastGoodUrl(fetched);
            return fetched;
        }

        String lastGood = store.getLastGoodUrl();
        if (lastGood != null && !lastGood.trim().isEmpty()) {
            return lastGood.trim();
        }

        return RadioAlarmConstants.FALLBACK_STREAM_URL;
    }

    /** 查詢官方端點。任何失敗都回傳 null 交由呼叫端退回，不向上拋。 */
    private static String fetchChannelInfo() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(RadioAlarmConstants.CHANNEL_INFO_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(RadioAlarmConstants.API_TIMEOUT_MS);
            conn.setReadTimeout(RadioAlarmConstants.API_TIMEOUT_MS);
            conn.setUseCaches(false);

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;

            InputStream in = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                if (out.size() > 512 * 1024) break; // 防呆：這份回應不該有這麼大
            }
            in.close();
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static boolean isHttps(String url) {
        return url != null && url.startsWith("https://");
    }

    private static boolean isHttp(String url) {
        return url != null && url.startsWith("http://");
    }
}
