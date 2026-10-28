package com.mattpocock.avd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import fi.iki.elonen.NanoHTTPD;

/**
 * PoTokenServer 的協定與快取行為（JVM 上以真實 socket 測試，NanoHTTPD 為純 Java）。
 * 鑄造本身以假的 minter 取代：真正的 BotGuard 需要 WebView，屬實機驗證範圍。
 */
public class PoTokenServerTest {

    private static final class FakeMinter implements PoTokenServer.TokenMinter {
        int calls = 0;
        boolean fail = false;

        @Override
        public String mint(String contentBinding) throws Exception {
            calls++;
            if (fail) throw new Exception("boom");
            return "tok-" + contentBinding + "-" + calls;
        }
    }

    private static final class Http {
        final int code;
        final String body;

        Http(int code, String body) {
            this.code = code;
            this.body = body;
        }

        JSONObject json() throws Exception {
            return new JSONObject(body);
        }
    }

    private FakeMinter minter;
    private PoTokenServer server;
    private int port;

    @Before
    public void setUp() throws Exception {
        minter = new FakeMinter();
        // 埠 0 由系統指派，避免與其他測試或機器上的服務衝突
        server = new PoTokenServer(0, minter, PoTokenServer.SILENT);
        server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true);
        port = server.getListeningPort();
    }

    @After
    public void tearDown() {
        server.stop();
    }

    private Http http(String method, String path, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(5000);
        c.setReadTimeout(5000);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = c.getOutputStream()) {
                os.write(bytes);
            }
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = "";
        if (in != null) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            text = new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
        c.disconnect();
        return new Http(code, text);
    }

    private Http getPot(String binding, boolean bypass) throws Exception {
        return http("POST", "/get_pot", new JSONObject()
                .put("content_binding", binding)
                .put("bypass_cache", bypass).toString());
    }

    @Test
    public void ping_回報協定版本() throws Exception {
        Http r = http("GET", "/ping", null);
        assertEquals(200, r.code);
        assertEquals(PoTokenServer.PROTOCOL_VERSION, r.json().getString("version"));
        assertTrue(r.json().has("server_uptime"));
    }

    @Test
    public void get_pot_鑄造並回傳() throws Exception {
        Http r = getPot("abc", false);
        assertEquals(200, r.code);
        assertEquals("tok-abc-1", r.json().getString("poToken"));
        assertEquals("abc", r.json().getString("contentBinding"));
        assertFalse(r.json().getString("expiresAt").isEmpty());
        assertEquals(1, minter.calls);
    }

    @Test
    public void 同一binding快取命中不重鑄() throws Exception {
        assertEquals("tok-abc-1", getPot("abc", false).json().getString("poToken"));
        assertEquals("tok-abc-1", getPot("abc", false).json().getString("poToken"));
        assertEquals(1, minter.calls);
    }

    @Test
    public void 不同binding各自鑄造() throws Exception {
        assertEquals("tok-abc-1", getPot("abc", false).json().getString("poToken"));
        assertEquals("tok-def-2", getPot("def", false).json().getString("poToken"));
        assertEquals(2, minter.calls);
    }

    @Test
    public void bypass_cache重鑄並覆蓋快取() throws Exception {
        assertEquals("tok-abc-1", getPot("abc", false).json().getString("poToken"));
        assertEquals("tok-abc-2", getPot("abc", true).json().getString("poToken"));
        // 之後不帶 bypass 也拿到新的
        assertEquals("tok-abc-2", getPot("abc", false).json().getString("poToken"));
        assertEquals(2, minter.calls);
    }

    @Test
    public void 鑄造失敗回500且帶error() throws Exception {
        minter.fail = true;
        Http r = getPot("abc", false);
        assertEquals(500, r.code);
        assertTrue(r.json().getString("error").contains("boom"));
        assertFalse(r.json().has("poToken"));
    }

    @Test
    public void 鑄造失敗不污染快取() throws Exception {
        minter.fail = true;
        assertEquals(500, getPot("abc", false).code);
        minter.fail = false;
        assertEquals("tok-abc-2", getPot("abc", false).json().getString("poToken"));
    }

    @Test
    public void 缺content_binding回400() throws Exception {
        Http r = http("POST", "/get_pot", "{}");
        assertEquals(400, r.code);
        assertTrue(r.json().getString("error").contains("content_binding"));
        assertEquals(0, minter.calls);
    }

    @Test
    public void invalidate_caches後重鑄() throws Exception {
        assertEquals("tok-abc-1", getPot("abc", false).json().getString("poToken"));
        assertEquals(204, http("POST", "/invalidate_caches", "").code);
        assertEquals("tok-abc-2", getPot("abc", false).json().getString("poToken"));
    }

    @Test
    public void 未知路徑回404() throws Exception {
        assertEquals(404, http("GET", "/nope", null).code);
    }
}
