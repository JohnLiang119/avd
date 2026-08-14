# 系統設計：YouTube 頻道自動追蹤與優先下載 (Design: Channel Auto-Monitor)

## 資料結構設計 (Data Structures)

### 1. `MonitoredChannel`
```typescript
interface MonitoredChannel {
  channelId: string;         // YouTube Channel ID
  title: string;             // 頻道標題
  thumbnail: string;         // 頻道頭貼 URL
  enabled: boolean;          // 是否啟用追蹤
  lastCheckTime: number;     // 上次檢查時間戳 (毫秒)
  lastKnownVideoId?: string; // 上次確認的最新影片 ID
  lastVideoTitle?: string;   // 上次最新影片標題
}
```

### 2. `ChannelMonitorConfig`
```typescript
interface ChannelMonitorConfig {
  autoCheckEnabled: boolean;    // 全域自動檢查開關 (預設 true)
  checkIntervalMinutes: number;// 檢查週期 (預設 60 分鐘)
  lastGlobalCheckTime: number; // 上次全域檢查時間戳
}
```

## 元件與模組職責 (Components & Modules)

### 1. `DownloadService.ts`
- **`fetchYouTubeRss(channelId: string)`**：
  - 呼叫 `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`。
  - 使用 `DOMParser` 解析 XML，提取 `<entry>` 中的 `yt:videoId`、`title`、`published` 與 `link`。
- **`resolveYouTubeChannel(input: string)`**：
  - 解析使用者輸入之 Handle（`@channel`）、頻道網址或 Channel ID。

### 2. `App.vue`
- **狀態管理**：
  - `monitoredChannels = ref<MonitoredChannel[]>(...)`（持久化於 `avd_monitored_channels`）。
  - `monitorConfig = ref<ChannelMonitorConfig>(...)`（持久化於 `avd_monitor_config`）。
  - `showChannelModal = ref(false)`：頻道管理面板開關。
- **排程調度**：
  - `onMounted` 檢查 `Date.now() - monitorConfig.lastGlobalCheckTime >= interval`。
  - 設置定時輪詢計時器。
  - `checkAllMonitoredChannels()`：循序檢查各頻道 RSS，比對新片並 `tasks.unshift(newTask)`。

## 例外處理與邊界條件
1. **網路逾時或頻道 RSS 抓取失敗**：單一頻道失敗不中斷其他頻道，記錄錯誤日誌並保留原 `lastCheckTime`。
2. **重播/重複影片**：比對已存在於 `tasks` 陣列或本機檔案的 `videoId`，避免重複排入。
3. **無新片時**：安靜更新 `lastCheckTime`，不干擾使用者。
