## Context

動機見 proposal.md - Why。以下為決定切分邊界所需的現況。

`checkAllMonitoredChannels`（`App.vue:1440-1577`）的內部組成：

```
 迴圈編排 + 錯誤計數 + Toast          ← 留在 App.vue
   │
   ├─ DownloadService.fetchYouTubeRss()      網路，留下
   ├─ 首次追蹤判定（channelLastPub === 0）     純，抽出
   ├─ 新片篩選（時間比對 + 佇列去重）           純，抽出
   ├─ DownloadService.checkVideoLiveStatus()  網路，留下
   ├─ 任務建構（標題組裝、來源標記、子資料夾）   純，抽出
   ├─ tasks.value.unshift()                   taskStore，留下
   └─ 錨點推進                                純，抽出
```

去重邏輯需走訪三層結構（`App.vue:1478-1486`）：頂層扁平任務比對 `t.url`，頻道群組則需下探 `playlists[].subTasks[].url`。比對方式為 `url.includes(videoId)`。

錨點推進出現在兩處且寫法相同（`App.vue:1469` 首次追蹤分支、`App.vue:1534` 一般分支）：

```js
channel.lastPublishedTime = latestVideo.publishedTime || now;
```

`|| now` 即 `channel-track-by-publish-time` 任務 6.7 要修正的污染點。

**Live 過濾的兩種形態**（容易混淆，切分時須分開對待）：

| 形態 | 位置 | 性質 |
| :--- | :--- | :--- |
| 逐片查詢直播狀態 | `App.vue:1491` `checkVideoLiveStatus(url)` | 非同步網路呼叫，**不可抽出** |
| 備援結果的欄位過濾 | `DownloadService.ts`（`channel-track` 任務 6.4 新增） | 純邏輯，但屬 `DownloadService` 職責，本次不動 |

既有資產：`extract-task-store` 已建立 vitest（`environment: 'node'`、`include: src/**/__tests__/**/*.spec.ts`）與 composable 抽離模式；`useTaskStore` 已提供 `nextTaskId()` 與任務樹型別。

## Goals / Non-Goals

**Goals:**

- 讓頻道新片比對的規則成為可獨立測試的純函式。
- 以測試鎖定 `channel-track-by-publish-time` 修正後的錨點推進條件，避免日後回歸。
- 讓 `App.vue` 的 `checkAllMonitoredChannels` 只剩編排與 I/O。

**Non-Goals:**

- 不改變任何執行期行為。錨點推進條件的修正屬前置變更，本次僅將其固定於可測程式碼。
- 不抽離佇列引擎狀態機（另案）。
- 不動 `DownloadService.ts` 的任何邏輯，包含備援的 Live 欄位過濾。
- 不抽離頻道訂閱管理、匯入匯出、模擬測試等 `App.vue` 中其餘的頻道相關功能。
- 不追求 `App.vue` 行數指標；本次結束後仍約 2900 行。

## Decisions

### 決策 1：以無狀態純函式匯出，不建立 composable 實例

`useTaskStore` 需要持有 `tasks` 這個 `Ref`，故採 `createTaskStore(storage)` 的工廠形式。本次抽出的全部是無狀態運算 —— 輸入影片清單、錨點、任務樹，輸出篩選結果或新錨點 —— 沒有需要持有的狀態。

因此檔案匯出一組獨立函式，不提供 `createXxx()` 工廠。呼叫端直接 `import { selectNewVideos } from './composables/useChannelMatching'`。

**替代方案**：仍包成 `useChannelMatching()` 以求命名一致。否決原因是會憑空製造一層無用的間接，且讓測試需要先建立實例。檔名維持 `useChannelMatching.ts` 以符合目錄慣例，但內容是純函式模組。

### 決策 2：去重比對沿用 `url.includes(videoId)`，不改為精確比對

現行寫法是子字串比對，理論上 `videoId` 若為另一支影片 ID 的子字串會誤判。YouTube 的 videoId 固定 11 字元且字元集固定，實際碰撞機率極低。

本次為等價重構，**不改變比對方式**。若要改為自 URL 解析出 videoId 再精確比對，屬行為變更，應另案評估（會影響既有佇列中以其他形式儲存 URL 的任務）。此點記入測試註解，避免日後誤以為是疏漏。

### 決策 3：錨點推進以「回傳新值」而非「就地修改」

`nextChannelBaseline(current, latestVideo)` 回傳應採用的錨點值，由呼叫端決定是否寫回 `channel` 物件。

理由：就地修改的函式難以測試（需建構完整的 channel 物件並檢查副作用），而回傳值形式可直接斷言。同時讓「無精確時間則不推進」這條規則以 `return current` 表達，語意明確。

### 決策 4：任務建構函式接收 `nextId` 而非依賴 `taskStore`

`buildChannelVideoTask(video, channel, nextId)` 的 id 由呼叫端傳入（呼叫端執行 `taskStore.nextTaskId()`），而非在函式內取用 store。

理由：保持純函式性質，使測試不需要建立 storage 與 taskStore。同時避免 `useChannelMatching` 對 `useTaskStore` 產生依賴 —— 兩者應是同層的獨立模組。

### 決策 5：測試不涵蓋 `checkAllMonitoredChannels` 本身

該函式在抽離後仍含網路呼叫與 Toast，需要 mock `DownloadService` 與 vant 才能測試，成本與本次收益不成比例。

本次只測抽出的純函式。整體流程的正確性由手動驗證確認（見 tasks.md 第 4 節）。

## Risks / Trade-offs

**[抽離時改動的區域與 `channel-track-by-publish-time` 完全重疊]** → 已於 proposal 列為前置條件：必須待該變更完成並歸檔後才開始。實作前先確認 `openspec list` 中已無該變更。

**[等價重構仍可能引入行為差異]** → 抽出的每個函式在移動前後逐一比對邏輯；特別注意 `newVideos.reverse()` 的順序語意（影響任務插入佇列的先後）與 `formatPublishTime(vid.publishedTime) || formatPublishTime(Date.now())` 的 fallback，這兩處容易在重寫時失真。

**[純函式邊界劃錯，把網路呼叫一併搬入]** → `checkVideoLiveStatus` 是逐片的非同步網路查詢，必須留在 App.vue 的迴圈中。切分時以「函式簽章是否含 `async`」作為第一道檢查。

**[測試鎖定了錯誤的行為]** → 錨點推進條件的正確行為由前置變更定義。撰寫測試前先讀取 `channel-track-by-publish-time` 歸檔後的 `channel-auto-monitor` 主規格，以規格為準而非以當下程式碼為準。

**[本次結束後 `App.vue` 仍約 2900 行，可能被誤認為進展有限]** → 本變更的產出是測試覆蓋而非行數。tasks.md 收尾項要求同時記錄行數與新增的測試數，讓兩者並列。

## Open Questions

- **`buildChannelVideoTask` 是否該與 `useTaskStore` 的 `buildTaskDisplayTitle` 合併？** 後者目前仍在 `App.vue`（37 行純函式，3 個領域共用），本質上屬於任務樹的顯示邏輯。若在本次一併移入 `useTaskStore`，`buildChannelVideoTask` 可直接引用；但那會擴大本次範圍。可於實作時視情況決定，兩種作法都不影響規格。
