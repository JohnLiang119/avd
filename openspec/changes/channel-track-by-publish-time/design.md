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

### 4. 備援模式（Fallback）的時間戳記相容性（已修訂）
- **問題根因（v1.0.61 探索發現）**：yt-dlp 在 `--flat-playlist` 模式下**不回傳** `timestamp` 或 `upload_date`（均為 `null`），`epoch` 欄位為 yt-dlp 執行當下的系統時間而非影片發布時間。前端 fallback 至 `Date.now()` 會污染 `lastPublishedTime` 基準，導致：(1) 備援期間每次檢查都將所有影片判定為「新片」；(2) RSS 恢復後因基準被推進至未來時間點而永久漏片。
- **修正方案：去掉 `--flat-playlist`，改用完整抓取**：
  - 去掉 `--flat-playlist` 後，yt-dlp 會逐一解析影片頁面，回傳精確的 `timestamp`（Unix 秒數）與 `upload_date`（`YYYYMMDD`）。
  - 搭配 `--skip-download --playlist-end 2` 限制只解析前 2 部影片，實測耗時約 5~10 秒，作為備援可接受。
  - 備援取得精確時間後，可與 RSS 模式走完全相同的 `publishedTime > lastPublishedTime` 比對邏輯。
- **跨分頁問題**：yt-dlp 抓取 `/channel/{id}` 時會遍歷 Videos、Live、Shorts 三個分頁，`--playlist-end N` 為每個分頁各取 N 部。前端需過濾掉 Live 分頁（透過 `playlist` 欄位包含 `"Live"` 或 `was_live === true`），保留 Videos + Shorts 以對齊 RSS 的涵蓋範圍。
- **雙平台修正**：Windows（Rust `lib.rs`）與 Android（Java `YoutubeDlPlugin.java`）均需同步修正。

### 5. 頻道卡片 UI 發布時間展示
- 於追蹤頻道卡片（如頻道名稱右側或第二行最新影片資訊前）直觀展示格式化之最新發布時間（例如「YYYY/MM/DD HH:mm:ss，如 2026/11/01 16:13:15」），提供清晰完整的時間資訊並兼顧排版適配。

### 6. 主畫面任務標題發布時間標記與結構化欄位防護 (方案 A)
- **結構化欄位擴充 (`DownloadTask`)**：
  在任務模型中新增結構化屬性，避免在狀態轉移中完全依賴脆弱的字串正則解析：
  - `publishTimeStr?: string`：格式化後的發布時間字串（如 `2026/11/01 16:13:15`）。
  - `channelPrefix?: string`：頻道名稱前綴（如 `頻道名`）。
  - `rawTitle?: string`：影片原始純標題（不含頻道前綴與時間）。
- **統一標題合成輔助函式 (`buildTaskDisplayTitle`)**：
  提供統一的 Helper 函式，以純標題、頻道前綴、發布時間合成 UI 顯示標題：
  `[頻道名] 影片標題 (2026/11/01 16:13:15)`
- **下載生命週期防覆蓋保護機制**：
  - **加入佇列 (Pending)**：任務建立時同時寫入結構化欄位並合成初始 `task.title`。
  - **下載進行中 (Downloading - `downloadProgress`)**：當收到原生端或 yt-dlp 進度事件帶有的 `info.title` 時，僅更新 `rawTitle` 並重新透過 Helper 合成，嚴禁以純標題覆蓋抹除現有頻道前綴與發布時間。
  - **下載完成 (Success - `processQueue`)**：接收 `result.title` 時，優先提取結構化 `publishTimeStr` 與 `channelPrefix` 進行合成，徹底解決 Android / Windows 端下載完成後時間標記消失的問題。

### 7. Android 原生端單一影片發布時間提取機制
- **背景問題**：在 Android 行動端，手動輸入單一網址（YouTube / TikTok）時，原生外掛 `YoutubeDlPlugin.java` 原先僅提取影片標題（`info.getTitle()`），未提取影片發布時間與頻道作者資訊，導致手動下載在 Android 上無法獲得發布時間。
- **原生提取改進**：
  - **YouTube 影片**：在 `download()` 流程中，透過 `info`（或執行 `--dump-single-json` / `VideoInfo`）提取 `upload_date`（如 `YYYYMMDD`）或 `timestamp` / `release_timestamp`，以及作者頻道名稱 `uploader`，格式化為標準發布時間字串（`YYYY/MM/DD HH:mm:ss`）。
  - **TikTok 影片**：在專屬解析通道中，從 `tikData` 提取 `create_time`（Unix 秒數時間戳）轉換為 `YYYY/MM/DD HH:mm:ss`，並提取作者暱稱。
  - **事件與結果封裝**：將解析出的 `publishTimeStr` 與 `channelPrefix` 同步放進 `downloadProgress` 通知與下載完成的 `JSObject ret` 回傳中。
