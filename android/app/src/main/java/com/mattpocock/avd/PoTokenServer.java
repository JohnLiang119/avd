package com.mattpocock.avd;

import org.json.JSONObject;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ConcurrentHashMap;

import fi.iki.elonen.NanoHTTPD;

/**
 * App 內建的 PO Token provider 伺服器（見 OpenSpec android-po-token-provider）。
 *
 * 只綁 127.0.0.1，介面與 bgutil-ytdlp-pot-provider 相容：
 * <ul>
 *   <li>GET  /ping               → {"version": "2.0.2", "server_uptime": 秒}</li>
 *   <li>POST /get_pot            收 {"content_binding": …, "bypass_cache": bool}
 *                                → {"poToken": …, "contentBinding": …, "expiresAt": ISO 時間}；失敗 → 500 {"error": …}</li>
 *   <li>POST /invalidate_caches  → 204</li>
 * </ul>
 * token 依 content binding 快取 {@link #TOKEN_TTL_MS}；bypass_cache 時重鑄並覆蓋。
 * 實際鑄造交給 {@link TokenMinter}（App 內為 {@link PoTokenWebView}），同一時間只鑄一個，
 * 避免並行請求同時觸發 WebView 重建。
 *
 * 不依賴 android.util.Log —— JVM 單元測試裡那是會拋 Stub! 的空殼 —— log 由建構子注入。
 */
public class PoTokenServer extends NanoHTTPD {
    public static final int DEFAULT_PORT = 4416;
    /** /ping 回報的協定版本：沿用 bgutil 的 2.x 介面，bgutil 原廠外掛比對主版號時也能通過 */
    public static final String PROTOCOL_VERSION = "2.0.2";
    /** PO Token 快取時間，與 bgutil 的 TOKEN_TTL 預設（6 小時）相同 */
    static final long TOKEN_TTL_MS = 6L * 60 * 60 * 1000;
    private static final String JSON = "application/json";

    public interface TokenMinter {
        /** 為 content binding 鑄造 PO Token（websafe base64）；失敗拋例外 */
        String mint(String contentBinding) throws Exception;
    }

    public interface Logger {
        void info(String msg);

        void warn(String msg, Throwable t);
    }

    public static final Logger SILENT = new Logger() {
        @Override
        public void info(String msg) {
        }

        @Override
        public void warn(String msg, Throwable t) {
        }
    };

    private static final class CachedToken {
        final String token;
        final long expiresAtMs;

        CachedToken(String token, long expiresAtMs) {
            this.token = token;
            this.expiresAtMs = expiresAtMs;
        }
    }

    private final TokenMinter minter;
    private final Logger logger;
    private final long startedAtMs;
    private final ConcurrentHashMap<String, CachedToken> cache = new ConcurrentHashMap<>();
    private final Object mintLock = new Object();

    public PoTokenServer(int port, TokenMinter minter, Logger logger) {
        super("127.0.0.1", port);
        this.minter = minter;
        this.logger = logger == null ? SILENT : logger;
        this.startedAtMs = now();
    }

    /** 可被測試覆寫以操控時間 */
    protected long now() {
        return System.currentTimeMillis();
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();
        try {
            if (method == Method.GET && "/ping".equals(uri)) {
                return json(Response.Status.OK, new JSONObject()
                        .put("version", PROTOCOL_VERSION)
                        .put("server_uptime", (now() - startedAtMs) / 1000.0));
            }
            if (method == Method.POST && "/get_pot".equals(uri)) {
                return getPot(session);
            }
            if (method == Method.POST && "/invalidate_caches".equals(uri)) {
                cache.clear();
                return newFixedLengthResponse(Response.Status.NO_CONTENT, JSON, "");
            }
            return json(Response.Status.NOT_FOUND, new JSONObject().put("error", "not found: " + uri));
        } catch (Exception e) {
            logger.warn("處理 " + uri + " 失敗", e);
            return errorJson(e);
        }
    }

    private Response getPot(IHTTPSession session) throws Exception {
        String body = readBody(session);
        JSONObject req = body.isEmpty() ? new JSONObject() : new JSONObject(body);
        String binding = req.optString("content_binding", "");
        boolean bypassCache = req.optBoolean("bypass_cache", false);
        if (binding.isEmpty()) {
            return json(Response.Status.BAD_REQUEST, new JSONObject().put("error", "content_binding is required"));
        }

        CachedToken hit = cache.get(binding);
        if (!bypassCache && hit != null && hit.expiresAtMs > now()) {
            return ok(binding, hit);
        }
        synchronized (mintLock) {
            // 等鎖的期間可能已有人替同一個 binding 鑄好
            hit = cache.get(binding);
            if (!bypassCache && hit != null && hit.expiresAtMs > now()) {
                return ok(binding, hit);
            }
            try {
                String token = minter.mint(binding);
                if (token == null || token.isEmpty()) {
                    throw new IOException("minter 回傳空的 token");
                }
                CachedToken fresh = new CachedToken(token, now() + TOKEN_TTL_MS);
                cache.put(binding, fresh);
                logger.info("已鑄造 PO Token（content binding " + abbreviate(binding) + (bypassCache ? "，bypass_cache" : "") + "）");
                return ok(binding, fresh);
            } catch (Exception e) {
                logger.warn("鑄造 PO Token 失敗（content binding " + abbreviate(binding) + "）", e);
                return errorJson(e);
            }
        }
    }

    private Response ok(String binding, CachedToken c) throws Exception {
        return json(Response.Status.OK, new JSONObject()
                .put("poToken", c.token)
                .put("contentBinding", binding)
                .put("expiresAt", iso8601(c.expiresAtMs)));
    }

    private Response errorJson(Exception e) {
        String msg = e.getMessage() == null || e.getMessage().isEmpty() ? e.toString() : e.getMessage();
        return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, JSON,
                "{\"error\":" + JSONObject.quote(msg) + "}");
    }

    private static Response json(Response.Status status, JSONObject obj) {
        return newFixedLengthResponse(status, JSON, obj.toString());
    }

    /** NanoHTTPD 對非表單的 POST 內容會放在 files 的 postData 鍵 */
    private static String readBody(IHTTPSession session) throws IOException, ResponseException {
        Map<String, String> files = new HashMap<>();
        session.parseBody(files);
        String data = files.get("postData");
        return data == null ? "" : data;
    }

    private static String iso8601(long epochMs) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(epochMs));
    }

    private static String abbreviate(String s) {
        if (s == null) return "null";
        return s.length() <= 24 ? s : s.substring(0, 24) + "…";
    }
}
