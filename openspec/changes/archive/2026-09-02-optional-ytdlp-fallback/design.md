## Context

目前 AVD 在 `DownloadService.fetchYouTubeRss` 中遇到官方 RSS 連線失敗時，會無條件調用 `yt-dlp` 子行程（Windows 端）或呼叫頻道首頁解析（Android 端）作為備援。為提升系統效能並消除潛在副作用，本設計將備援機制轉化為設定中的可選開關（預設為關閉），並在全流程中透明化資料來源標記。

詳細背景與動機請見 `proposal.md`。

## Goals / Non-Goals

**Goals:**
- 將 `yt-dlp` 備援機制轉為可選功能，預設值為 `false`。
- 在「頻道自動追蹤排程」彈窗中提供開關控制項與清楚的說明。
- 改造 `DownloadService.fetchYouTubeRss`，支援 `options.enableFallback` 參數並回傳 `source: 'rss' | 'fallback'`。
- 在任務隊列文字（`line`）與檢查結果通知（Toast）中明確標示「官方 RSS」或「yt-dlp 備援」。
- 當 RSS 失敗且未啟用備援時，提供明確的錯誤原因與設定指引。

**Non-Goals:**
- 不改變官方 RSS 的解析邏輯與時間戳記比對機制。
- 不影響使用者手動輸入一般 YouTube 影片網址時的正常解析與下載。

## Decisions

### 1. 資料模型演進 (`ChannelMonitorConfig`)
在 `ChannelMonitorConfig` 介面中新增可選欄位 `enableYtDlpFallback`：
```typescript
interface ChannelMonitorConfig {
  autoCheckEnabled: boolean;
  checkIntervalMinutes: number;
  lastGlobalCheckTime: number;
  enableYtDlpFallback?: boolean; // 預設為 false
}
```
初始化時提供向下相容：
```typescript
const monitorConfig = ref<ChannelMonitorConfig>(
  JSON.parse(localStorage.getItem('avd_monitor_config') || JSON.stringify({
    autoCheckEnabled: true,
    checkIntervalMinutes: 60,
    lastGlobalCheckTime: 0,
    enableYtDlpFallback: false
  }))
);
```

### 2. 下載服務介面擴充 (`DownloadService.fetchYouTubeRss`)
```typescript
export interface MonitoredVideoResult {
  videoId: string;
  title: string;
  published: string;
  publishedTime: number;
  url: string;
  source: 'rss' | 'fallback';
}

async fetchYouTubeRss(
  channelId: string, 
  options?: { enableFallback?: boolean }
): Promise<MonitoredVideoResult[]>
```
- 若官方 RSS 成功：所有 entry 之 `source = 'rss'`。
- 若官方 RSS 失敗：
  - 若 `options?.enableFallback === false`（預設）：直接拋出錯誤 `官方 RSS 連線失敗: ${e.message}`，不觸發 `yt-dlp`。
  - 若 `options?.enableFallback === true`：嘗試執行 `fetch_channel_videos_fallback`，成功時所有 entry 之 `source = 'fallback'`。

### 3. UI 與狀態提示透明度設計
1. **排程設定彈窗**：
   在「每小時自動檢查新片」下方新增一組開關：
   - 標題：`啟用 yt-dlp 備援機制`
   - 說明：`官方 RSS 異常時，是否自動切換至首頁解析備援（預設關閉）`
2. **任務排隊狀態 (`line`)**：
   - 官方 RSS 來源：`【自動追蹤 (RSS)】排隊優先下載中...`
   - 備援來源：`【自動追蹤 (yt-dlp 備援)】排隊優先下載中...`
3. **檢查完成 Toast 提示**：
   - 全部 RSS 成功：`🔔 發現 X 部新影片 [官方 RSS]，已優先加入下載佇列！`
   - 包含備援來源：`🔔 發現 X 部新影片 (⚠️ 包含 yt-dlp 備援)，已優先加入下載佇列！`
   - 官方 RSS 失敗且備援關閉：`⚠️ 頻道檢查失敗: 官方 RSS 連線異常 (可於設定開啟 yt-dlp 備援)`

## Risks / Trade-offs

- **[Risk] 部分受限網路環境無法連線官方 RSS**  
  → **Mitigation**: 在連線失敗時顯示明確 Toast 提示「官方 RSS 連線異常，可於設定中開啟 yt-dlp 備援」，引導使用者手動開啟。
