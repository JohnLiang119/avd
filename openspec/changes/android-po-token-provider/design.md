## Context

動機與實測見 `proposal.md`。本節記錄實作所依據的現況事實。

**yt-dlp（手機上為 nightly 2026.10.26）的 PO Token 架構**：`yt_dlp/extractor/youtube/pot/provider.py` 定義 `PoTokenProvider` 外掛介面；外掛放在 `--plugin-dirs DIR` 指定目錄的**子目錄**裡（`DIR/<套件>/yt_dlp_plugins/extractor/*.py`），yt-dlp 會列出 `DIR` 的每個子目錄再往下找 —— 直接把 `yt_dlp_plugins` 放在 `DIR` 本身永遠載不到（本次實測踩到）。`_video.py` 第 2840 行的 `_fetch_po_token` 依 `fetch_pot` 參數決定是否向 provider 取 token：`auto`（預設）只在 client 政策 `required` 時取，`always` 一律取。

**bgutil 2.0.2 的 BotGuard 流程**（`server/src/session_manager.ts`）：早期的 `/api/jnn/v1/Create` 端點已失效（其註解：「the /Create endpoint doesn't work anymore」），改為抓 YouTube 首頁取 `ytcfg.set({...})` 與 `window.ytAtN({...})`，`R.bgChallenge` 含 `program`、`globalName`、`interpreterUrl`；BotGuard 會讀 `yt.config_.EVENT_ID`，所以 `ytcfg` 必須先設到 `window.yt.config_`。接著下載直譯器 JS、`vm.a(program, …)` 取得 `asyncSnapshotFunction`、snapshot 得 `botguardResponse` 與 `webPoSignalOutput`，POST `https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT`（body `[REQUEST_KEY, botguardResponse]`，標頭 `content-type: application/json+protobuf`、`x-goog-api-key`、`x-user-agent: grpc-web-javascript/0.1`）回 `[integrityToken, ttlSecs, mintRefreshThreshold, …]`；`webPoSignalOutput[0](base64ToU8(integrityToken))` 得鑄造函式，鑄造結果以 websafe base64 回傳。

**NewPipe 的 `PoTokenWebView.kt`** 證明上述流程可在 Android 的隱藏 WebView 內執行：WebView 關閉網路載入、JS 只負責跑 BotGuard，HTTP 由 Kotlin 端做。NewPipe 仍使用 `/Create`，本案以 bgutil 的首頁挑戰取代。

**App 現況**：`YoutubeDlPlugin.load()` 初始化 yt-dlp；已相依 NanoHTTPD 2.3.1（`LocalFileServer`）；`YoutubeDLOptions` 以 `Map<String, List<String>>` 存選項，同一選項可重複。minSdk 24，可用 `CompletableFuture`。

## Goals / Non-Goals

**Goals**

- Android 端每次 YouTube 的 player / gvs / subs 請求都帶上本機鑄造的 PO Token。
- provider 任何一環失敗時，下載行為與 v1.0.126 完全相同。
- 伺服器協定與快取邏輯可在 JVM 單元測試驗證。

**Non-Goals**

- Windows 端、cookies 登入、設定頁開關、對 YouTube 以外站台的 token。

## Decisions

### 決策 1：以「本機 HTTP provider + yt-dlp 外掛」供 token，而非 `--extractor-args youtube:po_token=…`

手動傳 token 必須自行處理「哪個 client、哪個 context、綁 visitor data 還是影片 ID」—— nightly 已有「GVS token 綁影片 ID」的實驗，規則會變。走 provider 介面，這些判斷全由 yt-dlp 的 `get_webpo_content_binding` 決定，App 只回答「給這個 content binding 鑄一個 token」。

### 決策 2：沿用 bgutil 的 HTTP 協定，但外掛自己寫

