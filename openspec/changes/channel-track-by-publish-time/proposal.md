## Why

目前頻道自動追蹤機制使用「檢查執行當下的系統時間 (`lastCheckTime`)」作為下次比對基準。由於 YouTube RSS Feed 常存在 5 至 30 分鐘的快取與索引延遲，若新影片在檢查週期之間發布但尚未出現在 RSS 中，當次檢查會先將 `lastCheckTime` 推進到最新時間，導致下次檢查時該影片因發布時間早於 `lastCheckTime` 而被永久漏抓。

將更新基準重構為「頻道最新影片的實際發布時間 (`lastPublishedTime`)」，可徹底消除 RSS 快取延遲導致的漏片問題，讓定時輪詢與新片比對更加精確且具冪等性。

## What Changes

- **以影片實際發布時間為基準**：頻道模型新增/遷移至 `lastPublishedTime`（最新已知影片的發布時間戳記），以取代易受輪詢執行時點影響的 `lastCheckTime`。
- **雙重錨點防護 (Timestamp + Video ID)**：比對條件升級為 `publishedTime > lastPublishedTime` 
- **舊資料平滑遷移**：支援自動將現有 `localStorage` 中的 `lastCheckTime` 平滑過渡至 `lastPublishedTime`。
- **備援機制時間解析相容**：當官方 RSS 失敗切換至 `yt-dlp` flat-playlist 或 Android 首頁解析時，確保發布時間轉換正確，避免污染時間游標。
- **頻道卡片視覺化發布時間展示**：在已追蹤頻道管理卡片中（頻道名稱後方或最新影片欄位），直觀顯示該頻道最新影片的實際發布時間（格式如 `2026/11/01 16:13:15`），讓使用者掌握頻道發片動態與追蹤基準。
- **主畫面任務標題附帶發布時間**：所有影片下載任務（包含由使用者手動單一輸入加入、頻道自動追蹤、測試模擬或播放清單解析加入），於主畫面任務標題（抬頭）後方一律自動附帶影片實際發布時間（例如「`[頻道名] 影片標題 (2026/11/01 16:13:15)`」或「`影片標題 (2026/11/01 16:13:15)`」格式），讓主佇列所有影片的發布時間一目了然。
## Capabilities

### Modified Capabilities
- `channel-auto-monitor`: 更新新影片判定與時點記錄規格，從以檢查執行時間 (`lastCheckTime`) 判定改為以影片實際發布時間 (`lastPublishedTime`) 判定，並加入同時間發布去重錨點。

## Impact

- **前端狀態與任務模型 (`src/App.vue`)**：
  - 更新 `MonitoredChannel` 型別定義與預設值。
  - 擴充 `DownloadTask` 結構化欄位（`publishTimeStr`、`channelPrefix`、`rawTitle`）並實作防覆蓋標題合成機制。
  - 重構 `checkAllMonitoredChannels`、`addManualChannel`、`exportChannelsJson`、`downloadProgress`、`processQueue` 與備份還原邏輯中的時間欄位處理。
- **Android 原生端 (`android/.../YoutubeDlPlugin.java`)**：
  - 在 `download()` 流程中新增 YouTube（`upload_date`/`timestamp`/`uploader`）與 TikTok（`create_time`）的發布時間及頻道資訊提取與回傳。
- **資料儲存 (`localStorage`)**：相容現有 `avd_monitored_channels` 快取資料與 `avd_tasks` 任務快取。

