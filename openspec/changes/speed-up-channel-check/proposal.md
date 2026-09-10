## Why

按下頻道追蹤的「立即檢查」後要等一陣子，而 Android 端在等待期間畫面**完全沒有回饋** —— 使用者無從判斷是還在跑、還是已經卡死。

v1.0.91 移除 RSS 與 yt-dlp 備援後，單頻道只剩一個 API 請求，理論上整輪應在數百毫秒內完成；實測仍感覺慢，故針對 Android 路徑逐項量測，找到三個原因，其中兩個是純浪費：

**1. 每輪都在下載並解析當場就丟棄的資料。** `playlistItems` 請求為 `part=snippet,contentDetails` 搭配 `maxResults=50`，而 `parsePlaylistItems` 只讀三個欄位：`snippet.title`、`contentDetails.videoId`、`contentDetails.videoPublishedAt`。回應中的 `description`（單筆可達數 KB）、五種尺寸的 `thumbnails`、`channelTitle`、`playlistId`、`position`、`videoOwnerChannelTitle` 等全數丟棄。粗估每頻道每輪 100～150 KB，其中約九成五無用，且必須在手機上完整 `JSON.parse`。`videos.list` 同病：要了 `part=snippet,liveStreamingDetails`，但 `mapLiveStatus` 只讀 `snippet.liveBroadcastContent`，`liveStreamingDetails` 整包從未被任何 production 程式碼讀取。

**2. 請求完全沒有逾時。** Android 走 WebView 的 `fetch()`，沒有 `AbortController`（全專案無此字）。一個卡住的請求會**無限期**擋住整輪，使用者看到永不結束的轉圈。桌面端至少有 Rust 的 10 秒連線與讀取逾時，Android 一點都沒有。

**3. 沒有任何進度回饋。** 只有一則「正在檢查 N 個頻道...」的 Toast，之後直到整輪結束才有下一則訊息。使用者既看不出進行到哪，也看不出是哪個頻道慢。

量測過程另外發現**四處失敗只寫 `console.warn` 而未入錯誤日誌**，使「為什麼慢」與「為什麼沒抓到新片」事後都無從追查。其中一處（整輪開頭即因缺少金鑰等原因停擺）已違反 `error-journal` 既有的「MUST NOT 讓錯誤只以稍縱即逝的提示呈現而不留紀錄」。

## What Changes

- **`playlistItems` 與 `videos.list` 加上 `fields` 遮罩**，只取實際讀取的欄位；`videos.list` 一併移除未使用的 `liveStreamingDetails`。配額成本不變（配額按請求數計，不按欄位數），但傳輸量與 JSON 解析量大幅下降。
- **頻道追蹤的所有 API 請求加上逾時上限**，兩個平台一致。逾時 MUST 產生可辨識的錯誤，使其與「服務回報失敗」可區分。
- **檢查進行中提供逐頻道進度回饋**，且 MUST 標示當前頻道名稱 —— 進度本身是使用者要的，而「是哪個頻道慢」是判斷 Non-goals 那兩項值不值得做的唯一依據。
- **補上四處未入帳的失敗**：整輪開頭即停擺、直播狀態批次查詢失敗、頻道名稱查詢失敗、全頻道模擬的逐頻道失敗。
- **新增「持續性狀況只記錄狀態轉換」的約束**：日誌保留上限為 50 筆且保留**最新**的 50 筆，而未設金鑰之類的狀態會持續存在、自動排程每分鐘核對一次 —— 若每次都寫一筆，50 分鐘內整份日誌就只剩同一句話，把真正有用的紀錄全部擠掉。

**Non-goals** —— 刻意不做，留待本 change 的進度回饋提供逐頻道耗時後再判斷：

- **並行擷取頻道**。循序改並行可把整輪壓到約等於單一請求的時間，但要重構整個檢查迴圈，且「提早停止」與「中途停擺」的語意都得重新設計（並行之下無法宣稱「尚有 N 個頻道未檢查」）。進度回饋的形狀也會隨之改變：循序能說「正在檢查 3/20：某頻道」，並行只能說「已完成 7/20」，後者失去指認慢頻道的能力。
- **改以原生外掛方法取代 Android 的 `fetch()`**。金鑰走 `X-goog-api-key` 標頭（規格明訂不得放進網址），使每個請求都不是 CORS simple request 而觸發一次 OPTIONS 預檢；預檢快取按完整 URL 計，而各頻道的 `playlistId` 不同故從不命中 —— 於是每個請求實際是兩個往返。走原生可同時消掉預檢、取得連線池與原生逾時，但那是新增平台層程式碼，且與 `api-only-channel-tracking` 剛移除 Android 頻道方法的方向相反。值得等有數字再決定。

## Capabilities

### Modified Capabilities

- `youtube-data-api-channel`: 擷取請求 MUST 只索取實際使用的欄位；頻道追蹤的 API 請求 MUST 有逾時上限且逾時須可辨識。
- `channel-check-feedback`: 新增「檢查進行中須有逐頻道進度回饋」。
- `error-journal`: 新增「影響追蹤結果的失敗即使未向使用者提示亦 MUST 入帳」與「持續性狀況只記錄狀態轉換，不得每輪重複寫入」。

## Impact

- `src/services/youtubeDataApi.ts`：`buildPlaylistItemsRequest`、`buildVideosRequest`、`buildChannelUploadsRequest`、`buildChannelSnippetRequest` 加上 `fields`；新增逾時錯誤的辨識。**`fields` 遮罩與 `parsePlaylistItems`／`mapLiveStatus` 讀取的欄位形成耦合** —— 改其中一邊就必須同步改另一邊，否則欄位會靜默變成 `undefined`。此耦合須以測試釘住。
- `src/services/DownloadService.ts`：`fetchApiJson` 的非 Tauri 分支加上 `AbortController` 逾時；`resolveLiveStatuses` 的批次失敗改為可上報給呼叫端記帳；`fetchChannelTitle` 的失敗同理。
- `src/App.vue`：新增進度狀態與其 UI；補上四處錯誤入帳；停擺狀態的入帳須依「只記轉換」實作。
- `src-tauri/src/lib.rs`：Rust 端已有 10 秒逾時，僅需確認其錯誤前綴與前端的逾時辨識一致；若已一致則不改。
- 測試：`youtubeDataApi.spec.ts` 新增 `fields` 遮罩與所讀欄位一致性的案例、逾時辨識的案例；`useErrorLog.spec.ts`（若無則新增）驗證「只記轉換」的純函式。

## 與其他 change 的依賴

`api-only-channel-tracking` 已實作並隨 v1.0.91 發布，但**尚未歸檔**（7.4～7.7 人工驗證未完成）。本 change 的 delta 與其 delta 所修改的是**不同的 Requirement**，不會互相覆寫，故兩者歸檔順序不受限制。

但有一處必須明說：本 change MODIFY「以 uploads 播放清單擷取頻道新片」時必須重述該 Requirement 全文，而其現有文字仍寫著「與官方 RSS、yt-dlp 備援共用的內部影片結構」與「MUST NOT 發出官方 RSS 請求，亦 MUST NOT 啟動 yt-dlp」。`api-only-channel-tracking` 的 delta 並未修改這個 Requirement，那些描述在其歸檔後會殘留為過時文字。本 change 既然要重寫這段，即順帶改為與單一通道一致的敘述 —— 這是刻意的順手清理，不是範圍蔓延。
