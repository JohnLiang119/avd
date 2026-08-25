package com.mattpocock.avd;

import android.os.Environment;
import android.util.Log;
import android.media.MediaMetadataRetriever;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import fi.iki.elonen.NanoHTTPD;

public class LocalFileServer extends NanoHTTPD {
    private static final String TAG = "LocalFileServer";
    public static String pushedTasksJson = "[]";
    private android.content.Context context;
    private SpeedListener speedListener;
    
    public interface SpeedListener {
        void onSpeedUpdate(long totalBytesPerSecond, Map<String, Long> bytesPerSecondPerIp, Map<String, String> userAgentPerIp);
    }
    
    private Timer speedTimer;
    private final ConcurrentHashMap<String, AtomicLong> bytesPerIp = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> userAgentsPerIp = new ConcurrentHashMap<>();

    public LocalFileServer(android.content.Context context, int port, SpeedListener listener) {
        super(port);
        this.context = context;
        this.speedListener = listener;
    }

    @Override
    public void start() throws java.io.IOException {
        super.start();
        if (speedTimer != null) {
            speedTimer.cancel();
        }
        speedTimer = new Timer(true);
        speedTimer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                if (speedListener == null) return;
                
                long totalSpeed = 0;
                Map<String, Long> currentSpeeds = new HashMap<>();
                
                for (Map.Entry<String, AtomicLong> entry : bytesPerIp.entrySet()) {
                    long bytes = entry.getValue().getAndSet(0);
                    if (bytes > 0) {
                        currentSpeeds.put(entry.getKey(), bytes);
                        totalSpeed += bytes;
                    }
                }
                speedListener.onSpeedUpdate(totalSpeed, currentSpeeds, new HashMap<>(userAgentsPerIp));
            }
        }, 1000, 1000);
    }

    @Override
    public void stop() {
        super.stop();
        if (speedTimer != null) {
            speedTimer.cancel();
            speedTimer = null;
        }
    }
    
    @Override
    public Response serve(IHTTPSession session) {
        if (Method.OPTIONS.equals(session.getMethod())) {
            return addCorsHeaders(newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, ""));
        }
        try {
            Response response = handleRequest(session);
            return addCorsHeaders(response);
        } catch (Throwable t) {
            Log.e(TAG, "Error handling request", t);
            return addCorsHeaders(renderErrorResponse(t));
        }
    }

    private Response addCorsHeaders(Response response) {
        if (response != null) {
            response.addHeader("Access-Control-Allow-Origin", "*");
            response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
            response.addHeader("Access-Control-Allow-Headers", "*");
        }
        return response;
    }

    private Response handleRequest(IHTTPSession session) throws Exception {
        String uri = session.getUri();
        String ip = session.getRemoteIpAddress();
        String ua = session.getHeaders().get("user-agent");
        if (ip != null && ua != null) {
            userAgentsPerIp.put(ip, ua);
        }
        Log.d(TAG, "Request: " + uri);
        
        if (uri.equals("/")) {
            return serveIndex();
        } else if (uri.equals("/api/list")) {
            return serveApiList();
        } else if (uri.equals("/api/push-tasks")) {
            try {
                Map<String, String> files = new HashMap<>();
                session.parseBody(files);
                String postData = session.getParms().get("postData");
                if (postData != null) {
                    pushedTasksJson = postData;
                }
                return newFixedLengthResponse(Response.Status.OK, "application/json; charset=UTF-8", "{\"success\":true}");
            } catch (Exception e) {
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json; charset=UTF-8", "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}");
            }
        } else if (uri.equals("/api/get-pushed-tasks")) {
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=UTF-8", pushedTasksJson != null ? pushedTasksJson : "[]");
        } else if (uri.equals("/api/remote-play")) {
            return serveRemotePlay(session);
        } else if (uri.startsWith("/play/")) {
            String fileName = uri.substring("/play/".length());
            return serveFile(fileName, session, false);
        } else if (uri.startsWith("/files/")) {
            String fileName = uri.substring("/files/".length());
            return serveFile(fileName, session, true);
        }
        
        return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "404 Not Found");
    }

    private Response serveApiList() {
        File musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
        File moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
        
        List<File> allFiles = new ArrayList<>();
        collectMediaFiles(musicDir, allFiles);
        collectMediaFiles(moviesDir, allFiles);
        
        Collections.sort(allFiles, (f1, f2) -> Long.compare(f2.lastModified(), f1.lastModified()));

        StringBuilder json = new StringBuilder("[");
        boolean first = true;
        for (File f : allFiles) {
            File parent = f.getParentFile();
            String folderName = "";
            String relPath = f.getName();
            if (parent != null && !parent.equals(musicDir) && !parent.equals(moviesDir)) {
                folderName = parent.getName();
                relPath = folderName + "/" + f.getName();
            }
            if (!first) json.append(",");
            first = false;
            
            try {
                String encodedPath = java.net.URLEncoder.encode(relPath, "UTF-8").replaceAll("\\+", "%20").replace("%2F", "/");
                json.append("{")
                    .append("\"name\":\"").append(f.getName().replace("\"", "\\\"")).append("\",")
                    .append("\"folder\":\"").append(folderName.replace("\"", "\\\"")).append("\",")
                    .append("\"size\":").append(f.length()).append(",")
                    .append("\"lastModified\":").append(f.lastModified()).append(",")
                    .append("\"playUrl\":\"/play/").append(encodedPath).append("\",")
                    .append("\"downloadUrl\":\"/files/").append(encodedPath).append("\"")
                    .append("}");
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        json.append("]");
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=UTF-8", json.toString());
    }

    private Response serveRemotePlay(IHTTPSession session) {
        Map<String, String> parms = session.getParms();
        String playUri = parms.get("uri");
        if (playUri == null || playUri.isEmpty()) {
            playUri = parms.get("url");
        }
        if (playUri != null && !playUri.isEmpty()) {
            try {
                try {
                    android.app.ActivityManager am = (android.app.ActivityManager) this.context.getSystemService(android.content.Context.ACTIVITY_SERVICE);
                    if (am != null) am.killBackgroundProcesses("org.videolan.vlc");
                } catch (Exception ignored) {}

                android.net.Uri uri = android.net.Uri.parse(playUri);
                String mimeType = playUri.toLowerCase().endsWith(".mp3") ? "audio/*" : "video/*";
                android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                intent.setDataAndType(uri, mimeType);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
                intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                this.context.startActivity(intent);
                return newFixedLengthResponse(Response.Status.OK, "application/json; charset=UTF-8", "{\"success\":true}");
            } catch (Exception e) {
                Log.e(TAG, "Failed to remote play uri: " + playUri, e);
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json; charset=UTF-8", "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}");
            }
        }
        return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json; charset=UTF-8", "{\"success\":false,\"error\":\"Missing uri parameter\"}");
    }

    private Response renderErrorResponse(Throwable t) {
        java.io.StringWriter sw = new java.io.StringWriter();
        java.io.PrintWriter pw = new java.io.PrintWriter(sw);
        t.printStackTrace(pw);
        String stackTrace = sw.toString();
        
        StringBuilder html = new StringBuilder();
        html.append("<html><head><meta charset=\"UTF-8\">");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        html.append("<title>AVD 伺服器錯誤</title>");
        html.append("<style>");
        html.append("body { font-family: -apple-system, monospace; padding: 20px; background-color: #fef2f2; color: #991b1b; }");
        html.append("h1 { color: #dc2626; font-size: 20px; }");
        html.append("pre { background: #fee2e2; padding: 12px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; font-size: 13px; color: #7f1d1d; }");
        html.append("</style></head><body>");
        html.append("<h1>⚠️ AVD 伺服器發生內部異常 (HTTP 500)</h1>");
        html.append("<p><b>錯誤說明:</b> ").append(t.getMessage() != null ? t.getMessage() : t.toString()).append("</p>");
        html.append("<p><b>詳細 Exception Stack Trace:</b></p>");
        html.append("<pre>").append(stackTrace.replace("<", "&lt;").replace(">", "&gt;")).append("</pre>");
        html.append("</body></html>");
        
        return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/html; charset=UTF-8", html.toString());
    }
    
    private void collectMediaFiles(File dir, List<File> result) {
        if (dir.exists() && dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (f.isFile()) {
                        String name = f.getName().toLowerCase();
                        if (name.endsWith(".mp3") || name.endsWith(".m4a") || name.endsWith(".mp4") || name.endsWith(".webm") || name.endsWith(".mkv")) {
                            result.add(f);
                        }
                    } else if (f.isDirectory()) {
                        collectMediaFiles(f, result);
                    }
                }
            }
        }
    }

    private Response serveIndex() {
        File musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
        File moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
        
        List<File> allFiles = new ArrayList<>();
        collectMediaFiles(musicDir, allFiles);
        collectMediaFiles(moviesDir, allFiles);
        
        // Sort by last modified (newest first)
        Collections.sort(allFiles, (f1, f2) -> Long.compare(f2.lastModified(), f1.lastModified()));

        // Group files by parent folder name
        LinkedHashMap<String, List<File>> groupedFiles = new LinkedHashMap<>();
        for (File f : allFiles) {
            File parent = f.getParentFile();
            String folderName = "";
            if (parent != null && !parent.equals(musicDir) && !parent.equals(moviesDir)) {
                folderName = parent.getName();
            }
            groupedFiles.computeIfAbsent(folderName, k -> new ArrayList<>()).add(f);
        }
        
        StringBuilder html = new StringBuilder();
        html.append("<!DOCTYPE html><html><head><meta charset=\"UTF-8\">");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        html.append("<title>AVD 影音快傳</title>");
        html.append("<style>");
        html.append("body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background-color: #f8fafc; color: #1e293b; max-width: 1200px; margin: 0 auto; }");
        html.append(".header { text-align: center; font-weight: 600; margin-bottom: 40px; color: #0f172a; padding: 20px 0; }");
        html.append(".header h1 { margin: 0 0 10px 0; font-size: 24px; font-weight: 700; }");
        html.append(".header p { margin: 0; font-size: 14px; color: #64748b; }");
        html.append(".layout-3 { display: grid; grid-template-columns: repeat(2, 1fr); column-gap: 32px; row-gap: 8px; margin-bottom: 40px; }");
        html.append("@media (max-width: 768px) { .layout-3 { grid-template-columns: 1fr; } }");
        html.append(".group-card { margin-bottom: 30px; }");
        html.append(".group-header { background: transparent; border-bottom: 2px solid #e2e8f0; padding: 12px 0 8px 0; font-weight: 700; font-size: 16px; color: #334155; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; margin-bottom: 12px; transition: border-color 0.2s; }");
        html.append(".group-header:hover { border-color: #cbd5e1; }");
        html.append(".group-title { display: flex; align-items: center; gap: 8px; }");
        html.append(".badge-count { background: #3b82f6; color: white; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 500; margin-left: 4px; }");
        html.append(".card-3 { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px dashed #e2e8f0; transition: background-color 0.2s; }");
        html.append(".card-3:hover { background-color: #f1f5f9; border-radius: 8px; padding: 12px; margin: 0 -12px; border-bottom-color: transparent; }");
        html.append(".card-3 .info { flex: 1; padding-right: 20px; overflow: hidden; }");
        html.append(".file-name { font-weight: 500; font-size: 15px; margin: 0 0 6px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; color: #0f172a; }");
        html.append(".file-meta { font-size: 13px; color: #64748b; }");
        html.append(".actions { display: flex; gap: 12px; }");
        html.append(".btn { color: white; border: none; padding: 12px 20px; border-radius: 24px; text-align: center; font-weight: 600; cursor: pointer; font-size: 13px; text-decoration: none; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; }");
        html.append(".btn-primary { background: #3b82f6; } .btn-primary:hover { background: #2563eb; }");
        html.append(".btn-secondary { background: #10b981; } .btn-secondary:hover { background: #059669; }");
        html.append("</style>");
        html.append("<script>");
        html.append("function toggleGroup(id) {");
        html.append("  var el = document.getElementById(id);");
        html.append("  var arrow = document.getElementById('arrow-' + id);");
        html.append("  if (el.style.display === 'none') { el.style.display = 'block'; if (arrow) arrow.innerText = '▼'; }");
        html.append("  else { el.style.display = 'none'; if (arrow) arrow.innerText = '▶'; }");
        html.append("}");
        html.append("</script>");
        html.append("</head><body>");
        html.append("<div class=\"header\"><h1>📱 AVD 影音快傳服務器</h1><p>已下載影音檔案 (依頻道與播放清單分組)</p></div>");
        
        if (allFiles.isEmpty()) {
            html.append("<p style=\"text-align: center; color: #94a3b8; margin-top: 40px;\">目前沒有已下載的影音檔案。</p>");
        } else {
            int groupIdx = 0;
            for (Map.Entry<String, List<File>> entry : groupedFiles.entrySet()) {
                groupIdx++;
                String folderName = entry.getKey();
                List<File> files = entry.getValue();
                String groupId = "group-" + groupIdx;
                
                html.append("<div class=\"group-card\">");
                if (!folderName.isEmpty()) {
                    html.append("<div class=\"group-header\" onclick=\"toggleGroup('").append(groupId).append("')\">");
                    html.append("<div class=\"group-title\"><span>📂 ").append(folderName).append("</span><span class=\"badge-count\">").append(files.size()).append(" 個內容</span></div>");
                    html.append("<span id=\"arrow-").append(groupId).append("\">▼</span>");
                    html.append("</div>");
                } else {
                    html.append("<div class=\"group-header\" onclick=\"toggleGroup('").append(groupId).append("')\">");
                    html.append("<div class=\"group-title\"><span>🎬 單一影音檔案</span><span class=\"badge-count\">").append(files.size()).append(" 個內容</span></div>");
                    html.append("<span id=\"arrow-").append(groupId).append("\">▼</span>");
                    html.append("</div>");
                }
                
                html.append("<div id=\"").append(groupId).append("\" class=\"layout-3\">");
                for (File f : files) {
                    String quality = "";
                    String lowerName = f.getName().toLowerCase();
                    try {
                        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                        retriever.setDataSource(f.getAbsolutePath());
                        
                        if (lowerName.endsWith(".mp3") || lowerName.endsWith(".m4a")) {
                            String bitrateStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
                            if (bitrateStr != null) {
                                int kbps = Integer.parseInt(bitrateStr) / 1000;
                                quality = " <span style=\"background:#8b5cf6;color:white;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:6px;vertical-align:middle;\">" + kbps + "kbps</span>";
                            }
                        } else if (lowerName.endsWith(".mp4") || lowerName.endsWith(".webm") || lowerName.endsWith(".mkv")) {
                            String heightStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                            if (heightStr != null) {
                                int height = Integer.parseInt(heightStr);
                                if (height >= 2160) quality = " <span style=\"background:#ef4444;color:white;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:6px;vertical-align:middle;\">4K</span>";
                                else if (height >= 1080) quality = " <span style=\"background:#f59e0b;color:white;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:6px;vertical-align:middle;\">1080p</span>";
                                else if (height >= 720) quality = " <span style=\"background:#3b82f6;color:white;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:6px;vertical-align:middle;\">720p</span>";
                                else if (height >= 480) quality = " <span style=\"background:#10b981;color:white;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:6px;vertical-align:middle;\">480p</span>";
                                else quality = " <span style=\"background:#6b7280;color:white;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:6px;vertical-align:middle;\">" + height + "p</span>";
                            }
                            
                            android.media.MediaExtractor extractor = new android.media.MediaExtractor();
                            extractor.setDataSource(f.getAbsolutePath());
                            for (int i = 0; i < extractor.getTrackCount(); i++) {
                                android.media.MediaFormat format = extractor.getTrackFormat(i);
                                String mime = format.getString(android.media.MediaFormat.KEY_MIME);
                                if (mime != null && mime.startsWith("video/")) {
                                    String codecName = mime.replace("video/", "").toUpperCase();
                                    if (mime.contains("avc")) codecName = "H.264";
                                    else if (mime.contains("hevc")) codecName = "H.265";
                                    else if (mime.contains("vp9")) codecName = "VP9";
                                    else if (mime.contains("av01")) codecName = "AV1";
                                    quality += " <span style=\"background:#8b5cf6;color:white;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:6px;vertical-align:middle;\">" + codecName + "</span>";
                                    break;
                                }
                            }
                            extractor.release();
                        }
                        retriever.release();
                    } catch (Throwable e) {
                        // fallback quietly if metadata probing fails
                    }
                    
                    String relPath = f.getName();
                    if (!folderName.isEmpty()) {
                        relPath = folderName + "/" + f.getName();
                    }

                    html.append("<div class=\"card-3\">");
                    html.append("<div class=\"info\">");
                    String safeTitle = f.getName().replace("\"", "&quot;");
                    html.append("<div class=\"file-name\" title=\"").append(safeTitle).append("\">");
                    html.append("<span>").append(f.getName()).append("</span>").append(quality).append("</div>");
                    long sizeMb = f.length() / (1024 * 1024);
                    html.append("<div class=\"file-meta\">檔案大小: ").append(sizeMb).append(" MB</div>");
                    html.append("</div>");
                    try {
                        String encodedPath = java.net.URLEncoder.encode(relPath, "UTF-8").replaceAll("\\+", "%20").replace("%2F", "/");
                        String safeFilename = f.getName().replace("'", "\\'").replace("\"", "&quot;");
                        html.append("<div class=\"actions\">");
                        html.append("<a class=\"btn btn-primary\" href=\"/files/").append(encodedPath).append("\" download=\"").append(safeFilename).append("\">⬇ 下載檔案</a>");
                        html.append("<a class=\"btn btn-secondary\" href=\"/play/").append(encodedPath).append("\" target=\"_blank\">▶ 線上播放</a>");
                        html.append("</div>");
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    html.append("</div>");
                }
                html.append("</div></div>");
            }
        }
        
        html.append("</body></html>");
        
        return newFixedLengthResponse(Response.Status.OK, "text/html", html.toString());
    }
    
    private Response serveFile(String rawPath, IHTTPSession session, boolean isDownload) {
        try {
            File musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
            File moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
            
            String fileName = rawPath;
            File targetFile = new File(musicDir, fileName);
            if (!targetFile.exists() || !targetFile.isFile()) {
                targetFile = new File(moviesDir, fileName);
            }
            
            if (!targetFile.exists() || !targetFile.isFile()) {
                try {
                    String decoded = URLDecoder.decode(rawPath, "UTF-8");
                    File f1 = new File(musicDir, decoded);
                    if (f1.exists() && f1.isFile()) {
                        targetFile = f1;
                        fileName = decoded;
                    } else {
                        File f2 = new File(moviesDir, decoded);
                        if (f2.exists() && f2.isFile()) {
                            targetFile = f2;
                            fileName = decoded;
                        }
                    }
                } catch (Exception ignored) {}
            }
            
            if (targetFile.exists() && targetFile.isFile()) {
                String mimeType = "application/octet-stream";
                if (fileName.endsWith(".mp3")) mimeType = "audio/mpeg";
                else if (fileName.endsWith(".mp4")) mimeType = "video/mp4";
                else if (fileName.endsWith(".m4a")) mimeType = "audio/mp4";
                
                try {
                    String rangeHeader = session.getHeaders().get("range");
                    long fileLen = targetFile.length();
                    Response res;
                    
                    if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                        String[] range = rangeHeader.substring(6).split("-");
                        long startFrom = Long.parseLong(range[0]);
                        long endAt = range.length > 1 && !range[1].isEmpty() ? Long.parseLong(range[1]) : fileLen - 1;
                        if (endAt >= fileLen) endAt = fileLen - 1;
                        
                        long newLen = endAt - startFrom + 1;
                        java.io.RandomAccessFile raf = new java.io.RandomAccessFile(targetFile, "r");
                        raf.seek(startFrom);
                        java.io.InputStream fis = java.nio.channels.Channels.newInputStream(raf.getChannel());
                        String clientIp = session.getRemoteIpAddress();
                        TrackingInputStream tis = new TrackingInputStream(fis, clientIp, LocalFileServer.this);
                        
                        res = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mimeType, tis, newLen);
                        res.addHeader("Content-Range", "bytes " + startFrom + "-" + endAt + "/" + fileLen);
                    } else {
                        java.io.RandomAccessFile raf = new java.io.RandomAccessFile(targetFile, "r");
                        java.io.InputStream fis = java.nio.channels.Channels.newInputStream(raf.getChannel());
                        String clientIp = session.getRemoteIpAddress();
                        TrackingInputStream tis = new TrackingInputStream(fis, clientIp, LocalFileServer.this);
                        res = newFixedLengthResponse(Response.Status.OK, mimeType, tis, fileLen);
                    }
                    
                    res.addHeader("Accept-Ranges", "bytes");
                    
                    // Safari requires ETag to allow resuming
                    String etag = Integer.toHexString((targetFile.getAbsolutePath() + targetFile.lastModified() + targetFile.length()).hashCode());
                    res.addHeader("ETag", "\"" + etag + "\"");
                    
                    if (isDownload) {
                        String encodedHeaderName = java.net.URLEncoder.encode(fileName, "UTF-8").replaceAll("\\+", "%20");
                        String fallbackName = fileName.toLowerCase().endsWith(".mp3") ? "download.mp3" : "download.mp4";
                        res.addHeader("Content-Disposition", "attachment; filename=\"" + fallbackName + "\"; filename*=UTF-8''" + encodedHeaderName);
                    } else {
                        res.addHeader("Content-Disposition", "inline");
                    }
                    
                    return res;
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        
        return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "File not found");
    }
    
    private static class TrackingInputStream extends java.io.FilterInputStream {
        private final String clientIp;
        private final LocalFileServer server;

        protected TrackingInputStream(java.io.InputStream in, String clientIp, LocalFileServer server) {
            super(in);
            this.clientIp = clientIp != null ? clientIp : "unknown";
            this.server = server;
        }

        @Override
        public int read() throws java.io.IOException {
            int b = super.read();
            if (b != -1) track(1);
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws java.io.IOException {
            int read = super.read(b, off, len);
            if (read != -1) track(read);
            return read;
        }
        
        private void track(long bytes) {
            server.bytesPerIp.computeIfAbsent(clientIp, k -> new java.util.concurrent.atomic.AtomicLong(0)).addAndGet(bytes);
        }
    }
}
