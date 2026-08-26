## Context

目前頻道自動追蹤在比對新影片時，依賴 `channel.lastCheckTime`（執行檢查時的系統毫秒戳記）。詳見 `proposal.md`。

## Goals / Non-Goals

**Goals:**
- 將頻道比對的核心時點改為「影片實際發布時間 (`lastPublishedTime`)」，防止 RSS 快取延遲導致影片漏抓。
- 採用「發布時間 + Video ID 去重」的雙重錨點演算法，支援同時間排程多部影片發布的情境。
- 提供舊資料相容層，自動將使用者既有 `localStorage` 中的 `lastCheckTime` 平滑過渡至 `lastPublishedTime`。
- 保留全域 `monitorConfig.lastGlobalCheckTime` 僅用於排程間隔判定（如每 60 分鐘觸發一次），不干涉頻道影片比對。

**Non-Goals:**
- 不變更排程輪詢頻率（維持 60 分鐘預設與手動立即檢查）。
- 不重寫 YouTube RSS 下載或解析通訊協定本身，僅重構比對邏輯與資料欄位。

## Decisions

### 1. 資料模型演進 (Data Model Evolution)
在 `MonitoredChannel` 介面中：
- 新增 `lastPublishedTime: number`：記錄該頻道已確認之最新影片發布時間（Unix 毫秒時間戳記）。
- 保留 `lastKnownVideoId?: string`：作為同時間發布或時間精度不足時的去重輔助錨點。
- 保留/向下相容 `lastCheckTime?: number`：若舊版備份或既有資料無 `lastPublishedTime`，初次自動回退使用 `lastCheckTime || 0`，並在首次檢查時升級。

### 2. 比對演算法 (Diff Algorithm)
```typescript
const channelLastPub = channel.lastPublishedTime || channel.lastCheckTime || 0;

const newVideos = videos.filter(v => {
  // 1. 發布時間嚴格大於上次記錄點
  const isTimeNewer = v.publishedTime > channelLastPub;

  // 2. 避免重複加入當前佇列
  const alreadyInTasks = tasks.value.some((t: any) => { ... });

  return isTimeNewer && !alreadyInTasks;
});
```

### 3. 起始基準錨定 (Initial Anchor Strategy)
- 當手動新增頻道或首次執行檢查時：
  - 直接提取 RSS 最新影片的 `publishedTime` 與 `videoId` 寫入 `channel.lastPublishedTime` 與 `channel.lastKnownVideoId`。
  - 不觸發下載，建立初始時點防線。

### 4. 備援模式（Fallback）的時間戳記相容性
- 當 RSS 失敗切換至 `yt-dlp` flat-playlist 時，若 yt-dlp 回傳包含 `timestamp` 或 `upload_date`，優先轉換為毫秒時間戳記；若無法取得則以 `Date.now()` 作為降級時間，並依賴 `lastKnownVideoId` 防重複。

### 5. 頻道卡片 UI 發布時間展示
- 於追蹤頻道卡片（如頻道名稱右側或第二行最新影片資訊前）直觀展示格式化之最新發布時間（例如「YYYY/MM/DD HH:mm:ss，如 2026/11/01 16:13:15」），提供清晰完整的時間資訊並兼顧排版適配。

### 6. 主畫面任務標題發布時間標記
- 所有建立之影片下載任務（包含由使用者手動單一輸入加入、自動追蹤、模擬測試或播放清單解析），其標題後方均自動格式化附帶發布時間標記：`[頻道名] 影片標題 (YYYY/MM/DD HH:mm:ss)` 或 `影片標題 (YYYY/MM/DD HH:mm:ss)`（例如 `影片標題 (2026/11/01 16:13:15)`），讓主畫面佇列清單中所有影片的發片時間一目了然。

## Risks / Trade-offs

- **[Risk] 使用者本地現存頻道無 `lastPublishedTime`**
  → **Mitigation**: 初始化與比對時採用 `channel.lastPublishedTime ?? channel.lastCheckTime ?? 0`，第一次檢查成功後自動賦予精確的 `lastPublishedTime`。
- **[Risk] 創作者手動修改已發布影片資訊導致 RSS 重新推送**
  → **Mitigation**: 由於 YouTube RSS 條目中的 `<published>` 是固定不變的原發布時間（`<updated>` 才會改變），比對 `<published>` 時間可保證不受影片資訊修改影響。
