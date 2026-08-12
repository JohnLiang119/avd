# 實作提案：YouTube 解析與批次下載選頻導嚮介面 (YouTube Quality Selection & Batch Download Dialog)

## Why

目前使用者在解析 YouTube 播放清單或單影片時，缺乏直觀的影片解析度與格式選擇嚮導介面（品質選擇/選頻嚮導），無法在下載前勾選特定品質、勾選/取消特定影片項目，或進行一次性批次下載與格式套用。提供直觀的選頻嚮導對話框，可大幅提升使用者批次下載 YouTube 影音的體驗與彈性。

## What Changes

- **新增 YouTube 批次下載/選頻嚮導對話框 (YouTube Batch Download & Quality Selection Dialog)**：
  - 解析 YouTube 連結(播放清單已經有了)，跳出選頻嚮導彈窗。
 
  - 清單項目勾選表單，可全選、全不選、複選指定集數/影片。
- **支援一次性批次下載觸發**：
  - 勾選項目後，點擊「開始批次下載」即可整批加入下載佇列並執行下載。
- **狀態與進度即時顯示**：
  - 於 UI 上清楚展示批次下載佇列、個別項目進度條與下載速度。

## Capabilities

### New Capabilities
- `youtube-download`: 提供 YouTube 影片/播放清單之品質選頻嚮導對話框、多集勾選與一次性批次下載管理功能。

### Modified Capabilities
（無修改現有能力，此為新增功能）

## Impact

- **前端 UI (Vue 3 / TypeScript)**：修改 `App.vue` 或新增 `YouTubeBatchDialog.vue` 組件，處理選頻彈窗與清單選擇。
- **下載服務 (DownloadService.ts)**：搭配現有 `parsePlaylist` 與 `YoutubeDlPlugin`，提供影片畫質選單解析與批次佇列派送支援。
