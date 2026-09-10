## 0. 刪除的邊界（先讀，這是本 change 最大的風險）

本 change 以**刪除**為主。主要風險不是新程式碼有 bug，而是**刪過頭**或**刪不乾淨**。
動手前先記住這張表：

```
  刪                                      保留（碰到就是刪錯了）
  --------------------------------------  --------------------------------------
  fetchChannelRssWithRetry + 7 個測試      resolveYouTubeChannel（加入頻道用）
  parseFallbackNdjson                     YoutubeDlPlugin.resolveChannel
  checkVideoLiveStatus（逐支 yt-dlp）      YoutubeDlPlugin.download / parsePlaylist
  fetchChannelVideos 的 RSS / fallback     YoutubeDlPlugin.enrichItems
  isUpcomingLiveError + UPCOMING_LIVE_*    matchPermanentError + LIVE_RELATED_ERRORS
  rateLimit 的頻道 RSS 專用部分            rateLimit 的下載限流（isRateLimited 等）
  Rust fetch_channel_videos_fallback       Rust fetch_http_text（API 走它）
  Android fetchChannelRss                  Android probeInternetConnectivity
  Android fetchChannelVideosFallback       yt-dlp 的下載職責（完全不動）
  Android checkVideoLiveStatus
  enableYtDlpFallback 設定與 UI
```

**`fetchChannelTitleFromRss` 是改寫不是刪除** —— 它取頻道名稱，RSS 沒了要改用 API，
直接刪會讓頻道停在以網址為名的狀態（使用者目前已有三個這樣的頻道）。

【D-A】刪除順序**由外而內**：先刪呼叫端，再刪被呼叫者，最後刪平台層。
每一步都跑型別／編譯檢查 —— 先刪呼叫端會讓被呼叫者立刻變成未使用，
此時再刪它若還有其他呼叫端，編譯器會當場報錯。反過來做只會得到一長串
難以分辨是預期還是誤刪的連鎖錯誤。

測試可行性：純函式層（`downloadErrors`、`rateLimit`、`useChannelMatching`、
`youtubeDataApi`）有自動測試；`App.vue` 的佈線與 UI 無自動測試覆蓋
（本專案未安裝 `@vue/test-utils`），以靜態核對加第 7 節驗證為完成方式。

## 1. 呼叫端（`App.vue`）

- [ ] 1.1 移除 yt-dlp 備援開關的 UI 與 `ChannelMonitorConfig.enableYtDlpFallback`，並確認四個 `fetchChannelVideos` 呼叫點不再傳 `enableFallback`；完成方式：`grep -rn "enableYtDlpFallback\|enableFallback" src/` 無殘留
- [ ] 1.2 移除任務狀態文字的來源標註分支與 `channelSourceLabel`；完成方式：`grep -rn "channelSourceLabel" src/` 無殘留，`npx vue-tsc --noEmit` 通過
- [ ] 1.3 移除 `resolveLiveStatuses` 的逐支降級路徑，使其只走 API 批次；批次失敗時的保守處置（全部 `unknown`）與錯誤上報 MUST 保留 —— 那是規格明訂且與本 change 無關；完成方式：`grep -n "checkVideoLiveStatus" src/services/DownloadService.ts` 僅剩待刪的定義本身

## 2. 服務層（`DownloadService`）

- [ ] 2.1 移除 `fetchChannelVideos` 的 RSS 與 yt-dlp fallback 分支，只留 API 路徑；未設金鑰時 MUST 拋出可辨識的「缺少金鑰」錯誤，MUST NOT 靜默回傳空清單（空清單會被上層當成「沒有新影片」）；完成方式：該函式內不再出現 `fetch_http_text` 的 RSS 網址與 `fetch_channel_videos_fallback`
- [ ] 2.2 移除 `fetchChannelRssWithRetry` 及 `DownloadService.spec.ts` 中的 7 個重試案例；完成方式：`npm test` 通過且該檔不再匯入該函式
- [ ] 2.3 移除 `parseFallbackNdjson`；完成方式：`grep -rn "parseFallbackNdjson" src/` 無殘留
- [ ] 2.4 移除 `checkVideoLiveStatus`；完成方式：`grep -rn "checkVideoLiveStatus" src/` 僅剩註解（註解亦須更新或刪除）
- [ ] 2.5 【D-F】改寫 `fetchChannelTitleFromRss` 為以 `channels.list?part=snippet` 取得頻道名稱，並更名為不含 Rss 的名稱；查詢失敗 MUST 回傳空字串沿用既有退回行為，MUST NOT 拋錯阻擋頻道加入；完成方式：兩個呼叫點（啟動時名稱修復、加入頻道退回）皆已更新，`npx vue-tsc --noEmit` 通過
- [ ] 2.6 `MonitoredVideoResult.source` 與 `MatchableVideo.source` 型別收斂為 `'api'`（【D-B】保留欄位不移除）；完成方式：`npx vue-tsc --noEmit` 通過，`useChannelMatching.spec.ts` 的夾具已同步

