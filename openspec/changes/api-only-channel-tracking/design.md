## Context

動機與實測證據見 `proposal.md` 的 Why。行為契約見六份 delta spec。

本 change 以**刪除為主**，這決定了它的風險形狀與既有的功能新增完全不同：主要風險不是「新程式碼有 bug」，而是**刪過頭**（連帶砍掉仍被其他功能使用的東西）或**刪不乾淨**（留下無法到達的死碼與誤導後人的註解）。設計因此聚焦在「邊界在哪」。

規劃階段已完成的相依盤點：

```
  DownloadService 的頻道相關進入點          去留
  ----------------------------------------  --------------------------------
  fetchChannelRssWithRetry                  刪（含 7 個測試）
  parseFallbackNdjson                       刪
  checkVideoLiveStatus                      刪（逐支 yt-dlp 查詢）
  fetchChannelVideos 的 RSS / fallback 分支  刪，只留 API
  fetchChannelTitleFromRss                  改以 API 實作（不是刪）
  resolveYouTubeChannel                     保留（屬「加入頻道」而非「追蹤」）
```

`resolveYouTubeChannel` 用於將網址或 handle 解析為 `channelId`，是加入頻道的前置步驟，與追蹤無關；它在 Android 走 `YoutubeDlPlugin.resolveChannel`，該外掛方法必須保留。

`fetchChannelTitleFromRss` 目前自 RSS feed 根層的 `<title>` 取得頻道名稱，被兩處使用（`App.vue:1508` 的啟動時名稱修復、`:1754` 的加入頻道退回路徑）。RSS 移除後該路徑不存在，必須改以 API 實作而非直接刪除 —— 否則使用者的頻道會停在以網址為名的狀態（現況已有三個這樣的頻道）。

## Goals / Non-Goals

**Goals:**

- 頻道追蹤只剩單一資料通道，程式中不再存在第二條可能被靜默選用的路徑。
- 刪除的邊界精確：追蹤相關的全刪，下載與頻道解析完全不受影響。
- 檢查間隔與啟動時檢查成為使用者可設定項，且間隔有防止配額耗盡的下限。
- API 不可用時，使用者能在不主動檢查的情況下看見追蹤已停止。

**Non-Goals:**

- 不改動 yt-dlp 的下載職責，也不改動播放清單解析。
- 不改動既有的配額耗盡／金鑰無效抑制機制，沿用之。
- 不引入新的備援來源。移除備援是本 change 的目的，不是待補的缺口。
- 不做背景排程（app 被系統回收後仍能檢查）。那是獨立的功能缺口，見 Open Questions。

## Decisions

### 1.【D-A】以「移除後編譯不過」作為刪除完整性的檢查手段

**Decision:** 刪除順序由外而內：先刪呼叫端（`App.vue` 的分支、UI 開關），再刪被呼叫的函式，最後刪平台層（Rust 指令、Android 方法）。每一步都以 `vue-tsc --noEmit`、`cargo check`、`gradlew compileDebugJavaWithJavac` 確認。

**Rationale:** 刪除型改動最容易留下的痕跡是「還在但沒人呼叫」的死碼，而型別檢查抓不到未使用的匯出函式。由外而內刪則相反 —— 先移除呼叫端會讓被呼叫者立刻變成未使用，再刪它時若有其他呼叫端存在，編譯器會立刻報錯。這把「有沒有漏刪」與「有沒有誤刪」都變成編譯期問題。

**Alternatives:** 由內而外先刪底層 —— 會產生一長串連鎖編譯錯誤，難以分辨哪些是預期的、哪些是誤刪。

### 2.【D-B】`source` 欄位保留但收斂為單一值，不整個移除

**Decision:** `MonitoredVideoResult.source` 與 `MatchableVideo.source` 保留欄位，型別收斂為 `'api'`。`channelSourceLabel` 移除，任務狀態文字不再標註來源。

