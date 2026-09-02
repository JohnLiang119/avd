## 1. 核心下載服務介面擴充

- [x] 1.1 更新 `src/services/DownloadService.ts` 中的 `fetchYouTubeRss` 函式簽名，支援 `options?: { enableFallback?: boolean }`
- [x] 1.2 在 `fetchYouTubeRss` 成果中標註 `source: 'rss' | 'fallback'`，並在 `enableFallback: false` 時遇到 RSS 異常直接拋錯不再呼叫 yt-dlp

## 2. 設定模型與 UI 控制項建置

- [x] 2.1 更新 `src/App.vue` 中的 `ChannelMonitorConfig` 介面與 `localStorage` 初始化相容邏輯，新增 `enableYtDlpFallback`（預設 `false`）
- [x] 2.2 在「頻道自動追蹤排程」彈窗中新增「啟用 yt-dlp 備援機制」開關與說明文字

## 3. 檢查流程與狀態通知透明化

- [x] 3.1 更新 `checkAllMonitoredChannels` 與 `simulateNewVideo`，傳遞 `monitorConfig.enableYtDlpFallback` 至 `fetchYouTubeRss`
- [x] 3.2 更新加入佇列的任務狀態文字（`line`），依據 `source` 標註 `【自動追蹤 (RSS)】` 或 `【自動追蹤 (yt-dlp 備援)】`
- [x] 3.3 重構檢查結果的 Toast 提示訊息，明確區分官方 RSS 通道、yt-dlp 備援通道，並在連線失敗時提示開啟備援