## 3. 錯誤分類（`downloadErrors` / `rateLimit`）

- [ ] 3.1 移除 `UPCOMING_LIVE_ERRORS` 與 `isUpcomingLiveError` 及其 6 個測試。**`matchPermanentError` 與 `LIVE_RELATED_ERRORS` MUST 保留** —— 它們服務下載失敗分類，與直播狀態查詢無關；完成方式：`npx vitest run src/services/__tests__/downloadErrors.spec.ts` 綠燈且 `matchPermanentError` 的案例全數保留
- [ ] 3.2 【D-C】移除 `rateLimit.ts` 的頻道 RSS 專用部分：`CHANNEL_RSS_RETRY_DELAYS_MS`、`channelRssRetryDelays`、`classifyChannelRssError`、`channelRssHttpStatus`、`describeChannelRssFailure` 及其測試。**下載路徑的限流判定 MUST 保留**；完成方式：`npx vitest run src/services/__tests__/rateLimit.spec.ts` 綠燈
- [ ] 3.3 【D-C】判斷 `describeEarlyStop`、`describeDegradedRound`、`CHANNEL_CHECK_DEGRADE_AFTER_FAILURES` 的去留：提早停止（裝置無網路即中止整輪）在 API 通道下仍成立應保留；降級（連續失敗改單次嘗試）的意義來自省下 RSS 的分層重試，若 API 路徑確認無重試則為死碼應移除。完成方式：於 tasks 記錄判斷依據與結論，`grep` 確認無死碼殘留

## 4. 平台層

- [ ] 4.1 移除 Rust 的 `fetch_channel_videos_fallback` 指令及其 `invoke_handler` 註冊。**`fetch_http_text` MUST 保留** —— API 通道在桌面端走它；完成方式：`cargo check --manifest-path src-tauri/Cargo.toml` 通過
- [ ] 4.2 移除 Android 的 `fetchChannelRss`、`fetchChannelVideosFallback`、`checkVideoLiveStatus` 三個 `@PluginMethod`。**`resolveChannel`、`download`、`parsePlaylist`、`enrichItems`、`probeInternetConnectivity` 等 MUST 保留**；完成方式：`gradlew :app:compileDebugJavaWithJavac` 通過，且保留清單中的方法逐一確認仍在
- [ ] 4.3 確認 `.java` 檔未被寫入 BOM（javac 不接受，本專案曾踩過）；完成方式：`head -c 3 <file> | xxd -p` 為 `706163`，與其他 `.java` 一致

## 5. 新增設定

- [ ] 5.1 檢查間隔改為可設定：既有的 `checkIntervalMinutes` 接出 UI；完成方式：設定後重啟仍生效（由 7.4 人工驗證）
- [ ] 5.2 【D-D】實作間隔安全下限的計算純函式：`最短間隔 >= 啟用頻道數 x 2 x 1440 / (10000 x 0.7)`；完成方式：單元測試驗證 6 個頻道→約 2.5 分鐘、20 個→約 8.2 分鐘、50 個→約 20.6 分鐘，且 0 個頻道不回傳 0 或負值
- [ ] 5.3 設定低於下限時 MUST 阻止或明確警示，MUST NOT 靜默接受；下限的依據（頻道數與每日配額）MUST 於 UI 說明；完成方式：由 7.4 人工驗證
- [ ] 5.4 頻道數增加使既有間隔低於新下限時，MUST 於頻道管理介面告知；完成方式：由 7.4 人工驗證
- [ ] 5.5 新增「啟動時是否檢查」設定，預設 MUST 維持既有行為（距上次檢查已達間隔時補做）；完成方式：`grep -n "checkOnStartup" src/App.vue` 呈現設定與其於 `onMounted` 的判斷，由 7.4 人工驗證