**Rationale:** 移除欄位會牽動 `useChannelMatching` 的測試夾具、`buildChannelVideoTask` 與既有任務資料 —— 使用者佇列中既有任務的 `source` 若突然不存在，型別與序列化都要處理。保留一個單值欄位的成本近乎為零，卻讓改動面小很多；日後若真要再加通道也不必重建。

**Alternatives:** 整個移除 —— 改動面擴大到任務持久化，收益只是少一個永遠為 `'api'` 的欄位。

### 3.【D-C】`rateLimit.ts` 只刪頻道 RSS 專用的部分，下載限流保留

**Decision:** 移除 `CHANNEL_RSS_RETRY_DELAYS_MS`、`channelRssRetryDelays`、`classifyChannelRssError`、`channelRssHttpStatus`、`describeChannelRssFailure` 及其測試。`isRateLimited`、`shouldBackoff`、`rateLimitBackoffMs` 等**下載路徑**的限流判定保留。

`describeEarlyStop`、`describeDegradedRound`、`CHANNEL_CHECK_DEGRADE_AFTER_FAILURES` 的去留**須於實作時依實際情形決定**：前者（裝置無網路即提早結束整輪）在 API 通道下依然成立；後者（連續失敗即降級為單次嘗試）的意義來自「省下 RSS 的分層重試等待」，而 API 路徑目前不做重試 —— 若確認無重試，該機制即為死碼，應一併移除。

**Rationale:** 這個檔案同時服務下載與頻道檢查兩條路徑，是最容易誤刪的地方。明確劃線可避免把下載的限流保護一起砍掉。

### 4.【D-D】檢查間隔的安全下限以「配額預算」推導，不用魔術數字

**Decision:** 下限由頻道數推導：

```
  每輪配額成本 = 啟用頻道數 x 2      （1 次取清單 + 1 次批次查直播）
  每日輪數     = 1440 / 間隔分鐘
  每日成本     = 啟用頻道數 x 2 x 1440 / 間隔分鐘

  令每日成本 <= 每日配額 x 安全係數，解得：

  最短間隔（分鐘） >= 啟用頻道數 x 2 x 1440 / (10000 x 安全係數)
```

安全係數建議 0.7，保留三成餘裕給手動檢查、加入頻道的名稱查詢，以及使用者於同一 Google Cloud 專案上的其他用途。

**Rationale:** 硬編一個「最短 5 分鐘」在 6 個頻道時過於保守、在 50 個頻道時會爆配額。以公式推導使下限隨頻道數自動調整，且該推導可直接寫進 UI 說明，使用者看得懂為什麼。

「每輪 2 units/頻道」是上界（該頻道有候選影片才會發第二次請求），故此估算偏保守 —— 這是對的方向。

**Alternatives:** 固定下限 —— 兩頭不討好。不設下限 —— 使用者加頻道後會在無預警下耗盡配額，而移除備援後那等於追蹤完全停止。

### 5.【D-E】停擺狀態指示置於頻道管理介面，而非主畫面

**Decision:** 「未設金鑰／金鑰無效／配額耗盡」的持續狀態指示，放在頻道管理彈窗的頂部；主畫面不新增常駐元素。

**Rationale:** 規格要求「持續可見」，但持續可見不等於「無所不在」。頻道追蹤的所有操作都在頻道管理彈窗內，使用者要查看追蹤狀況時必然會開啟它。在主畫面新增常駐警示會與既有的網路狀態元件爭空間，而手機版的主畫面已相當緊湊。

三種原因 MUST 可區分（解法不同：設定金鑰／修正金鑰／等待重置），配額耗盡者須說明會自動恢復。

**Alternatives:** 主畫面常駐橫幅 —— 更難忽略，但會擠壓主畫面且與網路狀態元件重疊。可於實作後觀察是否不足再議。

### 6.【D-F】以 API 取得頻道名稱，失敗不阻擋加入

