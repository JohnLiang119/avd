## Why

2026-10-28 的實例：手機走 4G 下載 YouTube 影片被「Sign in to confirm you’re not a bot」擋下（見 `fix-bot-check-no-retry`）。追查結果是 YouTube 對「未經驗證」的 player 請求以 IP 信譽把關，行動網路的 CGNAT 共用 IP 容易被標記。真正的瀏覽器與 YouTube App 之所以不會被擋，是因為它們帶著 BotGuard 驗證產生的 **PO Token**（Proof of Origin）；yt-dlp 冒充 client 直接打 API，沒有這個 token。

同日在同一支手機、同一條 4G 上的實測（bgutil-ytdlp-pot-provider 2.0.2 在 PC 上產 token，經 adb reverse 供手機的 yt-dlp 使用）：

| client | 不帶 token | 帶 player + gvs PO Token |
| --- | --- | --- |
| mweb | 被擋 / 通過（依 IP 而定） | 通過 |
| web_safari | 同上 | 通過 |
| default（tv_samsung 等） | 同上 | 通過 |
| web | — | player 通過，但 YouTube 只給 SABR 串流，無可下載格式 |
| tv | — | UNPLAYABLE（無 cookies 的已知限制） |

整條「yt-dlp 外掛 → 本機 HTTP provider → BotGuard 鑄造」的鏈路在 Android 上可行。尚未取得的是「對照組被擋、實驗組通過」的同 IP A/B 鐵證 —— 測試當下手機重開機換了 IP，被擋狀態消失。bgutil 的 README 明言其用途就是「bypass the 'Sign in to confirm you're not a bot' message when invoking yt-dlp from an IP address flagged by YouTube」，但也註明不保證。

PC 上跑一個 provider 伺服器對手機沒有實用價值（4G 下連不到）。要讓 App 在任何網路下都帶 token，provider 必須內建在 App 裡。

## What Changes

### ① App 內建 PO Token provider（Android）

- 以隱藏的 `WebView` 執行 YouTube 的 BotGuard 虛擬機，產生 integrity token 與鑄造函式；之後每個 content binding（visitor data 或影片 ID）都能在本機鑄造 PO Token。流程與 bgutil 2.0.2 相同：抓首頁取 `ytcfg` 與 `ytAtN` 裡的 `bgChallenge` → 下載直譯器 JS → 跑 program 取 `botguardResponse` → 向 `GenerateIT` 換 integrity token → 鑄造。所有網路請求由 Java 端發出，WebView 不連網。
- 在 `127.0.0.1:4416` 開一個只綁本機的 NanoHTTPD 伺服器，提供與 bgutil 相同的 `GET /ping`、`POST /get_pot`、`POST /invalidate_caches`。token 依 content binding 快取 6 小時，`bypass_cache` 時重新鑄造。
- integrity token 到期（YouTube 給 12 小時，保留 10 分鐘邊際）或鑄造失敗時自動重建 WebView 再試一次。

### ② 自製 yt-dlp PO Token provider 外掛

一支 60 行的 Python 外掛 `getpot_avd.py`，實作 yt-dlp 的 `PoTokenProvider` 介面，支援 WebPO client（web、mweb、tv 等）的 player / gvs / subs 三種 context，向本機伺服器取 token。隨 App 的 assets 出貨，啟動時複製到 `noBackupFilesDir/ytdlp-plugins/avd/`。不直接搬用 bgutil 的外掛：它是 GPL-3、帶著 node/deno script 模式與版本比對，本案只需要 HTTP 這一段。

### ③ yt-dlp 請求帶上外掛與 `fetch_pot=always`

影片 metadata 預取、批次 `--dump-json` 補資料、正式下載三處請求加上 `--plugin-dirs` 與 `--extractor-args youtube:fetch_pot=always`。預設的 `fetch_pot=auto` 只在 client 政策標為「必要」時才取 token，而 web/mweb 的 player 階段政策是「不需要」，等於 player 請求根本不帶 token —— 這正是被擋的那一步。`always` 強制每個 context 都先向 provider 取。

### ④ 失敗即退回現況

provider 任何一環失敗（WebView 不可用、YouTube 改了 BotGuard、本機伺服器沒起來），外掛回報「拒絕此請求」，yt-dlp 照常以無 token 的方式下載，行為與 v1.0.126 相同。不得因 provider 失敗而讓下載失敗。

## Capabilities

### New Capabilities

- `youtube-po-token`：Android 端 YouTube 下載的 PO Token 供應：本機 provider、BotGuard 鑄造、快取與到期重建、失敗退回。

### Modified Capabilities

（無）`download-retry-policy` 的 bot 驗證判定與訊息維持不變；本案是在被擋之前就帶上 token。

## Impact

**新增**

- `android/app/src/main/java/com/mattpocock/avd/PoTokenWebView.java` — 隱藏 WebView + BotGuard 流程
- `android/app/src/main/java/com/mattpocock/avd/PoTokenServer.java` — 本機 HTTP provider 與快取
- `android/app/src/main/assets/po_token.html` — WebView 內執行的 BotGuard 載入與鑄造 JS
- `android/app/src/main/assets/ytdlp-plugins/avd/yt_dlp_plugins/extractor/getpot_avd.py` — yt-dlp 外掛
- `android/app/src/test/java/com/mattpocock/avd/PoTokenServerTest.java` — 伺服器協定與快取的 JVM 單元測試

**修改**

- `YoutubeDlPlugin.java` — `load()` 啟動 provider、複製外掛；三處 yt-dlp 請求加上選項

**不做的事**

- Windows 端不帶 token：Tauri 端沒有可用的 BotGuard 執行環境，而固網 IP 目前未見被擋。
- 不做 cookies 登入：待本案的效果用 `fix-bot-check-no-retry` 留下的 A/B 腳本在下次被擋時驗證；若證實無效再評估。
- 不做設定頁開關：provider 失敗即退回現況，使用者無需介入；診斷以 logcat 標籤 `PoToken` 為準。