## 6. 停擺狀態指示

- [ ] 6.1 【D-E】於頻道管理彈窗頂部新增持續可見的狀態指示，涵蓋「未設金鑰」「金鑰無效」「配額耗盡」三種原因且可明確區分；配額耗盡者 MUST 說明會自動恢復；MUST NOT 包含金鑰任何片段；完成方式：三種狀態的文案由純函式產生並加測試（互異、不含假金鑰片段），佈線由 7.5 人工驗證
- [ ] 6.2 未設金鑰時的檢查回饋 MUST NOT 顯示「目前沒有新影片」或「無法連線至 YouTube」；完成方式：訊息片段測試驗證該文案與既有兩者皆不同
- [ ] 6.3 未設金鑰的狀態持續時，自動排程 MUST NOT 每次到期都重複彈出相同提示；完成方式：`grep` 呈現該提示受一次性旗標或抑制保護

## 7. 驗證

- [ ] 7.1 執行五項建置驗證全數通過：`npm run build`、`npm test`、`npx vue-tsc --noEmit`、`cargo check --manifest-path src-tauri/Cargo.toml`、`gradlew :app:compileDebugJavaWithJavac`
- [ ] 7.2 【刪不乾淨的檢查】全域搜尋 `RSS`、`fallback`、`備援`、`yt-dlp 備援` 於 `src/`、`src-tauri/src/`、`android/app/src/`，逐一判斷是「過時註解」還是「真有遺漏」；完成方式：列出所有命中與其判斷結果，確認無可到達的死碼
- [ ] 7.3 【刪過頭的檢查】確認下載功能完全未受影響：`grep` 確認 `resolveYouTubeChannel`、`matchPermanentError`、下載相關的 yt-dlp 呼叫、以及保留清單中的 Android 方法皆在
- [ ] 7.4 人工驗證【設定】：檢查間隔可設定且重啟後生效；低於安全下限時被阻止並說明依據；新增頻道使下限提高時有告知；關閉「啟動時檢查」後啟動不立即檢查而定時檢查照常
- [ ] 7.5 人工驗證【停擺指示】：分別造出未設金鑰、金鑰無效、配額耗盡三種狀態，確認頻道管理介面的指示持續可見、三者可區分、配額耗盡者說明會自動恢復、且皆不含金鑰片段
- [ ] 7.6 人工驗證【未設金鑰】：清空金鑰後手動檢查，確認告知追蹤已停止且指出可於設定填入，MUST NOT 顯示「目前沒有新影片」或「無法連線至 YouTube」；並確認下載單一影片、解析播放清單、加入頻道（名稱可能退回為網址）皆照常運作
- [ ] 7.7 人工驗證【Android】：於實機重複 7.6，並確認移除三個外掛方法後 app 不崩潰、下載與頻道解析正常

## 8. 提交與版本進版

- [ ] 8.1 建立功能修正 commit，並以 `git status --short` 與 commit diff 確認只包含本 change 的程式、測試及 OpenSpec 任務進度
- [ ] 8.2 將 avd 下一版版號同步更新至七處：`package.json`、`package-lock.json`（2 處）、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`（以 `cargo update --workspace --offline` 同步）、`android/app/build.gradle` 的 `versionName`／`versionCode`（皆須遞增），並更新 `avd_s/publish_all.ps1` 的版本化預設發布說明
- [ ] 8.3 【發布說明須含 BREAKING 提示】此版移除 RSS 與 yt-dlp 備援，**未設定 API 金鑰者頻道追蹤將停止運作**。發布說明 MUST 明確告知此行為變更與其解法；完成方式：`publish_all.ps1` 的預設 `$Message` 含該提示
- [ ] 8.4 重新執行五項建置驗證全數通過後，建立獨立的版本進版 commit（與 8.1 分開）；**提交與進版期間 MUST NOT 併行執行發布腳本** —— 工作區乾淨且已推送後，才由使用者手動執行