**Decision:** 新增以 `channels.list?part=snippet` 取得頻道名稱的函式，取代 `fetchChannelTitleFromRss`。查詢失敗時沿用既有的退回行為（以使用者輸入作為暫時名稱），並於後續檢查成功時修復。

**Rationale:** 名稱取得屬輔助資訊，不應成為加入頻道的阻礙。既有的「啟動時自動修復以 UC 開頭為名的頻道」機制已存在，只需把它的資料來源換掉。

此查詢每次 1 unit，僅在加入頻道與名稱修復時發生，對配額預算的影響可忽略；但仍計入 D-D 的安全係數餘裕。

## Risks / Trade-offs

- **[配額耗盡或金鑰失效即追蹤完全停止]** → 使用者已知並接受（見 proposal）。以 D-D 的間隔下限、既有的當日用量估算、以及 D-E 的持續狀態指示三者降低衝擊。
- **[刪過頭：誤砍 `resolveYouTubeChannel` 或下載相關的 yt-dlp 路徑]** → 本 change 最主要的實作風險。以 D-A 的由外而內順序加上三項編譯檢查防護；`resolveChannel`、`download`、`parsePlaylist` 等 Android 方法明確列為保留清單。
- **[刪不乾淨：留下無法到達的死碼與提及 RSS 的過時註解]** → 實作後以關鍵字全域搜尋（`RSS`、`fallback`、`備援`）確認殘留，並逐一判斷是註解過時還是真有遺漏。
- **[既有使用者升級後追蹤突然停止]** → 使用者未設金鑰時，升級即等於功能停用。本專案的發布下載次數為每版 1～2 次（即使用者本人），無其他使用者受影響；但停擺指示仍須清楚，以免使用者自己忘記設定後困惑。
- **[間隔下限的公式可能過於保守或不足]** → 公式的輸入（每輪 2 units/頻道）是上界，且安全係數 0.7 留有餘裕。實際用量可自既有的當日用量估算觀察，日後可調整係數。
- **[移除 `isUpcomingLiveError` 可能誤傷下載錯誤分類]** → `matchPermanentError` 與 `LIVE_RELATED_ERRORS` 服務的是**下載失敗**分類，與直播狀態查詢無關，MUST 保留。兩者同在 `downloadErrors.ts` 中，刪除時須精確。

## Migration Plan

1. 先刪呼叫端：`App.vue` 的備援開關 UI 與設定、來源標註分支、`resolveLiveStatuses` 的逐支降級路徑。
2. 再刪服務層：`fetchChannelVideos` 的 RSS 與 fallback 分支、`fetchChannelRssWithRetry`、`parseFallbackNdjson`、`checkVideoLiveStatus`、`isUpcomingLiveError` 與其測試。
3. 改寫 `fetchChannelTitleFromRss` 為 API 實作。
4. 刪平台層：Rust 的 `fetch_channel_videos_fallback`、Android 的三個外掛方法。
5. 刪 `rateLimit.ts` 的頻道 RSS 專用部分（依 D-C 判斷 degrade 機制的去留）。
6. 新增檢查間隔與啟動時檢查的設定與其安全下限。
7. 新增停擺狀態指示。
8. 全域搜尋殘留，五項建置驗證，進版。

**回滾**：本 change 無資料模型變更。`enableYtDlpFallback` 設定值於還原舊備份時被忽略，不影響匯入。回滾即回到三層通道，無需清理狀態。

## Open Questions

- **背景排程**：目前的檢查倚賴 WebView 中的 `setInterval`，`KeepAliveService` 只服務下載任務。app 被系統回收後不再檢查，須等使用者下次開啟才補做。縮短檢查間隔會放大此落差的可見度（設 10 分鐘卻因 app 未開而數小時未檢查）。此問題不影響本 change 的規格與任務拆解，但若使用者在調短間隔後感到「設定沒有生效」，根因很可能在此。屬獨立的功能缺口，需 Android 原生排程（WorkManager），另案評估。
