## Why

經過實際網路測試，YouTube 官方 RSS 連線延遲僅 4~70ms 且極為穩定，能完全滿足頻道新片追蹤需求。原本在 RSS 失敗時「自動無縫切換 yt-dlp flat-playlist 備援」的機制存在潛在副作用：yt-dlp 啟動子行程解析耗時且消耗資源，且可能誤列入未登入無法下載的會員限定影片。此外，目前使用者無法直觀得知新影片是透過官方 RSS 還是 yt-dlp 備援抓取。

因此，應將 yt-dlp 備援機制改為**預設關閉**，並在設定中提供開關供進階使用者選擇；同時在檢查、排隊任務與日誌中**明確標註資料來源通道**（RSS 官方通道 vs. yt-dlp 備援通道），以實現極致效能與完全透明的使用者體驗。

## What Changes

- **預設關閉 yt-dlp 備援機制**：預設僅透過 YouTube 官方 RSS 獲取新片，杜絕不必要的 yt-dlp 子行程開銷。
- **設定選項新增備援開關**：在頻道監控設定中新增「啟用 yt-dlp 備援機制 (Fallback)」開關，預設為 `false`。
- **來源標記與通知透明化**：
  - 在 `DownloadService.fetchYouTubeRss` 回傳結果中明確標記 `source: 'rss' | 'fallback'`。
  - 主畫面下載任務的提示（`line`）明確標註通道來源（例如 `【自動追蹤 (RSS)】...` 或 `【自動追蹤 (yt-dlp 備援)】...`）。
  - 檢查完成的 Toast 提示明確告知抓取通道；若官方 RSS 失敗且未開啟備援時，明確提示連線失敗原因並引導開啟備援。

## Capabilities

### Modified Capabilities
- `channel-auto-monitor`: 修改頻道監控獲取邏輯，支援可選的 yt-dlp 備援開關（預設關閉），並在狀態提示中標記來源通道。

## Impact

- **Affected Code**:
  - `src/services/DownloadService.ts`: 修改 `fetchYouTubeRss`，支援 `options.enableFallback` 參數並回傳 `source` 欄位。
  - `src/App.vue`: 更新 `ChannelMonitorConfig` 資料模型、設定彈窗 UI 開關、`checkAllMonitoredChannels` 來源判斷與 Toast/Task 狀態提示。
