package com.mattpocock.avd;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * 廣播鬧鐘的設定：鬧鐘清單、頻道清單、音量比例。
 *
 * 模型以**鬧鐘為主體**（design.md D14）：一筆鬧鐘 = 時刻 + 星期 + 頻道 + 時長 + 啟用，
 * 頻道是鬧鐘的屬性而非容器。頻道有三種來源：官方 API（bcc）、自訂串流（url）、
 * 複製進私有目錄的本地檔案清單（file，design.md D15）。沒有總開關 —— 每筆自有開關，清單預設為空即達成
 * 「升級後不會無預警響」。
 *
 * 這個類別刻意**不匯入任何 Android API**（只用 org.json 與 java.util），使其可在
 * JVM 單元測試中直接驗證。fromJson 一律**不拋例外**：它面對的是可能被外力改壞的
 * 持久化內容，壞掉的項目會被剔除或校正，其餘維持可用。
 *
 * 權威來源在原生端（見 config-persistence 規格的「原生端為權威來源的設定」）。
 */
public final class RadioAlarmConfig {

    /** 目前的格式版本。低於此版本的內容走 {@link #migrateLegacy} 一次性遷移。 */
    public static final int SCHEMA_VERSION = 2;

    /** 星期遮罩：bit 0 = 週日 … bit 6 = 週六，與 Calendar.DAY_OF_WEEK - 1 及 JS Date.getDay() 一致。 */
    public static final int ALL_WEEKDAYS = 0x7F;

    // ---- 頻道 ----

    /** 頻道的來源種類。 */
    public static final String CHANNEL_KIND_BCC = "bcc";
    public static final String CHANNEL_KIND_URL = "url";
    /** 本地檔案頻道：一份複製進私有目錄的有序播放清單（design.md D15）。 */
    public static final String CHANNEL_KIND_FILE = "file";
    /** 股票報價頻道：觸發時向富果 API 抓多支股票的報價，文字轉語音念出（design.md D16）。 */
    public static final String CHANNEL_KIND_STOCK = "stock";

    /** 股票報價頻道中的一支股票。name 是使用者加入時查到的名稱，供介面與口說稿失敗時使用。 */
    public static final class StockItem {
        public final String symbol;
        public final String name;

        public StockItem(String symbol, String name) {
            this.symbol = symbol == null ? "" : symbol.trim().toUpperCase(Locale.US);
            this.name = name == null ? "" : name.trim();
        }
    }

