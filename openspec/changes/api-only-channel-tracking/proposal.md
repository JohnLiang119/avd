## Why

官方 RSS 與 yt-dlp 備援在實測中都被證明**不可信**，而且失敗方式是「安靜地給出錯的資料」而非明確報錯 —— 那比直接壞掉更糟，因為使用者與程式都無從察覺。

**官方 RSS（2026-09-09～09-10 實測）：**

- 連續約一天回傳隨機的假 404／500。單一頻道 12 次取樣 6 成功 6 失敗；靜置十分鐘後複測仍失敗；同一時間 yt-dlp 自同一 IP 取用同一頻道完全正常，證實故障限於該端點。
- **陳舊快取**：09-10 15:0x 抓取時最新一筆為 01:03，而該頻道在 13:38、14:14、14:30、14:33 已發布四支影片。回應為 200、XML 格式完好 —— 程式無從判斷這份資料已落後 1.5 小時。

**yt-dlp 備援（2026-09-10 實測）：**

- **標題是自動翻譯的英文**。`--flat-playlist` 對 `vf2Df3qFG9A` 回傳 `Kombucha Quality Matters! Watch...`，其真實標題為「康普茶品質優劣原來差這麼多！抽好禮看特輯~專訪發酵專家...」。頻道關鍵字篩選比對的正是標題 —— 走備援時使用者設定的中文關鍵字**一個都不會命中**，功能靜默失效。
- **含會員限定影片**。`S4VRYfcLrLk` 出現在清單中，實際查詢回 `Join this channel to get access to members-only content`。建立任務後下載必然失敗。
- **排序不是最新優先**。`--playlist-end 12` 取回的最新一筆實為 09-08 的舊片。「每輪取最新 2 筆」取到的不是最新的 2 筆 —— 備援存在的唯一理由就是「RSS 掛掉時仍抓得到新片」，而它連這件事都做不到。
- 另有既知限制：`--flat-playlist` 不提供精確發布時間，錨點無從安全推進。

相對地，YouTube Data API v3 提供結構化的發布時間與直播狀態、每輪 50 筆視窗、官方服務水準，且實測往返僅 41～60 毫秒（RSS 78～218 ms、yt-dlp 逐支查詢 1845～3493 ms）。配額以目前用量僅佔約 3%。

使用者於 2026-09-10 明確選擇：**寧可在 API 不可用時完全停擺，也不要靜默降級到不可信的資料源。**

## What Changes

- **BREAKING：移除官方 RSS 與 yt-dlp 的頻道影片擷取路徑。** 頻道追蹤自此只有 YouTube Data API 一條通道。未設定有效金鑰時，頻道追蹤功能 MUST 明確停止並告知，MUST NOT 靜默改用其他來源。
- **BREAKING：移除逐支 yt-dlp 直播狀態查詢。** 直播狀態一律取自 API 的結構化欄位。
- **BREAKING：移除 `yt-dlp 備援` 開關**及其相關設定。
- 頻道名稱的取得由 RSS 改為 API（`channels.list`），供加入頻道與名稱修復使用。
- **檢查間隔改為使用者可設定**（既有的 `checkIntervalMinutes` 目前無 UI），並依頻道數提供安全下限，避免配額耗盡。
- **新增「啟動時是否檢查」設定**（目前為寫死行為）。
- **API 停擺時須有持續可見的狀態指示** —— 移除備援後已無任何網子，一則飄過的 Toast 不足以讓使用者察覺追蹤已停止。
- **不受影響**：yt-dlp 仍是影片下載的執行者；`resolveYouTubeChannel`（網址／handle 解析為 channelId）仍保留 —— 它屬「加入頻道」而非「追蹤」。

## Capabilities

### Removed Capabilities

- `yt-dlp-rss-fallback`: 整個能力移除。其存在前提是「官方 RSS 不穩時提供穩定備援」，而實測證明該備援的資料品質不足以承擔此責任（翻譯標題、會員限定影片、非最新優先、無精確時間）。

### Modified Capabilities