- **前端對接**：前端 `DownloadService.download` 與 `downloadProgress` 監聽器收到後，自動填入 `task.publishTimeStr` 與 `task.channelPrefix`，實現跨平台手動單一影片發布時間完整支援。


### 8. 備援機制完整修正設計（雙平台）

#### 8.1 Windows 端（Rust `lib.rs`）
- **現狀**：`fetch_channel_videos_fallback` 使用 `["--dump-json", "--flat-playlist", "--playlist-end", "2", &url]`，URL 為 `/channel/{id}`。
- **修正**：移除 `"--flat-playlist"`，新增 `"--skip-download"`，參數改為 `["--dump-json", "--skip-download", "--playlist-end", "2", &url]`。
- URL 保持 `/channel/{id}`（不加 `/videos`），以同時涵蓋 Videos + Shorts；前端負責過濾 Live。

#### 8.2 Android 端（Java `YoutubeDlPlugin.java`）
- **現狀**：備援透過 `parsePlaylist()` 方法呼叫，內部使用 `--flat-playlist -J`，是通用播放清單解析，不可直接修改其參數。
- **修正**：新增專用備援方法 `fetchChannelVideosFallback(PluginCall call)`，使用 `--dump-json --skip-download --playlist-end 2`（不加 `--flat-playlist`），回傳 NDJSON 格式（每行一個 JSON 物件），與 Rust 端行為對齊。
- 前端 `DownloadService.ts` 的 Android 備援分支改為呼叫新方法。

#### 8.3 前端解析層（`DownloadService.ts`）
- **Windows 分支（已有基礎）**：`entry.timestamp` 與 `entry.upload_date` 解析邏輯已存在（L935-942），去掉 `--flat-playlist` 後即可正常取得值。
- **Android 分支**：改為呼叫新的 `fetchChannelVideosFallback` 方法，解析回傳的 NDJSON，提取 `timestamp`、`upload_date`、`title`、`id` 等欄位。
- **Live 過濾**：兩端統一在前端過濾，條件為 `entry.was_live === true` 或 `entry.playlist` 包含 `"Live"`。
- **時間解析優先順序**：`timestamp`（秒 × 1000）→ `upload_date`（YYYYMMDD → Date）→ 不再 fallback 到 `Date.now()`，若兩者皆無則該筆影片不參與時間基準更新。

#### 8.4 探索驗證數據
| 模式 | timestamp | upload_date | 速度（2部）| 涵蓋分頁 |
|------|-----------|-------------|-----------|----------|
| `--flat-playlist` | ❌ null | ❌ 不存在 | ~2s | Videos+Live+Shorts |
| 完整抓取 (`--skip-download`) | ✅ 精確到秒 | ✅ YYYYMMDD | ~5-10s | Videos+Live+Shorts |
| RSS | ✅ ISO 8601 | N/A | ~1s | Videos+Shorts（不含 Live） |

## Risks / Trade-offs

- **[Risk] 使用者本地現存頻道無 `lastPublishedTime`**
  → **Mitigation**: 初始化與比對時採用 `channel.lastPublishedTime ?? channel.lastCheckTime ?? 0`，第一次檢查成功後自動賦予精確的 `lastPublishedTime`。
- **[Risk] 創作者手動修改已發布影片資訊導致 RSS 重新推送**
  → **Mitigation**: 由於 YouTube RSS 條目中的 `<published>` 是固定不變的原發布時間（`<updated>` 才會改變），比對 `<published>` 時間可保證不受影片資訊修改影響。
- **[Risk] 舊版已儲存任務 (`tasks.value` 快取) 缺少結構化欄位**
  → **Mitigation**: Helper 函式支援向下相容，若無獨立欄位則自動從既有 `task.title` 正則解析並回填至結構化欄位。
- **[Risk] 備援完整抓取速度較慢（5-10 秒 vs 2 秒）**
  → **Mitigation**: 備援本身是 RSS 異常時的降級路徑，使用頻率低；且 `--playlist-end 2` 嚴格限制解析數量，速度可接受。
- **[Risk] yt-dlp 抓取頻道頁面跨分頁，`--playlist-end N` 為每個分頁各取 N 部**
  → **Mitigation**: 前端統一過濾 Live 分頁，保留 Videos + Shorts 對齊 RSS 涵蓋範圍。