    /** 股票代號：1–10 個英數字（台股四碼數字為主，ETF 可能帶字母，如 00878、0050B）。 */
    public static String normalizeStockSymbol(String raw) {
        if (raw == null) return null;
        String text = raw.trim().toUpperCase(Locale.US);
        if (text.isEmpty() || text.length() > 10) return null;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            boolean digit = c >= '0' && c <= '9';
            boolean upper = c >= 'A' && c <= 'Z';
            if (!digit && !upper) return null;
        }
        return text;
    }

    /**
     * 本地檔案頻道中的一個檔案。
     *
     * path 是私有目錄下副本的絕對路徑；displayName 是選檔當下取得的原始檔名，
     * 只供介面與通知顯示，不參與任何路徑運算。
     */
    public static final class LocalFile {
        public final String path;
        public final String displayName;

        public LocalFile(String path, String displayName) {
            this.path = path == null ? "" : path.trim();
            String name = displayName == null ? "" : displayName.trim();
            this.displayName = name.isEmpty() ? baseName(this.path) : name;
        }

        private static String baseName(String path) {
            int slash = path.lastIndexOf('/');
            return slash < 0 ? path : path.substring(slash + 1);
        }
    }

    /**
     * 一個可播放的頻道。
     *
     * 內建頻道（kind = bcc）的 source 是官方 API 回應中的頻道名稱，串流網址於每次
     * 觸發時解析；自訂頻道（kind = url）的 source 就是串流網址本身。
     */
    public static final class Channel {
        public final String id;
        public final String name;
        public final String kind;
        /**
         * bcc：官方 API 的頻道名稱；url：串流網址；file：顯示用摘要（不參與播放）。
         * file 種類實際要播的內容在 {@link #files}。
         */
        public final String source;
        /** 本地檔案頻道的有序播放清單；其他種類為空清單。順序即播放順序，MUST NOT 重排。 */
        public final List<LocalFile> files;
        /** 股票報價頻道的股票清單（念的順序）；其他種類為空清單。允許為空 —— 念「尚未加入任何股票」。 */
        public final List<StockItem> stocks;
        /** 股票報價頻道句與句之間的停頓（整數秒，1–600）；其他種類無意義。 */
        public final double pauseSeconds;

        public Channel(String id, String name, String kind, String source) {
            this(id, name, kind, source, null, null, RadioAlarmConstants.DEFAULT_STOCK_PAUSE_SECONDS);
        }

        public Channel(String id, String name, String kind, String source, List<LocalFile> files) {
            this(id, name, kind, source, files, null, RadioAlarmConstants.DEFAULT_STOCK_PAUSE_SECONDS);
        }

        public Channel(String id, String name, String kind, String source, List<LocalFile> files,
                       List<StockItem> stocks, double pauseSeconds) {
            this.id = id;
            this.name = name;
            this.kind = kind;
            this.source = source;
            this.files = Collections.unmodifiableList(
                    files == null ? new ArrayList<LocalFile>() : new ArrayList<LocalFile>(files));
            this.stocks = Collections.unmodifiableList(
                    stocks == null ? new ArrayList<StockItem>() : new ArrayList<StockItem>(stocks));
            this.pauseSeconds = clampPauseSeconds(pauseSeconds);
        }

        public boolean isBuiltIn() {
            return CHANNEL_KIND_BCC.equals(kind);
        }

        public boolean isLocalFile() {
            return CHANNEL_KIND_FILE.equals(kind);
        }

        public boolean isStock() {
            return CHANNEL_KIND_STOCK.equals(kind);
        }
    }

    /** 內建頻道。順序即介面順序；第一個是新增鬧鐘與試播的預設頻道。 */
    public static List<Channel> builtInChannels() {
        List<Channel> list = new ArrayList<Channel>();
        list.add(new Channel(RadioAlarmConstants.CHANNEL_NEWS_ID, RadioAlarmConstants.CHANNEL_NEWS_API_NAME,
                CHANNEL_KIND_BCC, RadioAlarmConstants.CHANNEL_NEWS_API_NAME));
        list.add(new Channel(RadioAlarmConstants.CHANNEL_POP_ID, RadioAlarmConstants.CHANNEL_POP_API_NAME,
                CHANNEL_KIND_BCC, RadioAlarmConstants.CHANNEL_POP_API_NAME));
        return list;
    }

    // ---- 鬧鐘 ----

    /** 一筆鬧鐘。 */
    public static final class Alarm {
        /** 穩定識別，用於排程與取消 —— 兩筆同時刻的鬧鐘正是靠它區分。 */
        public final String id;
        /** 觸發時刻，已正規化為 HH:mm。 */
        public final String time;
        /** 星期遮罩，見 {@link #ALL_WEEKDAYS}；必非零。 */
        public final int weekdays;
        public final String channelId;
        public final int durationMin;
        public final boolean enabled;

        public Alarm(String id, String time, int weekdays, String channelId, int durationMin, boolean enabled) {
            this.id = id;
            this.time = time;
            this.weekdays = normalizeWeekdays(weekdays);
            this.channelId = channelId;
            this.durationMin = clampDuration(durationMin);
            this.enabled = enabled;
        }
    }

    public final List<Alarm> alarms;
    public final List<Channel> channels;
    /**
     * 應用程式內的音量比例（0–100）。
     *
     * 這是**在系統音量之下**的縮放，不是系統音量本身：改系統音量會連使用者真正的
     * 鬧鐘一起改掉，那是替他做了沒要求的決定（見 design.md D11）。
     */
    public final int volumePercent;
    /**
     * 富果 API 金鑰（全域，所有股票報價頻道共用）。存在這裡而非前端：鬧鐘觸發時
     * WebView 沒在跑，原生端要自己拿得到。空字串代表未設定。
     */
    public final String fugleApiKey;

    public RadioAlarmConfig(List<Alarm> alarms, List<Channel> channels, int volumePercent) {
        this(alarms, channels, volumePercent, "");
    }

    public RadioAlarmConfig(List<Alarm> alarms, List<Channel> channels, int volumePercent, String fugleApiKey) {
        this.alarms = Collections.unmodifiableList(new ArrayList<Alarm>(alarms));
        this.channels = Collections.unmodifiableList(ensureBuiltIns(channels));
        this.volumePercent = clampVolume(volumePercent);
        this.fugleApiKey = fugleApiKey == null ? "" : fugleApiKey.trim();
    }

    /** 全新安裝的預設值：**沒有任何鬧鐘**、兩個內建頻道、音量 100%。 */
    public static RadioAlarmConfig defaults() {
        return new RadioAlarmConfig(new ArrayList<Alarm>(), builtInChannels(),
                RadioAlarmConstants.DEFAULT_VOLUME_PERCENT);
    }

    /** 實際會被排程的鬧鐘。 */
    public List<Alarm> enabledAlarms() {
        List<Alarm> list = new ArrayList<Alarm>();
        for (Alarm a : alarms) {
            if (a.enabled) list.add(a);
        }
        return list;
    }

    /** 第一個內建頻道：新增鬧鐘與試播的預設，也是無效頻道參照的落點。 */
    public Channel defaultChannel() {
        for (Channel c : channels) {
            if (c.isBuiltIn()) return c;
        }
        return channels.get(0);
    }

    /**
     * 依 id 取頻道；找不到時回傳預設頻道 —— 鬧鐘 MUST NOT 因頻道消失而失效。
     */
    public Channel channelById(String id) {
        if (id != null) {
            for (Channel c : channels) {
                if (c.id.equals(id)) return c;
            }
        }
        return defaultChannel();
    }

    public boolean hasChannel(String id) {
        if (id == null) return false;
        for (Channel c : channels) {
            if (c.id.equals(id)) return true;
        }
        return false;
    }

    /** 播放器要套用的增益（0.0–1.0）。 */
    public float volumeGain() {
        return volumePercent / 100f;
    }

    // ---- 時間、星期、時長、音量的把關 ----

    /**
     * 將時間字串解析為「當日第幾分鐘」。
     *
     * @return 0..1439；不合法時回傳 -1（不拋例外：呼叫端多半在批次處理整份清單）
     */
    public static int parseTimeToMinutes(String raw) {
        if (raw == null) return -1;
        String text = raw.trim();
        int colon = text.indexOf(':');
        if (colon <= 0 || colon == text.length() - 1) return -1;

        String hourPart = text.substring(0, colon).trim();
        String minutePart = text.substring(colon + 1).trim();
        if (!isAsciiDigits(hourPart) || !isAsciiDigits(minutePart)) return -1;
        if (hourPart.length() > 2 || minutePart.length() > 2) return -1;

        int hour = Integer.parseInt(hourPart);
        int minute = Integer.parseInt(minutePart);
        if (hour > 23 || minute > 59) return -1;
        return hour * 60 + minute;
    }

    /** 正規化為 HH:mm；不合法時回傳 null。 */
    public static String normalizeTime(String raw) {
        int minutes = parseTimeToMinutes(raw);
        if (minutes < 0) return null;
        return String.format(Locale.US, "%02d:%02d", minutes / 60, minutes % 60);
    }

    /**
     * 星期遮罩的校正：空遮罩或越界位元一律回到全選。
     *
     * 空遮罩在鬧鐘 App 通常代表「只響一次」，對廣播用處不大且容易被誤認為壞了；
     * 介面不允許取消最後一天，這裡是最後一道防守。
     */
    public static int normalizeWeekdays(int mask) {
        int cleaned = mask & ALL_WEEKDAYS;
        return cleaned == 0 ? ALL_WEEKDAYS : cleaned;
    }

    /** @param dayIndex 0 = 週日 … 6 = 週六 */
    public static boolean hasWeekday(int mask, int dayIndex) {
        if (dayIndex < 0 || dayIndex > 6) return false;
        return (mask & (1 << dayIndex)) != 0;
    }

    /** 播放時長夾在允許範圍內，而非丟棄整筆 —— 時長怪不該讓一筆鬧鐘消失。 */
    public static int clampDuration(int value) {
        if (value < RadioAlarmConstants.MIN_DURATION_MIN) return RadioAlarmConstants.MIN_DURATION_MIN;
        if (value > RadioAlarmConstants.MAX_DURATION_MIN) return RadioAlarmConstants.MAX_DURATION_MIN;
        return value;
    }

    /**
     * 股票報價的句間停頓：整數秒、夾在 1–600；NaN 回預設。
     * 不允許 0 —— 沒有停頓兩句會黏在一起（使用者要求）。
     */
    public static double clampPauseSeconds(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) return RadioAlarmConstants.DEFAULT_STOCK_PAUSE_SECONDS;
        double clamped = Math.max(RadioAlarmConstants.MIN_STOCK_PAUSE_SECONDS,
                Math.min(RadioAlarmConstants.MAX_STOCK_PAUSE_SECONDS, value));
        return (double) Math.round(clamped);
    }

    /** 音量比例夾在 0–100；與時長同樣是夾值而非丟棄。 */
    public static int clampVolume(int value) {
        if (value < RadioAlarmConstants.MIN_VOLUME_PERCENT) return RadioAlarmConstants.MIN_VOLUME_PERCENT;
        if (value > RadioAlarmConstants.MAX_VOLUME_PERCENT) return RadioAlarmConstants.MAX_VOLUME_PERCENT;
        return value;
    }

    /** 自訂頻道的串流網址是否可用：必須是 http(s)。 */
    public static boolean isValidStreamUrl(String raw) {
        if (raw == null) return false;
        String text = raw.trim();
        return text.startsWith("http://") || text.startsWith("https://");
    }

    /**
     * 本地檔案頻道的路徑是否可接受：**必須落在私有目錄 root 之下**，且不得含 `..` 片段。
     *
     * 這是紅線：複製進私有目錄的用意就是不引用外部檔案（見 design.md D15）；
     * 接受私有目錄以外的路徑，等於把複製要避免的所有失敗方式（權限、SD 卡、
     * 使用者整理檔案）又放回來。root 為 null 或空時一律拒絕 —— 沒有 root 就沒有
     * 「私有目錄之下」可言。
     *
     * 純字串比對，不碰檔案系統，可在 JVM 測試。
     */
    public static boolean isValidLocalFilePath(String path, String root) {
        if (path == null || root == null) return false;
        String p = path.trim();
        String r = root.trim();
        if (p.isEmpty() || r.isEmpty()) return false;
        while (r.endsWith("/") && r.length() > 1) r = r.substring(0, r.length() - 1);
        if (!p.startsWith(r + "/")) return false;
        String rest = p.substring(r.length() + 1);
        if (rest.isEmpty()) return false;
        for (String segment : rest.split("/")) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) return false;
        }
        return true;
    }

    /** 產生一筆新鬧鐘的識別。 */
    public static String newId(String time) {
        String suffix = time == null ? "x" : time.replace(":", "");
        return "t" + System.currentTimeMillis() + "_" + suffix;
    }

    // ---- 序列化 ----

    /**
     * 自持久化內容還原。**永不拋例外**：內容為 null、空、非 JSON 或結構不符時回傳預設值；
     * 個別項目不合法時剔除該項並保留其餘。舊格式（無 schemaVersion 或低於目前）
     * 走 {@link #migrateLegacy} 一次性遷移。
     */
    public static RadioAlarmConfig fromJson(String json) {
        return fromJson(json, null);
    }

    /**
     * 同 {@link #fromJson(String)}，並指定本地檔案頻道允許的私有目錄。
     *
     * @param localFileRoot 本地檔案副本所在的私有目錄絕對路徑；為 null 時所有 file 頻道
     *                      一律剔除（沒有 root 就沒有「私有目錄之下」可言），指向它們的
     *                      鬧鐘落回預設頻道
     */
    public static RadioAlarmConfig fromJson(String json, String localFileRoot) {
        if (json == null || json.trim().isEmpty()) return defaults();

        JSONObject root;
        try {
            root = new JSONObject(json);
        } catch (JSONException e) {
            return defaults();
        }

        int version = root.optInt("schemaVersion", 1);
        if (version < SCHEMA_VERSION) {
            return migrateLegacy(root);
        }

        int volume = clampVolume(root.optInt("volumePercent", RadioAlarmConstants.DEFAULT_VOLUME_PERCENT));
        String fugleApiKey = root.optString("fugleApiKey", "").trim();

        List<Channel> channels = parseChannels(root.optJSONArray("channels"), localFileRoot);
        RadioAlarmConfig scaffold = new RadioAlarmConfig(new ArrayList<Alarm>(), channels, volume);

        List<Alarm> alarms = new ArrayList<Alarm>();
        JSONArray arr = root.optJSONArray("alarms");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;

                String time = normalizeTime(item.optString("time", ""));
                if (time == null) continue;

                String id = item.optString("id", "").trim();
                if (id.isEmpty()) id = newId(time);

                // 指向不存在的頻道時落到預設頻道 —— 鬧鐘不該因頻道消失而不見
                String channelId = item.optString("channelId", "");
                if (!scaffold.hasChannel(channelId)) channelId = scaffold.defaultChannel().id;

                alarms.add(new Alarm(
                        id, time,
                        item.optInt("weekdays", ALL_WEEKDAYS),
                        channelId,
                        item.optInt("durationMin", RadioAlarmConstants.DEFAULT_DURATION_MIN),
                        item.optBoolean("enabled", true)));
            }
        }

        return new RadioAlarmConfig(alarms, channels, volume, fugleApiKey);
    }

    /**
     * 舊格式（v1.0.98～1.0.103 的「每日時間清單」）的一次性遷移。
     *
     * <pre>
     *   entries[]           -> 每筆一個 Alarm：星期全選、時長與啟用沿用
     *   customStreamUrl     -> 非空即建一個自訂頻道，所有鬧鐘指向它（舊網址對所有時間生效，行為不變）
     *   masterEnabled=false -> 全部停用（舊總開關關著就是不響）
     *   volumePercent       -> 沿用
     * </pre>
     *
     * 回傳的設定已是新格式；呼叫端寫回後 schemaVersion 即為目前版本，不會再次遷移。
     */
    static RadioAlarmConfig migrateLegacy(JSONObject root) {
        boolean master = root.optBoolean("masterEnabled", false);
        int volume = clampVolume(root.optInt("volumePercent", RadioAlarmConstants.DEFAULT_VOLUME_PERCENT));

        List<Channel> channels = builtInChannels();
        String targetChannelId = channels.get(0).id;

        String custom = root.optString("customStreamUrl", "").trim();
        if (isValidStreamUrl(custom)) {
            Channel customChannel = new Channel(
                    RadioAlarmConstants.LEGACY_CUSTOM_CHANNEL_ID, "自訂串流", CHANNEL_KIND_URL, custom);
            channels.add(customChannel);
            targetChannelId = customChannel.id;
        }

        List<Alarm> alarms = new ArrayList<Alarm>();
        JSONArray arr = root.optJSONArray("entries");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;

                String time = normalizeTime(item.optString("time", ""));
                if (time == null) continue;

                String id = item.optString("id", "").trim();
                if (id.isEmpty()) id = newId(time);

                alarms.add(new Alarm(
                        id, time, ALL_WEEKDAYS, targetChannelId,
                        item.optInt("durationMin", RadioAlarmConstants.DEFAULT_DURATION_MIN),
                        master && item.optBoolean("enabled", true)));
            }
        }

        return new RadioAlarmConfig(alarms, channels, volume);
    }

    public String toJson() {
        JSONObject root = new JSONObject();
        try {
            root.put("schemaVersion", SCHEMA_VERSION);
            root.put("volumePercent", volumePercent);
            root.put("fugleApiKey", fugleApiKey);

            JSONArray channelArr = new JSONArray();
            for (Channel c : channels) {
                JSONObject item = new JSONObject();
                item.put("id", c.id);
                item.put("name", c.name);
                item.put("kind", c.kind);
                item.put("source", c.source);
                if (c.isLocalFile()) {
                    JSONArray files = new JSONArray();
                    for (LocalFile f : c.files) {
                        JSONObject fileItem = new JSONObject();
                        fileItem.put("path", f.path);
                        fileItem.put("displayName", f.displayName);
                        files.put(fileItem);
                    }
                    item.put("files", files);
                }
                if (c.isStock()) {
                    JSONArray stocks = new JSONArray();
                    for (StockItem st : c.stocks) {
                        JSONObject stockItem = new JSONObject();
                        stockItem.put("symbol", st.symbol);
                        stockItem.put("name", st.name);
                        stocks.put(stockItem);
                    }
                    item.put("stocks", stocks);
                    item.put("pauseSeconds", c.pauseSeconds);
                }
                channelArr.put(item);
            }
            root.put("channels", channelArr);

            JSONArray alarmArr = new JSONArray();
            for (Alarm a : alarms) {
                JSONObject item = new JSONObject();
                item.put("id", a.id);
                item.put("time", a.time);
                item.put("weekdays", a.weekdays);
                item.put("channelId", a.channelId);
                item.put("durationMin", a.durationMin);
                item.put("enabled", a.enabled);
                alarmArr.put(item);
            }
            root.put("alarms", alarmArr);
        } catch (JSONException e) {
            // put 只在 key 為 null 或值為 NaN 時拋出，兩者於此皆不可能
            return "{}";
        }
        return root.toString();
    }

    // ---- 內部 ----

    /**
     * 解析頻道清單；不合法的自訂頻道剔除。內建頻道由建構子保證存在。
     *
     * file 頻道：清單非空、且每個路徑都在 localFileRoot 之下才接受；越界的路徑剔除
     * 該路徑，剔到清單為空即剔除整個頻道。**不認識的 kind 一律剔除** —— 這正是
     * 舊版讀到新版寫入的頻道時的降版安全性。
     */
    private static List<Channel> parseChannels(JSONArray arr, String localFileRoot) {
        List<Channel> list = new ArrayList<Channel>();
        if (arr == null) return list;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject item = arr.optJSONObject(i);
            if (item == null) continue;

            String id = item.optString("id", "").trim();
            String kind = item.optString("kind", "").trim();
            String source = item.optString("source", "").trim();
            String name = item.optString("name", "").trim();
            if (id.isEmpty()) continue;

            if (CHANNEL_KIND_URL.equals(kind)) {
                if (!isValidStreamUrl(source)) continue;
                list.add(new Channel(id, name.isEmpty() ? "自訂串流" : name, kind, source));
            } else if (CHANNEL_KIND_BCC.equals(kind)) {
                if (source.isEmpty()) continue;
                list.add(new Channel(id, name.isEmpty() ? source : name, kind, source));
            } else if (CHANNEL_KIND_FILE.equals(kind)) {
                List<LocalFile> files = parseLocalFiles(item.optJSONArray("files"), localFileRoot);
                if (files.isEmpty()) continue;
                list.add(new Channel(id, name.isEmpty() ? files.get(0).displayName : name, kind, source, files));
            } else if (CHANNEL_KIND_STOCK.equals(kind)) {
                // 股票清單允許為空（觸發時會念「尚未加入任何股票」）；不合法或重複的代號剔除
                List<StockItem> stocks = parseStocks(item.optJSONArray("stocks"));
                double pause = item.optDouble("pauseSeconds", RadioAlarmConstants.DEFAULT_STOCK_PAUSE_SECONDS);
                list.add(new Channel(id, name.isEmpty() ? "股市晨報" : name, kind, source, null, stocks, pause));
            }
        }
        return list;
    }

    private static List<StockItem> parseStocks(JSONArray arr) {
        List<StockItem> stocks = new ArrayList<StockItem>();
        if (arr == null) return stocks;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject item = arr.optJSONObject(i);
            if (item == null) continue;
            String symbol = normalizeStockSymbol(item.optString("symbol", ""));
            if (symbol == null) continue;
            boolean dup = false;
            for (StockItem existing : stocks) {
                if (existing.symbol.equals(symbol)) {
                    dup = true;
                    break;
                }
            }
            if (dup) continue;
            stocks.add(new StockItem(symbol, item.optString("name", "")));
        }
        return stocks;
    }

    private static List<LocalFile> parseLocalFiles(JSONArray arr, String localFileRoot) {
        List<LocalFile> files = new ArrayList<LocalFile>();
        if (arr == null) return files;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject item = arr.optJSONObject(i);
            if (item == null) continue;
            String path = item.optString("path", "").trim();
            if (!isValidLocalFilePath(path, localFileRoot)) continue;
            files.add(new LocalFile(path, item.optString("displayName", "")));
        }
        return files;
    }

    /**
     * 內建頻道 MUST 一直存在：少了它們，指向它們的鬧鐘就沒有落點。
     * 已存在同 id 的項目維持原樣（允許改名），缺的補回。
     */
    private static List<Channel> ensureBuiltIns(List<Channel> given) {
        List<Channel> result = new ArrayList<Channel>();
        List<Channel> builtIns = builtInChannels();
        for (Channel b : builtIns) {
            Channel existing = null;
            for (Channel c : given) {
                if (c.id.equals(b.id)) {
                    existing = c;
                    break;
                }
            }
            result.add(existing == null ? b : existing);
        }
        for (Channel c : given) {
            boolean isBuiltInId = false;
            for (Channel b : builtIns) {
                if (b.id.equals(c.id)) {
                    isBuiltInId = true;
                    break;
                }
            }
            if (!isBuiltInId) result.add(c);
        }
        return result;
    }

    private static boolean isAsciiDigits(String text) {
        if (text.isEmpty()) return false;
        for (int i = 0; i < text.length(); i++) {
            int c = text.charAt(i);
            if (c < 48 || c > 57) return false;
        }
        return true;
    }
}