- `channel-auto-monitor`: 擷取通道由三層降為單一 API 通道；來源標註不再有多種來源；新增檢查間隔與啟動時檢查的可設定性及其安全下限。
- `auto-check-filtering`: 直播狀態的判定來源收斂為 API 的結構化欄位，移除「查詢工具錯誤訊息辨識」與「各平台以不同工具查詢仍須一致」的相關要求。
- `channel-check-feedback`: 失敗回饋由「RSS 連線異常／可開啟備援」改為「API 通道不可用」；新增未設定金鑰時的明確告知。
- `youtube-data-api-channel`: 金鑰由選填改為**頻道追蹤的必要條件**；新增以 API 取得頻道名稱；新增 API 不可用時的持續狀態指示。
- `windows-native-http-fetch`: 該通道的用途由「取得 RSS 等 XML 資源」改為「取得 API 的 JSON 回應」，其 Purpose 與情境需更新。

## Impact

- `src/services/DownloadService.ts`：移除 `fetchChannelRssWithRetry`、`parseFallbackNdjson`、`checkVideoLiveStatus`，以及 `fetchChannelVideos` 的 RSS 與 yt-dlp 分支；`fetchChannelTitleFromRss` 改以 API 實作。
- `src/services/rateLimit.ts`：移除頻道 RSS 專用的錯誤分級與分層重試表（`CHANNEL_RSS_RETRY_DELAYS_MS`、`channelRssRetryDelays`、`classifyChannelRssError`、`channelRssHttpStatus`、`describeChannelRssFailure`）。下載路徑的限流判定不受影響。
- `src/services/downloadErrors.ts`：移除 `UPCOMING_LIVE_ERRORS` 與 `isUpcomingLiveError`（僅為 yt-dlp 直播查詢而存在）。`matchPermanentError` 與 `LIVE_RELATED_ERRORS` **保留** —— 它們服務的是下載失敗分類，與頻道追蹤無關。
- `src/composables/useChannelMatching.ts`：`MatchableVideo.source` 收斂為單一值；`channelSourceLabel` 隨之簡化或移除。
- `src/App.vue`：移除備援開關與其 UI、來源標註分支；新增檢查間隔與啟動時檢查的設定 UI；新增 API 停擺的持續狀態指示。
- `src-tauri/src/lib.rs`：移除 `fetch_channel_videos_fallback` 指令。`fetch_http_text` **保留** —— API 通道在桌面端仍走它。
- `android/.../YoutubeDlPlugin.java`：移除 `fetchChannelRss`、`fetchChannelVideosFallback`、`checkVideoLiveStatus` 三個方法。`resolveChannel`、`download`、`parsePlaylist` 等**保留**。
- 測試：`DownloadService.spec.ts` 的 7 個 RSS 重試案例、`rateLimit.spec.ts` 中頻道 RSS 相關案例、`downloadErrors.spec.ts` 的 6 個 `isUpcomingLiveError` 案例隨其實作一併移除。

## 風險的正面聲明

移除備援後，**API 配額耗盡或金鑰失效即代表頻道追蹤完全停止，直到配額於太平洋時間午夜重置或使用者修正金鑰**。此為使用者已知並接受的取捨。本 change 以三項措施降低其衝擊：檢查間隔的安全下限、當日用量估算（既有）、以及停擺時持續可見的狀態指示。

`add-youtube-data-api-channel` 的既有設計已為配額耗盡與金鑰失效各自建立抑制機制，避免在不可用期間反覆發出必然失敗的請求；本 change 沿用之，不重新設計。

## 與其他 change 的依賴

- `add-youtube-data-api-channel` 與 `fix-anchor-pinned-by-perpetual-live` 皆已完成 45/45 與 19/19 但**尚未歸檔**。兩者的 delta 皆涉及本 change 要修改或移除的 Requirement。
- **本 change 必須待該兩者歸檔後才可實作**，其 delta 亦須以歸檔後的主規格文字為基底 —— 否則會互相覆寫。
- 版本 1.0.90 已發布並經使用者驗證，其中已包含上述兩個 change 的成果。
