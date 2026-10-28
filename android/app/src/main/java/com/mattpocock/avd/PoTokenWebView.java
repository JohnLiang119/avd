package com.mattpocock.avd;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 以隱藏 WebView 執行 YouTube 的 BotGuard，鑄造 PO Token（Proof of Origin）。
 *
 * 流程與 bgutil-ytdlp-pot-provider 2.0.2 相同（NewPipe 亦採同架構），見
 * OpenSpec android-po-token-provider/design.md：
 * <ol>
 *   <li>抓 YouTube 首頁，取出 ytcfg 與 window.ytAtN(...) 裡的 bgChallenge（備援 att/get）</li>
 *   <li>下載 bgChallenge.interpreterUrl 指到的 BotGuard 直譯器 JS</li>
 *   <li>WebView 內載入直譯器、執行 program，取得 botguardResponse 與 webPoSignalOutput</li>
 *   <li>以 botguardResponse 向 GenerateIT 換 integrityToken</li>
 *   <li>webPoSignalOutput[0](integrityToken) 得鑄造函式，之後每個 content binding 都可鑄造</li>
 * </ol>
 * 網路請求一律由 Java 端發出（WebView 設 blockNetworkLoads），WebView 只負責跑 JS。
 * 所有 WebView 操作在主執行緒；{@link #mint} 自背景執行緒呼叫並等待結果。
 */
public final class PoTokenWebView {
    private static final String TAG = "PoToken";
    private static final String JS_INTERFACE = "PoTokenBridge";
    private static final String ASSET_HTML = "po_token.html";
    private static final String BASE_URL = "https://www.youtube.com";
    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    // BotGuard 公開的 API key 與 request key，與 bgutils-js / NewPipe 相同
    private static final String GOOG_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
    private static final String REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
    private static final String GENERATE_IT_URL = "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";
    private static final String ATT_GET_URL = "https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false";

    private static final long INIT_TIMEOUT_MS = 30_000L;
    private static final long MINT_TIMEOUT_MS = 10_000L;
    /** integrityToken 到期前保留的安全邊際 */
    private static final long EXPIRY_MARGIN_MS = 10L * 60 * 1000;
    private static final int HTTP_TIMEOUT_MS = 15_000;

    private static final Pattern YTCFG_PATTERN = Pattern.compile("ytcfg\\.set\\((\\{.+?\\})\\);", Pattern.DOTALL);
    private static final Pattern YTATN_PATTERN = Pattern.compile("window\\.ytAtN\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)");

    private final Context appContext;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "PoTokenIO");
        t.setDaemon(true);
        return t;
    });

    private final Object initLock = new Object();
    /** 只在主執行緒存取 */
    private WebView webView;
    /** 以 initLock 保護；null 表示尚未初始化 */
    private CompletableFuture<Void> initFuture;
    private volatile long expiresAtMs = 0L;
    /** WebView 連頁面語法都跑不動（console 出現 Uncaught）；之後一律拒絕，不再重試 */
    private volatile boolean webViewBroken = false;
    private final ConcurrentHashMap<String, CompletableFuture<String>> pendingMints = new ConcurrentHashMap<>();

    public PoTokenWebView(Context context) {
        this.appContext = context.getApplicationContext();
    }

    /**
     * 為指定的 content binding 鑄造 PO Token（websafe base64）。
     * 必須自背景執行緒呼叫：內部要等待主執行緒上的 WebView 工作。
     * 失敗時重建 WebView 再試一次（App 進背景後 WebView 內容可能遺失），再失敗才拋出。
     */
    public String mint(String contentBinding) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new IllegalStateException("mint() 不可在主執行緒呼叫");
        }
        if (webViewBroken) {
            throw new IOException("WebView 無法執行 BotGuard（先前偵測到 Uncaught 錯誤）");
        }
        ensureReady(false);
        try {
            return mintOnce(contentBinding);
        } catch (Exception first) {
            Log.w(TAG, "鑄造失敗，重建 WebView 後再試一次: " + first.getMessage());
            ensureReady(true);
            return mintOnce(contentBinding);
        }
    }

    private boolean isExpired() {
        return System.currentTimeMillis() >= expiresAtMs;
    }

    private void ensureReady(boolean forceRecreate) throws IOException {
        CompletableFuture<Void> f;
        synchronized (initLock) {
            boolean recreate = forceRecreate
                    || initFuture == null
                    || initFuture.isCompletedExceptionally()
                    || (initFuture.isDone() && isExpired());
            if (recreate) {
                initFuture = new CompletableFuture<>();
                final CompletableFuture<Void> target = initFuture;
                if (!mainHandler.post(() -> createWebViewAndLoad(target))) {
                    target.completeExceptionally(new IOException("無法排程到主執行緒"));
                }
            }
            f = initFuture;
        }
        try {
            f.get(INIT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            f.completeExceptionally(new IOException("BotGuard 初始化逾時"));
            throw new IOException("BotGuard 初始化逾時（" + INIT_TIMEOUT_MS + " ms）");
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            throw new IOException("BotGuard 初始化失敗: " + cause.getMessage(), cause);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("等待 BotGuard 初始化時被中斷");
        }
    }

    // ---- 初始化流程：主執行緒建立 WebView，之後由 Bridge 回呼與 io 執行緒接力 ----

    private void createWebViewAndLoad(CompletableFuture<Void> target) {
        try {
            destroyWebView();
            WebView wv = new WebView(appContext);
            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setUserAgentString(USER_AGENT);
            // 所有網路請求由 Java 端發，WebView 不連網、不留 cookie
            s.setBlockNetworkLoads(true);
            s.setDomStorageEnabled(false);
            wv.addJavascriptInterface(new Bridge(target), JS_INTERFACE);
            wv.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage m) {
                    if (m.message() != null && m.message().contains("Uncaught")) {
                        // 頁面所有可能失敗處都有 try/catch；Uncaught 代表 WebView 連語法都不支援
                        String msg = m.message() + " @" + m.sourceId() + ":" + m.lineNumber();
                        Log.e(TAG, "WebView 無法執行 BotGuard: " + msg);
                        webViewBroken = true;
                        failAll(new IOException("WebView 不支援 BotGuard 所需的 JS: " + msg), target);
                    }
                    return super.onConsoleMessage(m);
                }
            });
            wv.setWebViewClient(new WebViewClient() {
                private boolean started = false;

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (started || target.isDone()) return;
                    started = true;
                    io.execute(() -> fetchChallenge(target));
                }
            });
            String html = readAsset(ASSET_HTML);
            webView = wv;
            wv.loadDataWithBaseURL(BASE_URL, html, "text/html", "utf-8", null);
        } catch (Throwable t) {
            Log.e(TAG, "建立 WebView 失敗", t);
            target.completeExceptionally(t);
        }
    }

    /** 步驟 1：首頁的 ytAtN 挑戰；取不到時改用 att/get */
    private void fetchChallenge(CompletableFuture<Void> target) {
        try {
            String homepage = httpGet(BASE_URL, headers("Accept", "*/*", "Accept-Language", "en-US,en;q=0.7"));
            Matcher cfg = YTCFG_PATTERN.matcher(homepage);
            String ytcfg = cfg.find() ? cfg.group(1) : null;
            Matcher att = YTATN_PATTERN.matcher(homepage);
            if (att.find()) {
                Log.d(TAG, "使用首頁的 ytAtN 挑戰" + (ytcfg == null ? "（首頁無 ytcfg）" : ""));
                evaluate("applyHomepageChallenge("
                        + (ytcfg == null ? "null" : JSONObject.quote(ytcfg)) + ", "
                        + JSONObject.quote(att.group(1)) + ")");
                return;
            }
            Log.w(TAG, "首頁沒有 ytAtN 挑戰，改用 att/get");
            JSONObject body = new JSONObject()
                    .put("context", new JSONObject().put("client", new JSONObject()
                            .put("clientName", "WEB")
                            .put("clientVersion", "2.20260817.01.00")))
                    .put("engagementType", "ENGAGEMENT_TYPE_UNBOUND");
            String resp = httpPost(ATT_GET_URL, body.toString(), headers("Content-Type", "application/json", "Accept", "*/*"));
            JSONObject ch = new JSONObject(resp).getJSONObject("bgChallenge");
            onChallengeParsed(target, ch.getString("program"), ch.getString("globalName"),
                    ch.getJSONObject("interpreterUrl").getString("privateDoNotAccessOrElseTrustedResourceUrlWrappedValue"));
        } catch (Throwable t) {
            fail(target, "取得 BotGuard 挑戰失敗", t);
        }
    }

    /** 步驟 2：下載直譯器 JS 並在頁面內執行 program */
    private void onChallengeParsed(CompletableFuture<Void> target, String program, String globalName, String interpreterUrl) {
        io.execute(() -> {
            try {
                String url = interpreterUrl.startsWith("//") ? "https:" + interpreterUrl : interpreterUrl;
                String js = httpGet(url, headers("Accept", "*/*"));
                Log.d(TAG, "BotGuard 直譯器已下載（" + js.length() + " 字元）");
                evaluate("runBotGuard(" + JSONObject.quote(program) + ", "
                        + JSONObject.quote(globalName) + ", " + JSONObject.quote(js) + ")");
            } catch (Throwable t) {
                fail(target, "下載 BotGuard 直譯器失敗", t);
            }
        });
    }

    /** 步驟 3：以 botguardResponse 換 integrityToken，再交給頁面建立鑄造函式 */
    private void onBotguardResult(CompletableFuture<Void> target, String botguardResponse) {
        io.execute(() -> {
            try {
                String body = new JSONArray().put(REQUEST_KEY).put(botguardResponse).toString();
                String resp = httpPost(GENERATE_IT_URL, body, headers(
                        "Content-Type", "application/json+protobuf",
                        "x-goog-api-key", GOOG_API_KEY,
                        "x-user-agent", "grpc-web-javascript/0.1",
                        "Accept", "application/json"));
                JSONArray arr = new JSONArray(resp);
                String integrityToken = arr.optString(0, "");
                long ttlSecs = arr.optLong(1, 0L);
                if (integrityToken.isEmpty() || ttlSecs <= 0) {
                    throw new IOException("GenerateIT 回應異常: " + abbreviate(resp));
                }
                expiresAtMs = System.currentTimeMillis() + ttlSecs * 1000L - EXPIRY_MARGIN_MS;
                Log.d(TAG, "integrity token 已取得，有效 " + ttlSecs + " 秒");
                evaluate("setIntegrityToken(" + JSONObject.quote(integrityToken) + ")");
            } catch (Throwable t) {
                fail(target, "GenerateIT 失敗", t);
            }
        });
    }

    // ---- 鑄造 ----

    private String mintOnce(String contentBinding) throws Exception {
        String id = UUID.randomUUID().toString();
        CompletableFuture<String> f = new CompletableFuture<>();
        pendingMints.put(id, f);
        try {
            evaluate("mintPoToken(" + JSONObject.quote(id) + ", " + JSONObject.quote(contentBinding) + ")");
            String token = f.get(MINT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            Log.d(TAG, "已鑄造 PO Token，content binding=" + abbreviate(contentBinding));
            return token;
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            throw new IOException("鑄造失敗: " + cause.getMessage(), cause);
        } catch (TimeoutException e) {
            throw new IOException("鑄造逾時（" + MINT_TIMEOUT_MS + " ms）");
        } finally {
            pendingMints.remove(id);
        }
    }

    // ---- WebView 與頁面的橋接 ----

    /** JS 以 PoTokenBridge.xxx() 回呼；這些方法在 WebView 的 JS 執行緒上執行 */
    private final class Bridge {
        private final CompletableFuture<Void> target;

        Bridge(CompletableFuture<Void> target) {
            this.target = target;
        }

        @JavascriptInterface
        public void onChallenge(String json) {
            try {
                JSONObject o = new JSONObject(json);
                onChallengeParsed(target, o.getString("program"), o.getString("globalName"), o.getString("interpreterUrl"));
            } catch (Throwable t) {
                fail(target, "解析首頁挑戰失敗", t);
            }
        }

        @JavascriptInterface
        public void onBotguardResult(String botguardResponse) {
            PoTokenWebView.this.onBotguardResult(target, botguardResponse);
        }

        @JavascriptInterface
        public void onReady() {
            Log.d(TAG, "BotGuard 鑄造函式就緒");
            target.complete(null);
        }

        @JavascriptInterface
        public void onInitError(String message) {
            fail(target, "BotGuard 初始化錯誤", new IOException(message));
        }

        @JavascriptInterface
        public void onMinted(String id, String token) {
            CompletableFuture<String> f = pendingMints.remove(id);
            if (f != null) f.complete(token);
        }

        @JavascriptInterface
        public void onMintError(String id, String message) {
            CompletableFuture<String> f = pendingMints.remove(id);
            if (f != null) f.completeExceptionally(new IOException(message));
        }
    }

    private void evaluate(String js) {
        mainHandler.post(() -> {
            WebView wv = webView;
            if (wv != null) wv.evaluateJavascript(js, null);
        });
    }

    private void fail(CompletableFuture<Void> target, String what, Throwable t) {
        Log.e(TAG, what + ": " + t.getMessage());
        target.completeExceptionally(new IOException(what + ": " + t.getMessage(), t));
    }

    private void failAll(Throwable t, CompletableFuture<Void> target) {
        target.completeExceptionally(t);
        for (CompletableFuture<String> f : pendingMints.values()) f.completeExceptionally(t);
        pendingMints.clear();
    }

    /** 主執行緒 */
    private void destroyWebView() {
        WebView wv = webView;
        webView = null;
        if (wv == null) return;
        try {
            wv.stopLoading();
            wv.loadUrl("about:blank");
            wv.removeAllViews();
            wv.destroy();
        } catch (Throwable t) {
            Log.w(TAG, "釋放 WebView 時發生錯誤", t);
        }
    }

    public void close() {
        mainHandler.post(this::destroyWebView);
    }

    // ---- HTTP 與工具 ----

    private String readAsset(String name) throws IOException {
        try (InputStream in = appContext.getAssets().open(name)) {
            return readAll(in);
        }
    }

    private static String httpGet(String url, Map<String, String> headers) throws IOException {
        return http("GET", url, null, headers);
    }

    private static String httpPost(String url, String body, Map<String, String> headers) throws IOException {
        return http("POST", url, body, headers);
    }

    private static String http(String method, String url, String body, Map<String, String> headers) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(HTTP_TIMEOUT_MS);
            c.setReadTimeout(HTTP_TIMEOUT_MS);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", USER_AGENT);
            for (Map.Entry<String, String> e : headers.entrySet()) {
                c.setRequestProperty(e.getKey(), e.getValue());
            }
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(bytes);
                }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = in == null ? "" : readAll(in);
            if (code < 200 || code >= 300) {
                throw new IOException("HTTP " + code + " " + method + " " + url + ": " + abbreviate(text));
            }
            return text;
        } finally {
            c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static Map<String, String> headers(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static String abbreviate(String s) {
        if (s == null) return "null";
        return s.length() <= 120 ? s : s.substring(0, 120) + "…";
    }
}