協定（`/ping` 回 `version`、`/get_pot` 收 `content_binding` 與 `bypass_cache`、回 `poToken`）沿用 bgutil，好處是 `fix-bot-check-no-retry` 留下的 A/B 腳本與 bgutil 原廠外掛都能直接打這個伺服器交叉驗證。外掛不搬 bgutil 的：它是 GPL-3、含 node/deno script provider 與主版號比對，本案只需 HTTP 的 40 行。自製外掛的 provider key 為 `AvdWebView`，extractor arg 命名空間 `youtubepot-avdwebview`。

### 決策 3：挑戰來源用首頁 `ytAtN`，備援 `/youtubei/v1/att/get`

與 bgutil 2.0.2 一致。`ytAtN` 的內容是 JS 物件字面值而非嚴格 JSON（bgutil 以 `parseLooseJSON` 處理），本案直接交給 WebView 以 `new Function('return (…)')` 求值 —— 它本來就是 YouTube 頁面要給瀏覽器執行的內容，且 WebView 已斷網。`att/get` 回的是嚴格 JSON，Java 端以 `org.json` 解析。

### 決策 4：WebView `blockNetworkLoads`，HTTP 由 Java 端發

同 NewPipe。好處：WebView 不會載入任何外部資源、不留 cookie；首頁與直譯器 JS 的抓取可設逾時、可記 log。代價是直譯器 JS（約 200 KB）要透過 `evaluateJavascript` 以字串字面值灌進頁面 —— NewPipe 已如此運作。

### 決策 5：`fetch_pot=always`

被擋的是 player 請求；web/mweb 的 player 政策是「不需要 token」，`auto` 下 provider 根本不會被問（本次實測第一輪就是這樣白跑）。`always` 讓每個 context 都先取。代價：每次 YouTube 下載多一次本機 HTTP 往返（快取命中時 < 10 ms）。

### 決策 6：失敗退回（fail-open）而非失敗中止

外掛對任何錯誤都丟 `PoTokenProviderRejectedRequest`，yt-dlp 會改問下一個 provider（沒有）然後照常不帶 token。這保證 provider 永遠不會讓原本能下載的影片變成不能下載。

### 決策 7：伺服器只綁 127.0.0.1、埠固定 4416

與 bgutil 預設相同，外掛不必傳 `base_url`。只綁 loopback，區網其他裝置碰不到。若埠被占用，`load()` 記 log 並停用 provider（退回現況）。

### 決策 8：integrity token 與 PO Token 的生命週期

- integrity token：YouTube 給 `ttlSecs`（實測 43200 = 12 小時），到期前 10 分鐘視為過期，下次請求重建 WebView。
- PO Token：依 content binding 快取 6 小時（同 bgutil `TOKEN_TTL` 預設），`bypass_cache` 時重鑄並覆蓋快取。
- 鑄造失敗一次：重建 WebView 再試一次（NewPipe 的作法，應對 App 進背景後 WebView 內容遺失）；再失敗才回錯誤。

## Risks / Trade-offs

- **效果未經同 IP A/B 證實**：測試當下被擋狀態已消失。緩解：fail-open 保證不會更差；`fix-bot-check-no-retry` 的 `run_pot_test.ps1` 可在下次被擋時對本 App 的伺服器做 A/B（指向 `http://127.0.0.1:4416` 即可，不必再跑 PC 上的 bgutil）。
- **YouTube 改 BotGuard 或 GenerateIT**：bgutil 與 NewPipe 社群會跟進；本案流程與 bgutil 一致，屆時對照更新。失效時 fail-open。
- **首次下載多 2～5 秒**：首頁 + 直譯器 + BotGuard + GenerateIT。12 小時內只發生一次。
- **WebView 記憶體**：常駐一個隱藏 WebView（約 20～40 MB）。可接受；App 本身就是 Capacitor WebView。
- **`new Function` 執行 YouTube 頁面內容**：WebView 已斷網、無 cookie、與 App 主 WebView 隔離，風險等同在瀏覽器開 YouTube 首頁。

## Open Questions

- 若 A/B 證實 token 對被擋 IP 無效，下一步是 cookies 登入（Seal 的做法）。本案的伺服器與外掛可原樣保留，不衝突。
