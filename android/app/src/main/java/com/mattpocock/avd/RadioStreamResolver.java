package com.mattpocock.avd;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 決定「這次要播哪一個網址」—— 按頻道。
 *
 * 退回鏈（見 design.md D4）：
 *
 * <pre>
 *   自訂頻道  ----------------------------->  直接用其網址（不查官方）
 *   內建頻道  查官方端點（逾時 5 秒），依頻道名稱挑
 *               成功 -> 播放並記為該頻道的 last_good_url
 *               失敗 -> 該頻道的 last_good_url -> 該頻道的內建常數
 *   檔案頻道  ----------------------------->  清單中存在且可讀的副本（不碰網路、沒有退回）
 * </pre>
 *
 * 檔案頻道**沒有退回鏈**（design.md D15）：使用者選了本地檔案就是不想聽電台，
 * 讀不到時回傳空清單交由播放端判定失敗，MUST NOT 改播其他頻道。
 *
 * pickStreamUrl 為純函式（只吃字串、不碰網路與 Android API），可被 JUnit 釘住；
 * resolve 才碰網路。分開的理由是「從回應中挑哪一個網址」有明確的優先順序，
 * 而它出錯的方式是靜默的 —— 挑錯不會有例外，只會在早上放出別台的節目。
 */
public final class RadioStreamResolver {

    private RadioStreamResolver() {
    }

    /**
     * 本次播放要用的來源。
     *
     * 直播是單一網址；檔案頻道是有序的本機絕對路徑清單。兩者都以字串清單表達，
     * 讓播放端只有一種輸入 —— 分成兩個方法就會出現兩條播放路徑（紅線 2）。
     */
    public static final class Resolution {
        /** 網址（直播）或本機絕對路徑（檔案）；為空即代表沒有任何可播的來源。 */
        public final List<String> sources;
        /** 是否為本機檔案：播放端據此決定循環、停用影像軌、錯誤即失敗。 */
        public final boolean local;
        /** 檔案頻道中不存在或不可讀而被跳過的數量；直播恆為 0。 */
        public final int missingCount;

        public Resolution(List<String> sources, boolean local, int missingCount) {
            this.sources = Collections.unmodifiableList(new ArrayList<String>(sources));
            this.local = local;
            this.missingCount = missingCount;
        }

        public boolean isEmpty() {
            return sources.isEmpty();
        }
    }

    /**
     * 自官方端點的回應中挑出指定頻道的串流網址。
     *
     * 順序：該頻道的 iosStream（https）→ androidStream（https）→ iosStream（http）
     * → androidStream（http）。優先 https 的理由是官方的 android 欄位目前給的是明文 http。
     *
     * @param json    ChannelInfoBat 的回應
     * @param apiName 回應中 name 欄位要完全相同的頻道名稱
     * @return 串流網址；回應不可解析、找不到該頻道或該頻道無可用網址時回傳 null
     */
    public static String pickStreamUrl(String json, String apiName) {
        if (json == null || json.trim().isEmpty()) return null;
        if (apiName == null || apiName.trim().isEmpty()) return null;
        String wanted = apiName.trim();

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
            if (!wanted.equals(name)) continue;

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
     * 取得本次播放要用的來源，依退回鏈決定。
     *
     * 這個方法對內建頻道會碰網路，MUST NOT 在主執行緒呼叫。
     *
     * @param store   供讀取與回寫該頻道的 last_good_url
     * @param channel 要播的頻道
     * @return 直播頻道一定回傳一個可嘗試的網址（最差為該頻道的內建常數）——
     *         「查不到來源」不該是一種失敗，真正的失敗是「連不上」，那由播放端判定。
     *         檔案頻道回傳存在且可讀的副本；一個都沒有時回傳空清單，播放端據此失敗
     */
    public static Resolution resolve(RadioAlarmStore store, RadioAlarmConfig.Channel channel) {
        if (channel.isLocalFile()) {
            return resolveLocal(channel);
        }
        return new Resolution(Collections.singletonList(resolveStreamUrl(store, channel)), false, 0);
    }

    /**
     * 檔案頻道：逐一檢查清單中的副本是否存在且可讀，保留順序、跳過讀不到的。
     * 不碰網路、沒有退回鏈。抽成獨立方法以便在 JVM 以暫存檔測試。
     */
    public static Resolution resolveLocal(RadioAlarmConfig.Channel channel) {
        List<String> playable = new ArrayList<String>();
        int missing = 0;
        for (RadioAlarmConfig.LocalFile f : channel.files) {
            File file = new File(f.path);
            if (file.isFile() && file.canRead() && file.length() > 0) {
                playable.add(file.getAbsolutePath());
            } else {
                missing++;
            }
        }
        return new Resolution(playable, true, missing);
    }

    /** 直播頻道的網址，依 D4 的退回鏈。 */
    private static String resolveStreamUrl(RadioAlarmStore store, RadioAlarmConfig.Channel channel) {
        if (!channel.isBuiltIn()) {
            return channel.source.trim();
        }

        String fetched = pickStreamUrl(fetchChannelInfo(), channel.source);
        if (fetched != null) {
            store.setLastGoodUrl(channel.id, fetched);
            return fetched;
        }

        String lastGood = store.getLastGoodUrl(channel.id);
        if (lastGood != null && !lastGood.trim().isEmpty()) {
            return lastGood.trim();
        }

        return RadioAlarmConstants.fallbackStreamUrlFor(channel.id);
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
