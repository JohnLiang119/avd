package com.mattpocock.avd;

import android.os.Environment;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLException;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import com.yausername.ffmpeg.FFmpeg;

import java.io.File;
import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import android.net.wifi.WifiManager;

@CapacitorPlugin(name = "YoutubeDl")
public class YoutubeDlPlugin extends Plugin {

    private LocalFileServer localServer;

    private static final String TAG = "YoutubeDlPlugin";
    private boolean isInitialized = false;

    @Override
    public void load() {
        super.load();
        try {
            YoutubeDL.getInstance().init(getContext());
            FFmpeg.getInstance().init(getContext());
            CronetDownloader.init(getContext());
            isInitialized = true;
            Log.d(TAG, "YoutubeDL, FFmpeg and Cronet initialized successfully.");
        } catch (YoutubeDLException e) {
            Log.e(TAG, "failed to initialize youtubedl-android", e);
        }
    }

    @PluginMethod
    public void getSharedUrl(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("url", MainActivity.sharedText);
        MainActivity.sharedText = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void parsePlaylist(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Must provide an url");
            return;
        }

        new Thread(() -> {
            try {
                YoutubeDLRequest request = new YoutubeDLRequest(url);
                request.addOption("--flat-playlist");
                request.addOption("-J");
                request.addOption("--no-warnings");

                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request);
                String jsonStr = response.getOut();

                org.json.JSONObject data = new org.json.JSONObject(jsonStr);
                String channelName = data.optString("uploader", data.optString("channel", data.optString("uploader_id", "頻道主")));
                String rawTitle = data.optString("title", "播放清單");
                String channelTitle = channelName;
                String playlistTitle = rawTitle;

                org.json.JSONArray entries = data.optJSONArray("entries");
                if (entries == null && (data.has("id") || data.has("url"))) {
                    entries = new org.json.JSONArray();
                    entries.put(data);
                }

                com.getcapacitor.JSArray itemsArr = new com.getcapacitor.JSArray();

                if (entries != null) {
                    processEntriesHelper(url, entries, itemsArr);
                }

                JSObject ret = new JSObject();
                ret.put("channelTitle", channelTitle);
                ret.put("playlistTitle", playlistTitle);
                ret.put("items", itemsArr);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Failed to parse playlist", e);
                call.reject("解析播放清單失敗: " + e.getMessage());
            }
        }).start();
    }

    private void processEntriesHelper(String originalUrl, org.json.JSONArray entries, com.getcapacitor.JSArray itemsArr) throws Exception {
        for (int i = 0; i < entries.length(); i++) {
            org.json.JSONObject entry = entries.getJSONObject(i);
            String rawItemTitle = entry.optString("title", entry.optString("fulltitle", "影片 " + (i + 1)));
            String itemTitle = rawItemTitle;
            String videoId = entry.optString("id", entry.optString("url", String.valueOf(i)));
            String itemUrl = entry.optString("url", entry.optString("webpage_url", ""));
            String entryType = entry.optString("_type", "");
            String ieKey = entry.optString("ie_key", "");

            boolean isSubPlaylist = entryType.equals("playlist") ||
                                   entryType.equals("multi_video") ||
                                   ieKey.equals("YoutubePlaylist") ||
                                   ieKey.equals("YoutubeTab") ||
                                   (itemUrl != null && (itemUrl.contains("list=PL") || itemUrl.contains("/playlist?list="))) ||
                                   (videoId != null && videoId.startsWith("PL"));

            if (isSubPlaylist && (itemUrl != null || videoId != null)) {
                try {
                    String subUrl = (itemUrl != null && itemUrl.startsWith("http"))
                            ? itemUrl
                            : "https://www.youtube.com/playlist?list=" + (videoId != null ? videoId : itemUrl);
                    YoutubeDLRequest subReq = new YoutubeDLRequest(subUrl);
                    subReq.addOption("--flat-playlist");
                    subReq.addOption("-J");
                    subReq.addOption("--no-warnings");

                    YoutubeDLResponse subResp = YoutubeDL.getInstance().execute(subReq);
                    org.json.JSONObject subData = new org.json.JSONObject(subResp.getOut());
                    org.json.JSONArray subEntries = subData.optJSONArray("entries");
                    if (subEntries != null && subEntries.length() > 0) {
                        processEntriesHelper(originalUrl, subEntries, itemsArr);
                        continue;
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to expand sub-playlist in Android: " + itemUrl, e);
                }
            }

            if (!itemUrl.startsWith("http")) {
                String targetId = itemUrl.isEmpty() ? videoId : itemUrl;
                if (originalUrl.contains("douyin.com")) {
                    itemUrl = "https://www.douyin.com/video/" + targetId;
                } else if (originalUrl.contains("tiktok.com")) {
                    itemUrl = "https://www.tiktok.com/video/" + targetId;
                } else {
                    itemUrl = "https://www.youtube.com/watch?v=" + targetId;
                }
            }

            double duration = entry.optDouble("duration", 0);
            String durationStr = "";
            if (duration > 0) {
                int mins = (int) (duration / 60);
                int secs = (int) (duration % 60);
                durationStr = mins + ":" + (secs < 10 ? "0" : "") + secs;
            }

            JSObject itemObj = new JSObject();
            itemObj.put("id", videoId);
            itemObj.put("url", itemUrl);
            itemObj.put("title", itemTitle);
            itemObj.put("durationStr", durationStr);
            itemsArr.put(itemObj);
        }
    }

    private String parseDeviceName(String ua) {
        if (ua == null) return "未知設備";
        ua = ua.toLowerCase();
        if (ua.contains("ipad")) return "iPad";
        if (ua.contains("iphone")) return "iPhone";
        if (ua.contains("macintosh") || ua.contains("mac os x")) return "Mac";
        if (ua.contains("windows")) return "Windows PC";
        if (ua.contains("android")) return "Android 設備";
        if (ua.contains("tizen") || ua.contains("webos") || ua.contains("smart-tv")) return "智慧電視";
        return "未知設備";
    }

    @PluginMethod
    public void resolveChannel(PluginCall call) {
        String input = call.getString("input", "");
        if (input == null || input.trim().isEmpty()) {
            call.reject("請輸入頻道網址或 ID");
            return;
        }

        new Thread(() -> {
            try {
                String raw = input.trim();
                
                // 1. 若已經是 UC 開頭的 Channel ID
                if (raw.matches("^UC[a-zA-Z0-9_-]{22}$")) {
                    JSObject ret = new JSObject();
                    ret.put("channelId", raw);
                    ret.put("title", raw);
                    ret.put("thumbnail", "");
                    call.resolve(ret);
                    return;
                }

                // 2. 若網址已包含 channel/UC...
                java.util.regex.Matcher mChan = java.util.regex.Pattern.compile("youtube\\.com/channel/(UC[a-zA-Z0-9_-]{22})", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(raw);
                if (mChan.find()) {
                    JSObject ret = new JSObject();
                    ret.put("channelId", mChan.group(1));
                    ret.put("title", mChan.group(1));
                    ret.put("thumbnail", "");
                    call.resolve(ret);
                    return;
                }

                // 3. 處理 @handle 或一般網址
                String targetUrl = raw;
                if (raw.startsWith("@")) {
                    targetUrl = "https://www.youtube.com/" + raw;
                } else if (!raw.startsWith("http")) {
                    targetUrl = "https://www.youtube.com/@" + raw;
                }

                String channelId = "";
                String title = "";
                String thumbnail = "";

                // 先透過 HttpURLConnection 嘗試高速讀取網頁
                try {
                    java.net.URL urlObj = new java.net.URL(targetUrl);
                    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) urlObj.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                    conn.setRequestProperty("Accept-Language", "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);
                    conn.setInstanceFollowRedirects(true);

                    if (conn.getResponseCode() == 200) {
                        try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                            StringBuilder sb = new StringBuilder();
                            String line;
                            while ((line = reader.readLine()) != null) {
                                sb.append(line);
                                if (sb.length() > 500000) break;
                            }
                            String html = sb.toString();
                            
                            java.util.regex.Matcher m1 = java.util.regex.Pattern.compile("\"channelId\":\\s*\"(UC[a-zA-Z0-9_-]{22})\"").matcher(html);
                            if (m1.find()) {
                                channelId = m1.group(1);
                            } else {
                                java.util.regex.Matcher m2 = java.util.regex.Pattern.compile("<meta\\s+itemprop=\"channelId\"\\s+content=\"(UC[a-zA-Z0-9_-]{22})\"").matcher(html);
                                if (m2.find()) {
                                    channelId = m2.group(1);
                                }
                            }

                            java.util.regex.Matcher mt = java.util.regex.Pattern.compile("<meta\\s+property=\"og:title\"\\s+content=\"([^\"]+)\"").matcher(html);
                            if (mt.find()) {
                                title = mt.group(1);
                            }
                            
                            java.util.regex.Matcher mi = java.util.regex.Pattern.compile("<meta\\s+property=\"og:image\"\\s+content=\"([^\"]+)\"").matcher(html);
                            if (mi.find()) {
                                thumbnail = mi.group(1);
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "HttpURLConnection fetch channel page failed, fallback to yt-dlp", e);
                }

                // 4. 若 Http 讀取未拿到 channelId，呼叫 youtubedl-android
                if (channelId == null || channelId.isEmpty()) {
                    YoutubeDLRequest request = new YoutubeDLRequest(targetUrl);
                    request.addOption("--flat-playlist");
                    request.addOption("-J");
                    request.addOption("--playlist-end", "1");
                    request.addOption("--no-warnings");

                    YoutubeDLResponse response = YoutubeDL.getInstance().execute(request);
                    String jsonStr = response.getOut();
                    org.json.JSONObject data = new org.json.JSONObject(jsonStr);

                    channelId = data.optString("channel_id", "");
                    if (channelId.isEmpty() && data.has("uploader_id")) {
                        String uid = data.optString("uploader_id", "");
                        if (uid.startsWith("UC")) channelId = uid;
                    }
                    if (title.isEmpty()) {
                        title = data.optString("uploader", data.optString("channel", raw));
                    }
                }

                if (channelId != null && !channelId.isEmpty()) {
                    JSObject ret = new JSObject();
                    ret.put("channelId", channelId);
                    ret.put("title", title.isEmpty() ? channelId : title);
                    ret.put("thumbnail", thumbnail);
                    call.resolve(ret);
                } else {
                    call.reject("無法識別 YouTube 頻道 ID，請確認頻道網址或直接提供 channel/UC... 連結");
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to resolve channel", e);
                call.reject("解析頻道失敗: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void fetchChannelRss(PluginCall call) {
        String channelId = call.getString("channelId");
        if (channelId == null || channelId.isEmpty()) {
            call.reject("Must provide channelId");
            return;
        }

        new Thread(() -> {
            try {
                String rssUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=" + java.net.URLEncoder.encode(channelId, "UTF-8");
                java.net.URL urlObj = new java.net.URL(rssUrl);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) urlObj.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                if (conn.getResponseCode() != 200) {
                    call.reject("HTTP " + conn.getResponseCode() + ": 無法獲取頻道 RSS");
                    return;
                }

                StringBuilder sb = new StringBuilder();
                try (java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                    String line;
                    while ((line = in.readLine()) != null) {
                        sb.append(line).append("\n");
                    }
                }

                JSObject ret = new JSObject();
                ret.put("xml", sb.toString());
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Failed to fetch channel RSS", e);
                call.reject("獲取頻道 RSS 失敗: " + e.getMessage());
            }
        }).start();
    }

    /**
     * 頻道新片備援抓取（RSS 異常時使用）。
     *
     * 刻意不重用 parsePlaylist：後者以 --flat-playlist 執行，該模式下 yt-dlp 不回傳
     * timestamp 與 upload_date（皆為 null），會迫使前端 fallback 至當下時間而污染
     * lastPublishedTime 基準。此處改以 --skip-download 逐一解析影片頁面取得精確發布時間。
     *
     * 回傳 NDJSON（每行一個 JSON 物件），與 Windows 端 fetch_channel_videos_fallback 對齊。
     * URL 維持 /channel/{id} 以涵蓋 Videos + Shorts；Live 分頁由前端依 playlist 欄位過濾。
     */
    @PluginMethod
    public void fetchChannelVideosFallback(PluginCall call) {
        String channelId = call.getString("channelId");
        if (channelId == null || channelId.isEmpty()) {
            call.reject("Must provide channelId");
            return;
        }

        new Thread(() -> {
            try {
                String url = "https://www.youtube.com/channel/" + channelId;
                YoutubeDLRequest request = new YoutubeDLRequest(url);
                request.addOption("--dump-json");
                request.addOption("--skip-download");
                request.addOption("--playlist-end", "2");
                request.addOption("--no-warnings");

                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request);

                JSObject ret = new JSObject();
                ret.put("ndjson", response.getOut());
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Failed to fetch channel videos fallback", e);
                call.reject("備援抓取頻道新片失敗: " + e.getMessage());
            }
        }).start();
    }

    /**
     * 查詢單支影片的直播狀態。
     *
     * auto-check-filtering 規格要求直播與排程首播不得加入下載佇列，且該排除須在
     * 所有平台一致生效。此前 Android 端缺少此能力，前端只能一律當作非直播放行，
     * 導致排程直播（開播前不存在任何可下載格式）被排入佇列並必然失敗。
     *
     * 回傳 yt-dlp 的 live_status 原始字串，由前端統一判定。
     */
    @PluginMethod
    public void checkVideoLiveStatus(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Must provide an url");
            return;
        }

        new Thread(() -> {
            try {
                YoutubeDLRequest request = new YoutubeDLRequest(url);
                request.addOption("--print", "live_status");
                request.addOption("--skip-download");
                request.addOption("--no-warnings");

                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request);
                String status = response.getOut() == null ? "" : response.getOut().trim();

                JSObject ret = new JSObject();
                ret.put("liveStatus", status);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Failed to check live status", e);
                call.reject("查詢直播狀態失敗: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void startLocalServer(PluginCall call) {
        if (localServer != null && localServer.isAlive()) {
            JSObject ret = new JSObject();
            ret.put("url", "http://" + getLocalIpAddress() + ":" + localServer.getListeningPort());
            ret.put("mdnsUrl", "");
            call.resolve(ret);
            return;
        }
        
        try {
            localServer = new LocalFileServer(getContext(), 8080, (totalSpeed, speeds, userAgents) -> {
                JSObject obj = new JSObject();
                obj.put("speed", totalSpeed);
                JSObject devicesObj = new JSObject();
                for (java.util.Map.Entry<String, Long> entry : speeds.entrySet()) {
                    String ip = entry.getKey();
                    String ua = userAgents.get(ip);
                    String friendlyName = parseDeviceName(ua);
                    devicesObj.put(ip + " (" + friendlyName + ")", entry.getValue());
                }
                obj.put("devices", devicesObj);
                notifyListeners("serverUploadSpeed", obj);
            });
            localServer.start();
            
            // 啟動 KeepAliveService 防止休眠
            android.content.Intent serviceIntent = new android.content.Intent(getContext(), KeepAliveService.class);
            serviceIntent.setAction("START");
            androidx.core.content.ContextCompat.startForegroundService(getContext(), serviceIntent);
            
            String ip = getLocalIpAddress();
            
            JSObject ret = new JSObject();
            ret.put("url", "http://" + ip + ":8080");
            ret.put("mdnsUrl", "");
            call.resolve(ret);
        } catch (Exception e) {
            String msg = e.getMessage();
            if (msg != null && (msg.contains("Address already in use") || msg.contains("EADDRINUSE"))) {
                // The port is already bound, likely by a previous instance of our own service.
                // We can assume it's running and just return the IP.
                String ip = getLocalIpAddress();
                JSObject ret = new JSObject();
                ret.put("url", "http://" + ip + ":8080");
                ret.put("mdnsUrl", "");
                call.resolve(ret);
            } else {
                call.reject("Failed to start local server", e);
            }
        }
    }
    
    @PluginMethod
    public void stopLocalServer(PluginCall call) {
        if (localServer != null) {
            localServer.stop();
            localServer = null;
            
            // 停止 KeepAliveService
            android.content.Intent stopIntent = new android.content.Intent(getContext(), KeepAliveService.class);
            stopIntent.setAction("STOP");
            getContext().startService(stopIntent);
        }

        call.resolve();
    }
    
    private String getLocalIpAddress() {
        try {
            for (Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces(); en.hasMoreElements();) {
                NetworkInterface intf = en.nextElement();
                for (Enumeration<InetAddress> enumIpAddr = intf.getInetAddresses(); enumIpAddr.hasMoreElements();) {
                    InetAddress inetAddress = enumIpAddr.nextElement();
                    if (!inetAddress.isLoopbackAddress() && inetAddress instanceof java.net.Inet4Address) {
                        String ip = inetAddress.getHostAddress();
                        if (ip != null) {
                            return ip;
                        }
                    }
                }
            }
        } catch (Exception ex) {
            Log.e(TAG, "IP Address extraction failed", ex);
        }
        return "127.0.0.1";
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (!isInitialized) {
            call.reject("YoutubeDL engine not initialized");
            return;
        }
        String url = call.getString("url");
        Boolean isMp3 = call.getBoolean("mp3", false);
        String subFolder = call.getString("subFolder", "");
        String processId = call.getString("processId", java.util.UUID.randomUUID().toString());
        String cleanSubFolder = (subFolder != null && !subFolder.isEmpty()) ? subFolder.replaceAll("[\\\\/:*?\"<>|]", "_").trim() : "";

        if (url == null || url.isEmpty()) {
            call.reject("Must provide an url");
            return;
        }

        call.setKeepAlive(true);
        
        android.content.Intent serviceIntent = new android.content.Intent(getContext(), KeepAliveService.class);
        serviceIntent.setAction("START");
        try {
            androidx.core.content.ContextCompat.startForegroundService(getContext(), serviceIntent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start Foreground Service", e);
        }

        new Thread(() -> {
            try {
                File downloadDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                
                try {
                    SharedPreferences prefs = getContext().getSharedPreferences("avd_prefs", Context.MODE_PRIVATE);
                    String lastCheck = prefs.getString("last_engine_update_check", "");
                    String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
                    
                    if (!today.equals(lastCheck)) {
                        JSObject initObj = new JSObject();
                        initObj.put("line", "正在檢查並更新核心引擎 (每日首次)...");
                        notifyListeners("downloadProgress", initObj);
                        
                        YoutubeDL.getInstance().updateYoutubeDL(getContext(), YoutubeDL.UpdateChannel.NIGHTLY.INSTANCE);
                        
                        prefs.edit().putString("last_engine_update_check", today).apply();
                        Log.d(TAG, "YoutubeDL engine update checked and updated for today: " + today);
                    } else {
                        Log.d(TAG, "YoutubeDL engine update check skipped (already checked today: " + today + ")");
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to update yt-dlp, continuing with current version", e);
                }

                Log.d(TAG, "Starting download for: " + url);
                String videoTitle = "";
                String pubTimeStr = "";
                String channelPrefix = "";
                
                String tiktokDownloadUrl = null;
                boolean isTiktok = url.contains("tiktok.com");
                
                if (isTiktok) {
                    JSObject initProgressObj = new JSObject();
                    initProgressObj.put("line", "正在透過專屬通道解析 TikTok...");
                    notifyListeners("downloadProgress", initProgressObj);
                    
                    String apiUrl = "https://www.tikwm.com/api/?url=" + java.net.URLEncoder.encode(url, "UTF-8") + "&hd=1";
                    java.net.URL apiObj = new java.net.URL(apiUrl);
                    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) apiObj.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(10000);
                    
                    StringBuilder responseBuilder = new StringBuilder();
                    try (java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()))) {
                        String inputLine;
                        while ((inputLine = in.readLine()) != null) {
                            responseBuilder.append(inputLine);
                        }
                    }
                    
                    org.json.JSONObject tikJson = new org.json.JSONObject(responseBuilder.toString());
                    if (tikJson.optInt("code", -1) != 0) {
                        throw new Exception("TikTok 解析失敗: " + tikJson.optString("msg", "未知錯誤"));
                    }
                    org.json.JSONObject tikData = tikJson.getJSONObject("data");
                    
                    videoTitle = tikData.optString("title", "");
                    long createTime = tikData.optLong("create_time", 0);
                    if (createTime > 0) {
                        try {
                            SimpleDateFormat sdf = new SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.US);
                            pubTimeStr = sdf.format(new Date(createTime * 1000L));
                        } catch (Exception ignored) {}
                    }
                    org.json.JSONObject author = tikData.optJSONObject("author");
                    if (author != null) {
                        channelPrefix = author.optString("nickname", author.optString("unique_id", ""));
                    }

                    if (isMp3 != null && isMp3) {
                        tiktokDownloadUrl = tikData.getString("music");
                    } else {
                        tiktokDownloadUrl = tikData.optString("hdplay", tikData.optString("play", ""));
                    }
                    
                    if (tiktokDownloadUrl.isEmpty()) {
                        throw new Exception("無法獲取 TikTok 下載直鏈");
                    }
                    if (tiktokDownloadUrl.startsWith("/")) {
                        tiktokDownloadUrl = "https://www.tikwm.com" + tiktokDownloadUrl;
                    }
                    
                    if (!videoTitle.isEmpty()) {
                        JSObject titleObj = new JSObject();
                        titleObj.put("title", videoTitle);
                        if (!pubTimeStr.isEmpty()) titleObj.put("publishTimeStr", pubTimeStr);
                        if (!channelPrefix.isEmpty()) titleObj.put("channelPrefix", channelPrefix);
                        notifyListeners("downloadProgress", titleObj);
                    }
                } else {
                    try {
                        com.yausername.youtubedl_android.mapper.VideoInfo info = YoutubeDL.getInstance().getInfo(url);
                        if (info != null) {
                            if (info.getTitle() != null && !info.getTitle().isEmpty()) {
                                videoTitle = info.getTitle();
                            }
                            if (info.getUploader() != null && !info.getUploader().isEmpty()) {
                                channelPrefix = info.getUploader();
                            }
                            String uploadDate = info.getUploadDate();
                            if (uploadDate != null && uploadDate.length() == 8) {
                                String y = uploadDate.substring(0, 4);
                                String m = uploadDate.substring(4, 6);
                                String d = uploadDate.substring(6, 8);
                                pubTimeStr = y + "/" + m + "/" + d + " 00:00:00";
                            }

                            JSObject titleObj = new JSObject();
                            if (!videoTitle.isEmpty()) titleObj.put("title", videoTitle);
                            if (!pubTimeStr.isEmpty()) titleObj.put("publishTimeStr", pubTimeStr);
                            if (!channelPrefix.isEmpty()) titleObj.put("channelPrefix", channelPrefix);
                            notifyListeners("downloadProgress", titleObj);
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "Could not fetch VideoInfo metadata", e);
                    }
                }

                if (videoTitle.isEmpty()) {
                    videoTitle = "video_" + System.currentTimeMillis();
                }

                String cleanTitle = videoTitle;
                cleanTitle = cleanTitle.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (cleanTitle.length() > 30) {
                    cleanTitle = cleanTitle.substring(0, 30);
                }
                cleanTitle = cleanTitle.trim();
                if (cleanTitle.isEmpty()) {
                    cleanTitle = "video_" + System.currentTimeMillis();
                }

                String targetExt = (isMp3 != null && isMp3) ? ".mp3" : ".mp4";
                String targetFilename = cleanTitle + targetExt;
                boolean isDuplicate = false;

                try {
                    android.net.Uri queryUri = (isMp3 != null && isMp3)
                        ? android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI 
                        : android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
                    String[] projection = { android.provider.MediaStore.MediaColumns.DISPLAY_NAME };
                    String selection = android.provider.MediaStore.MediaColumns.DISPLAY_NAME + " = ?";
                    String[] selectionArgs = { targetFilename };
                    try (android.database.Cursor cursor = getContext().getContentResolver().query(queryUri, projection, selection, selectionArgs, null)) {
                        if (cursor != null && cursor.getCount() > 0) {
                            isDuplicate = true;
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "MediaStore duplicate check failed, fallback to file check", e);
                }

                if (!isDuplicate) {
                    File publicDir = Environment.getExternalStoragePublicDirectory(
                        (isMp3 != null && isMp3) ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_MOVIES
                    );
                    File checkFile = new File(publicDir, targetFilename);
                    if (checkFile.exists() && checkFile.length() > 0) {
                        isDuplicate = true;
                    }
                }

                if (isDuplicate) {
                    Log.w(TAG, "Duplicate download detected: " + targetFilename);
                    throw new Exception("檔案已存在 (重複)");
                }

                File videoFile = null;
                File finalFile = null;
                String finalExt = "mp4";

                if (isTiktok) {
                    String ext = (isMp3 != null && isMp3) ? "mp3" : "mp4";
                    finalExt = ext;
                    videoFile = new File(downloadDir, cleanTitle + "_temp." + ext);
                    
                    CronetDownloader cronetDownloader = new CronetDownloader();
                    activeDownloaders.put(processId, cronetDownloader);
                    java.util.Map<String, String> headers = new java.util.HashMap<>();
                    headers.put("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36");
                    
                    downloadSync(cronetDownloader, tiktokDownloadUrl, headers, videoFile, "下載中...", processId);
                    activeDownloaders.remove(processId);
                    
                    JSObject processObj = new JSObject();
                    processObj.put("line", "正在處理影片檔案...");
                    notifyListeners("downloadProgress", processObj);
                    
                    finalFile = new File(downloadDir, cleanTitle + "." + ext);
                    videoFile.renameTo(finalFile);
                    if (videoFile.exists()) videoFile.delete();

                } else {
                    // 使用 yt-dlp 原生下載（繞過 YouTube n 參數限速）
                    YoutubeDLRequest request = new YoutubeDLRequest(url);
                    request.addOption("--no-warnings");
                    request.addOption("--retries", "3");
                    request.addOption("--fragment-retries", "3");
                    request.addOption("--extractor-retries", "3");

                    if (isMp3 != null && isMp3) {
                        finalExt = "mp3";
                        request.addOption("-x");
                        request.addOption("--audio-format", "mp3");
                        request.addOption("--audio-quality", "0"); // 增加 MP3 取樣率/音質 (0 為最高品質)
                        request.addOption("-o", new File(downloadDir, cleanTitle + ".%(ext)s").getAbsolutePath());
                    } else {
                        request.addOption("-f", "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");
                        request.addOption("--merge-output-format", "mp4");
                        request.addOption("-o", new File(downloadDir, cleanTitle + ".%(ext)s").getAbsolutePath());
                    }

                    JSObject initProgressObj = new JSObject();
                    initProgressObj.put("line", "正在解析並下載中...");
                    notifyListeners("downloadProgress", initProgressObj);

                    YoutubeDLResponse response = YoutubeDL.getInstance().execute(request, processId, (progress, etaInSeconds, line) -> {
                        JSObject progressObj = new JSObject();
                        progressObj.put("progress", (int) ((float) progress));
                        String displayLine = "下載中...";
                        String speedStr = "";
                        if (line != null && !line.isEmpty()) {
                            displayLine = line.trim();
                            // [download]   1.3% of 10.00MiB at  2.50MiB/s ETA 00:03
                            java.util.regex.Matcher m = java.util.regex.Pattern.compile("at\\s+([0-9.]+[a-zA-Z]+/s)").matcher(displayLine);
                            if (m.find()) {
                                speedStr = m.group(1);
                            }
                        }
                        progressObj.put("line", displayLine);
                        progressObj.put("speed", speedStr);
                        notifyListeners("downloadProgress", progressObj);
                        return kotlin.Unit.INSTANCE;
                    });

                    // 找到 yt-dlp 實際輸出的檔案
                    String expectedExt = (isMp3 != null && isMp3) ? "mp3" : "mp4";
                    finalFile = new File(downloadDir, cleanTitle + "." + expectedExt);
                    finalExt = expectedExt;
                    
                    // yt-dlp 有時會產生不同的副檔名，掃描目錄找到它
                    final String searchPrefix = cleanTitle;
                    if (!finalFile.exists()) {
                        File[] candidates = downloadDir.listFiles((dir, name) -> name.startsWith(searchPrefix) && !name.contains("_temp"));
                        if (candidates != null && candidates.length > 0) {
                            finalFile = candidates[0];
                            String fname = finalFile.getName();
                            int dotIdx = fname.lastIndexOf('.');
                            if (dotIdx > 0) {
                                finalExt = fname.substring(dotIdx + 1);
                            }
                        }
                    }

                    if (finalFile == null || !finalFile.exists()) {
                        throw new Exception("下載完成但找不到輸出檔案");
                    }

                    JSObject processObj = new JSObject();
                    processObj.put("line", "正在儲存至相簿...");
                    notifyListeners("downloadProgress", processObj);
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                if (!videoTitle.isEmpty()) {
                    ret.put("title", videoTitle);
                }
                if (!pubTimeStr.isEmpty()) {
                    ret.put("publishTimeStr", pubTimeStr);
                }
                if (!channelPrefix.isEmpty()) {
                    ret.put("channelPrefix", channelPrefix);
                }

                // Move to MediaStore
                android.content.ContentValues values = new android.content.ContentValues();
                android.net.Uri contentUri;
                String baseRelPath = (finalExt.equals("mp3")) ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_MOVIES;
                String fullRelPath = cleanSubFolder.isEmpty() ? baseRelPath : (baseRelPath + "/" + cleanSubFolder);

                if (finalExt.equals("mp3")) {
                    values.put(android.provider.MediaStore.Audio.Media.DISPLAY_NAME, finalFile.getName());
                    values.put(android.provider.MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg");
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                        values.put(android.provider.MediaStore.Audio.Media.RELATIVE_PATH, fullRelPath);
                    }
                    contentUri = android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
                } else {
                    values.put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, finalFile.getName());
                    if (finalExt.equals("webm")) values.put(android.provider.MediaStore.Video.Media.MIME_TYPE, "video/webm");
                    else if (finalExt.equals("mkv")) values.put(android.provider.MediaStore.Video.Media.MIME_TYPE, "video/x-matroska");
                    else values.put(android.provider.MediaStore.Video.Media.MIME_TYPE, "video/mp4");
                    
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                        values.put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, fullRelPath);
                    }
                    contentUri = android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
                }
                
                android.net.Uri uri = getContext().getContentResolver().insert(contentUri, values);
                if (uri != null) {
                    try (java.io.OutputStream out = getContext().getContentResolver().openOutputStream(uri);
                         java.io.InputStream in = new java.io.BufferedInputStream(new java.io.FileInputStream(finalFile), 8 * 1024 * 1024)) {
                        byte[] buffer = new byte[8 * 1024 * 1024]; // 8MB buffer
                        int length;
                        while ((length = in.read(buffer)) > 0) {
                            out.write(buffer, 0, length);
                        }
                    }
                    ret.put("path", (isMp3 != null && isMp3) ? "「Music/" + (cleanSubFolder.isEmpty() ? "" : cleanSubFolder + "/") + "」資料夾中" : "「Movies/" + (cleanSubFolder.isEmpty() ? "" : cleanSubFolder + "/") + "」資料夾中");
                    ret.put("mediaUri", uri.toString());
                } else {
                    File basePublicDir = Environment.getExternalStoragePublicDirectory((isMp3 != null && isMp3) ? Environment.DIRECTORY_MUSIC : Environment.DIRECTORY_MOVIES);
                    File targetPublicDir = cleanSubFolder.isEmpty() ? basePublicDir : new File(basePublicDir, cleanSubFolder);
                    if (!targetPublicDir.exists()) targetPublicDir.mkdirs();

                    File destFile = new File(targetPublicDir, finalFile.getName());
                    try (java.io.InputStream in = new java.io.BufferedInputStream(new java.io.FileInputStream(finalFile), 8 * 1024 * 1024);
                         java.io.OutputStream out = new java.io.FileOutputStream(destFile)) {
                        byte[] buffer = new byte[8 * 1024 * 1024]; // 8MB buffer
                        int length;
                        while ((length = in.read(buffer)) > 0) {
                            out.write(buffer, 0, length);
                        }
                    }
                    ret.put("path", destFile.getAbsolutePath());
                    ret.put("mediaUri", android.net.Uri.fromFile(destFile).toString());
                }
                long fileSizeBytes = finalFile.length();
                ret.put("fileSizeBytes", fileSizeBytes);
                finalFile.delete();
                ret.put("timeTaken", 0);
                
                try {
                    android.media.MediaMetadataRetriever retriever = new android.media.MediaMetadataRetriever();
                    if (uri != null) {
                        retriever.setDataSource(getContext(), uri);
                    } else if (ret.has("path") && ret.getString("path").startsWith("/")) {
                        retriever.setDataSource(ret.getString("path"));
                    }
                    
                    if (isMp3 != null && isMp3) {
                        String bitrateStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_BITRATE);
                        if (bitrateStr != null) {
                            int bitrateBps = Integer.parseInt(bitrateStr);
                            int kbps = Math.round(bitrateBps / 1000f);
                            ret.put("quality", kbps + " kbps");
                        } else {
                            ret.put("quality", "高音質");
                        }
                    } else {
                        String heightStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                        String q = "";
                        if (heightStr != null) {
                            int height = Integer.parseInt(heightStr);
                            if (height >= 2160) q = "4K";
                            else if (height >= 1080) q = "1080p";
                            else if (height >= 720) q = "720p";
                            else if (height >= 480) q = "480p";
                            else q = height + "p";
                        }
                        
                        android.media.MediaExtractor extractor = new android.media.MediaExtractor();
                        try {
                            if (ret.has("mediaUri")) {
                                android.net.Uri mediaUri = android.net.Uri.parse(ret.getString("mediaUri"));
                                extractor.setDataSource(getContext(), mediaUri, null);
                            } else if (ret.has("path") && ret.getString("path").startsWith("/")) {
                                extractor.setDataSource(ret.getString("path"));
                            }
                            for (int i = 0; i < extractor.getTrackCount(); i++) {
                                android.media.MediaFormat format = extractor.getTrackFormat(i);
                                String mime = format.getString(android.media.MediaFormat.KEY_MIME);
                                if (mime != null && mime.startsWith("video/")) {
                                    String codecName = mime.replace("video/", "").toUpperCase();
                                    if (mime.contains("avc")) codecName = "H.264";
                                    else if (mime.contains("hevc")) codecName = "H.265";
                                    else if (mime.contains("vp9")) codecName = "VP9";
                                    else if (mime.contains("av01")) codecName = "AV1";
                                    q = q + (q.isEmpty() ? "" : " ") + codecName;
                                    break;
                                }
                            }
                            extractor.release();
                        } catch (Exception ignored) {}
                        
                        ret.put("quality", q);
                    }
                    retriever.release();
                } catch (Exception e) {
                    Log.w(TAG, "Failed to extract metadata", e);
                }
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "failed to download", e);
                call.reject(e.getMessage());
            } finally {
                android.content.Intent stopIntent = new android.content.Intent(getContext(), KeepAliveService.class);
                stopIntent.setAction("STOP");
                getContext().startService(stopIntent);
            }
        }).start();
    }

    private java.util.Map<String, CronetDownloader> activeDownloaders = new java.util.concurrent.ConcurrentHashMap<>();
    private FFmpegHelper avd_ffmpeg;

    private void downloadSync(CronetDownloader downloader, String url, java.util.Map<String, String> headers, File dest, String msg, String processId) throws Exception {
        java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
        final Exception[] err = new Exception[1];
        
        downloader.download(url, headers, dest, new CronetDownloader.DownloadCallback() {
            @Override
            public void onProgress(int percent, String speedStr) {
                JSObject progressObj = new JSObject();
                progressObj.put("progress", percent);
                String displayMsg = msg;
                if (speedStr != null && !speedStr.isEmpty()) {
                    displayMsg = msg + " (" + speedStr + ")";
                }
                progressObj.put("line", displayMsg);
                notifyListeners("downloadProgress", progressObj);
            }
            @Override
            public void onSuccess(File downloadedFile) {
                latch.countDown();
            }
            @Override
            public void onError(Exception e) {
                err[0] = e;
                latch.countDown();
            }
        });
        latch.await();
        if (err[0] != null) {
            throw err[0];
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String processId = call.getString("processId", "avd_download");
        try {
            YoutubeDL.getInstance().destroyProcessById(processId);
            CronetDownloader downloader = activeDownloaders.remove(processId);
            if (downloader != null) {
                downloader.cancel();
            }
            if (avd_ffmpeg != null) {
                avd_ffmpeg.cancel();
            }
            Log.d(TAG, "Download cancelled by user");
            // 通知前端：下載已被中止
            JSObject cancelObj = new JSObject();
            cancelObj.put("cancelled", true);
            cancelObj.put("line", "已中止下載");
            notifyListeners("downloadProgress", cancelObj);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel download", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void playVideo(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null || uriString.isEmpty()) {
            call.reject("Must provide a uri");
            return;
        }
        try {
            android.net.Uri uri = android.net.Uri.parse(uriString);
            String mimeType = call.getString("mimeType", "video/*");
            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mimeType);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
            intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to play video", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void isTvDevice(PluginCall call) {
        JSObject ret = new JSObject();
        boolean isTv = false;
        try {
            android.app.UiModeManager uiModeManager = (android.app.UiModeManager) getContext().getSystemService(android.content.Context.UI_MODE_SERVICE);
            if (uiModeManager != null && uiModeManager.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION) {
                isTv = true;
            } else if (getContext().getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
                    || getContext().getPackageManager().hasSystemFeature("android.hardware.type.television")) {
                isTv = true;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to check if TV device", e);
        }
        ret.put("isTv", isTv);
        call.resolve(ret);
    }

    @PluginMethod
    public void uploadToGoogleDrive(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null || uriString.isEmpty()) {
            call.reject("Must provide a uri");
            return;
        }
        try {
            android.net.Uri uri = android.net.Uri.parse(uriString);
            String mimeType = call.getString("mimeType", "*/*");
            
            android.content.Intent shareIntent = new android.content.Intent(android.content.Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(android.content.Intent.EXTRA_STREAM, uri);
            shareIntent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            shareIntent.setPackage("com.google.android.apps.docs");
            shareIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            
            try {
                getContext().startActivity(shareIntent);
            } catch (Exception e) {
                // Fallback to chooser if direct package fails
                android.content.Intent fallbackIntent = new android.content.Intent(android.content.Intent.ACTION_SEND);
                fallbackIntent.setType(mimeType);
                fallbackIntent.putExtra(android.content.Intent.EXTRA_STREAM, uri);
                fallbackIntent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                android.content.Intent chooser = android.content.Intent.createChooser(fallbackIntent, "儲存至 Google 雲端硬碟");
                chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to upload to Google Drive", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void directUploadToDrive(PluginCall call) {
        String uriString = call.getString("uri");
        String rawFileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "*/*");
        String accessToken = call.getString("accessToken");
        Integer taskId = call.getInt("taskId", 0);

        if (uriString == null || accessToken == null || accessToken.isEmpty()) {
            call.reject("必須提供 uri 與 AccessToken");
            return;
        }

        new Thread(() -> {
            try {
                android.net.Uri uri = android.net.Uri.parse(uriString);
                android.content.ContentResolver resolver = getContext().getContentResolver();
                
                long fileSize = 0;
                try (android.content.res.AssetFileDescriptor afd = resolver.openAssetFileDescriptor(uri, "r")) {
                    if (afd != null) {
                        fileSize = afd.getLength();
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Could not determine file size", e);
                }

                String finalFileName = rawFileName;
                if (finalFileName == null || finalFileName.isEmpty()) {
                    finalFileName = "AVD_Download_" + System.currentTimeMillis() + (mimeType.contains("audio") ? ".mp3" : ".mp4");
                }

                // Step 1: Initiate Resumable Upload Session
                java.net.URL initUrl = new java.net.URL("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable");
                java.net.HttpURLConnection initConn = (java.net.HttpURLConnection) initUrl.openConnection();
                initConn.setRequestMethod("POST");
                initConn.setDoOutput(true);
                initConn.setRequestProperty("Authorization", "Bearer " + accessToken);
                initConn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                if (fileSize > 0) {
                    initConn.setRequestProperty("X-Upload-Content-Length", String.valueOf(fileSize));
                }
                initConn.setRequestProperty("X-Upload-Content-Type", mimeType);

                String jsonBody = "{\"name\":\"" + finalFileName.replace("\"", "\\\"") + "\"}";
                try (java.io.OutputStream os = initConn.getOutputStream()) {
                    os.write(jsonBody.getBytes("UTF-8"));
                }

                int responseCode = initConn.getResponseCode();
                if (responseCode != 200) {
                    try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(initConn.getErrorStream()))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                        call.reject("Google 雲端驗證失敗 (" + responseCode + "): " + sb.toString());
                    }
                    return;
                }

                String uploadUrl = initConn.getHeaderField("Location");
                if (uploadUrl == null) {
                    call.reject("無法建立雲端上傳 Session URL");
                    return;
                }

                // Step 2: Stream File Content with Real-Time Progress
                java.net.URL uploadSessionUrl = new java.net.URL(uploadUrl);
                java.net.HttpURLConnection uploadConn = (java.net.HttpURLConnection) uploadSessionUrl.openConnection();
                uploadConn.setRequestMethod("PUT");
                uploadConn.setDoOutput(true);
                uploadConn.setRequestProperty("Content-Type", mimeType);
                if (fileSize > 0) {
                    uploadConn.setRequestProperty("Content-Length", String.valueOf(fileSize));
                }

                try (java.io.InputStream in = resolver.openInputStream(uri);
                     java.io.OutputStream out = uploadConn.getOutputStream()) {
                    byte[] buffer = new byte[64 * 1024]; // 64KB chunks
                    int bytesRead;
                    long totalBytesRead = 0;
                    long lastProgressTime = 0;

                    while ((bytesRead = in.read(buffer)) != -1) {
                        out.write(buffer, 0, bytesRead);
                        totalBytesRead += bytesRead;

                        long now = System.currentTimeMillis();
                        if (now - lastProgressTime > 250 || totalBytesRead == fileSize) {
                            lastProgressTime = now;
                            float progressPercent = (fileSize > 0) ? ((float) totalBytesRead / fileSize) * 100f : 0;
                            JSObject progressObj = new JSObject();
                            progressObj.put("taskId", taskId);
                            progressObj.put("progress", Math.round(progressPercent));
                            progressObj.put("bytesSent", totalBytesRead);
                            progressObj.put("totalBytes", fileSize);
                            notifyListeners("driveUploadProgress", progressObj);
                        }
                    }
                }

                int uploadResponseCode = uploadConn.getResponseCode();
                if (uploadResponseCode == 200 || uploadResponseCode == 201) {
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("taskId", taskId);
                    call.resolve(ret);
                } else {
                    try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(uploadConn.getErrorStream()))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                        call.reject("雲端上傳失敗 (" + uploadResponseCode + "): " + sb.toString());
                    }
                }

            } catch (Exception e) {
                Log.e(TAG, "Direct upload to drive failed", e);
                call.reject(e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void deleteMediaFile(PluginCall call) {
        String uriString = call.getString("uri");
        String pathString = call.getString("path");
        try {
            boolean deleted = false;
            if (uriString != null && !uriString.isEmpty() && uriString.startsWith("content://")) {
                android.net.Uri uri = android.net.Uri.parse(uriString);
                int rows = getContext().getContentResolver().delete(uri, null, null);
                if (rows > 0) deleted = true;
            }
            if (!deleted && pathString != null && !pathString.isEmpty()) {
                File file = new File(pathString);
                if (file.exists()) {
                    deleted = file.delete();
                }
            }
            JSObject ret = new JSObject();
            ret.put("success", deleted);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to delete file", e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void downloadUpdateFile(PluginCall call) {
        String urlString = call.getString("url");
        String fileName = call.getString("fileName", "AVD_update.apk");

        if (urlString == null || urlString.isEmpty()) {
            call.reject("Must provide download URL");
            return;
        }

        new Thread(() -> {
            try {
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) {
                    dir = getContext().getCacheDir();
                }
                File targetFile = new File(dir, fileName);
                if (targetFile.exists()) {
                    targetFile.delete();
                }

                java.net.URL url = new java.net.URL(urlString);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.connect();

                // 處理手動轉址 (GitHub Releases 通常會轉址到 AWS S3 / Objects)
                int status = conn.getResponseCode();
                if (status == java.net.HttpURLConnection.HTTP_MOVED_TEMP || 
                    status == java.net.HttpURLConnection.HTTP_MOVED_PERM || 
                    status == 307 || status == 308) {
                    String newUrl = conn.getHeaderField("Location");
                    conn = (java.net.HttpURLConnection) new java.net.URL(newUrl).openConnection();
                    conn.connect();
                }

                long totalBytes = conn.getContentLengthLong();
                java.io.InputStream in = conn.getInputStream();
                java.io.FileOutputStream out = new java.io.FileOutputStream(targetFile);

                byte[] buffer = new byte[8192];
                long downloadedBytes = 0;
                int bytesRead;
                long lastProgressTime = 0;

                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                    downloadedBytes += bytesRead;

                    long now = System.currentTimeMillis();
                    if (now - lastProgressTime > 100 || downloadedBytes == totalBytes) {
                        lastProgressTime = now;
                        int percent = totalBytes > 0 ? (int) ((downloadedBytes * 100) / totalBytes) : 0;
                        JSObject progress = new JSObject();
                        progress.put("percent", percent);
                        progress.put("downloadedBytes", downloadedBytes);
                        progress.put("totalBytes", totalBytes);
                        notifyListeners("updateDownloadProgress", progress);
                    }
                }

                out.flush();
                out.close();
                in.close();
                conn.disconnect();

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("filePath", targetFile.getAbsolutePath());
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "Failed to download update file", e);
                call.reject("下載更新檔失敗: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null || filePath.isEmpty()) {
            call.reject("Must provide filePath");
            return;
        }

        try {
            File apkFile = new File(filePath);
            if (!apkFile.exists()) {
                call.reject("APK file does not exist: " + filePath);
                return;
            }

            Context context = getContext();
            android.net.Uri apkUri = androidx.core.content.FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );

            android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);

            context.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to install APK", e);
            call.reject("喚起安裝失敗: " + e.getMessage());
        }
    }
}
