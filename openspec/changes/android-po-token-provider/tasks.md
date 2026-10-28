# 實作任務

## 1. ② yt-dlp PO Token provider 外掛

- [x] 1.1 `assets/ytdlp-plugins/avd/yt_dlp_plugins/extractor/getpot_avd.py`：實作 `PoTokenProvider`（WebPO client、player/gvs/subs），向 `http://127.0.0.1:4416/get_pot` 取 token，任何錯誤丟 `PoTokenProviderRejectedRequest`
- [x] 1.2 `YoutubeDlPlugin.load()` 把 assets 的外掛目錄複製到 `noBackupFilesDir/ytdlp-plugins/`（每次啟動覆蓋）

## 2. ① BotGuard 鑄造（WebView）

- [x] 2.1 `assets/po_token.html`：`applyHomepageChallenge`、`runBotGuard`、`setIntegrityToken`、`mintPoToken` 四個入口，結果經 `PoTokenBridge` 回 Java
- [x] 2.2 `PoTokenWebView.java`：主執行緒建立斷網 WebView；Java 端抓首頁（備援 `att/get`）、直譯器 JS、`GenerateIT`；integrity token 到期判定；`mint()` 可自背景執行緒呼叫並等待結果；失敗重建一次
- [x] 2.3 Console 出現 `Uncaught` 視為 WebView 不可用，之後的請求直接拒絕

## 3. ① 本機 HTTP provider

- [x] 3.1 `PoTokenServer.java`：NanoHTTPD 綁 `127.0.0.1:4416`，`GET /ping`、`POST /get_pot`、`POST /invalidate_caches`；token 依 content binding 快取 6 小時；錯誤以 JSON `{"error": …}` 回 500
- [x] 3.2 `YoutubeDlPlugin.load()` 啟動伺服器，失敗記 log 並停用 provider

## 4. ③ yt-dlp 請求帶上外掛

- [x] 4.1 `addPoTokenOptions()`：`--plugin-dirs <ytdlp-plugins>` 與 `--extractor-args youtube:fetch_pot=always`，套用於 metadata 預取、批次 `--dump-json`、正式下載三處

## 5. 測試與建置

- [x] 5.1 `PoTokenServerTest.java`：`/ping` 版本、`/get_pot` 成功、快取命中不重鑄、`bypass_cache` 重鑄、鑄造失敗回 500 JSON、缺 `content_binding` 回 400
- [x] 5.2 `gradlew :app:testDebugUnitTest` 與 `:app:compileDebugJavaWithJavac` 通過；`npm run build`、`npx vue-tsc --noEmit`、`npm test`、`cargo check` 維持通過
- [x] 5.3 `openspec validate android-po-token-provider --strict` 通過

## 6. 驗證

- [ ] 6.1 實機（4G）：logcat 標籤 `PoToken` 出現 integrity token 就緒與鑄造紀錄；yt-dlp 進度行出現 `[pot:AvdWebView] Generating a player PO Token`；影片下載成功
- [ ] 6.2 實機：下次被 bot 驗證擋下時，以 `run_pot_test.ps1` 對 App 的 `127.0.0.1:4416` 做同 IP A/B，記錄結果於本檔
