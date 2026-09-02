## Why

`App.vue` 的 `checkAllMonitoredChannels`（1440-1577，共 138 行）把三件事揉在一起：網路取用（RSS / 備援 / 直播狀態查詢）、UI 回饋（Toast），以及**頻道新片比對的核心規則**。後者是整個自動追蹤功能的判斷依據，卻沒有任何測試保護，規格上也只有一條高層次情境帶過。

這些規則實際上相當精細，且錯一步就會造成使用者可感知的故障：

- 首次追蹤（基準為 0）時只初始化時間錨點、不得下載歷史影片 —— 否則使用者一加入頻道就被灌入整頁舊片。
- 新片判定為「發布時間晚於錨點」**且**「尚未存在於下載佇列」—— 去重需同時比對扁平任務與頻道群組底下的巢狀子任務。
- 時間錨點的推進條件 —— `channel-track-by-publish-time` 正在修的漏片 bug，根因就是這裡在無精確時間時用 `Date.now()` 推進錨點，導致基準被推到未來而永久漏片。

專案已於 `extract-task-store` 建立 vitest 與 composable 的抽離模式，`useTaskStore` 也已成為任務樹的唯一擁有者。此時把比對核心抽出並補上測試，成本最低。

## What Changes

### 抽出 `useChannelMatching`

將以下純邏輯自 `App.vue` 移入 `src/composables/useChannelMatching.ts`：

- `isFirstTimeTracking(channel)` —— 判定是否為首次追蹤（`lastPublishedTime` 與 `lastCheckTime` 皆無值）。
- `isVideoAlreadyQueued(tasks, videoId)` —— 於任務樹中比對影片是否已在佇列，需涵蓋扁平任務與頻道群組 → 播放清單 → 子任務三層。
- `selectNewVideos(videos, baseline, tasks)` —— 篩選出發布時間晚於錨點且未在佇列中的影片。
- `nextChannelBaseline(current, latestVideo)` —— 計算時間錨點的下一個值；無精確發布時間時維持原錨點不變。
- `buildChannelVideoTask(video, channel, nextId)` —— 由影片與頻道資訊建構下載任務（含標題組裝、來源標記、子資料夾名稱清洗）。

### 留在 `App.vue`

`DownloadService.fetchYouTubeRss` 與 `checkVideoLiveStatus` 的網路呼叫、Toast 回饋、逐頻道的迴圈編排與錯誤計數，維持在 `App.vue`，改為呼叫上述純函式。此邊界與 `extract-task-store` 對 `useTaskStore` 的處理方式一致。

### 補上測試

為 `useChannelMatching` 撰寫單元測試，涵蓋首次追蹤、去重（含巢狀）、新片篩選、錨點推進條件、任務建構。

### 前置條件

**本變更必須在 `channel-track-by-publish-time` 完成並歸檔後才開始。** 該變更的任務 6.7 會修正 `App.vue:1469` 與 `1534` 的 `|| now` 錨點污染；若先抽離，等於把一份即將被改寫的邏輯搬進新檔案，之後仍要在新位置再改一次，且兩者的改動區域（`App.vue` 1440-1691）完全重疊。

## Capabilities

### New Capabilities

（無。）

### Modified Capabilities

- `channel-auto-monitor`: 將 `Periodic Check & New Video Matching` 的比對規則自「只有一條高層次情境」擴充為明確可驗證的行為 —— 首次追蹤的錨點初始化、佇列去重（含巢狀結構）、以及時間錨點的推進條件。這些行為目前只存在於程式碼中，本變更以測試將其鎖定，規格需同步記載。

## Impact

- **新增**：`src/composables/useChannelMatching.ts` 與其測試。
- **修改**：`src/App.vue` 的 `checkAllMonitoredChannels` 改為呼叫純函式；預估減少約 120 行。
- **不改變執行期行為**：抽離本身為等價重構；錨點推進條件的修正由前置的 `channel-track-by-publish-time` 負責，本變更只是把修正後的規則固定在可測程式碼中。
- **不在本次範圍**：佇列引擎狀態機（`getNextPendingTask`、重試轉換）的抽離，另案處理；其餘 6 個領域（自動更新、TV 投放、設定、區網伺服器、Drive、清除）維持現狀。
- **不影響**：下載引擎、Android 原生層、持久化層、建置與發布流程。
