## Why

`App.vue` 已達 3296 行，承載 8 個獨立領域，其中任務樹（`tasks`）是被所有領域直接讀寫的神物件（40 處引用，`processQueue()` 從 9 個位置被呼叫）。這個結構已產生兩個具體問題：

1. **Windows 端的中斷任務清理完全失效**：啟動時從 `localStorage` 還原並把 `downloading` 標成 `error` 的邏輯，會被 `onMounted` 中 `initStore()` 讀取 Tauri Store 的結果整包覆蓋，導致任務永遠卡在「下載中」且無法重試。根因是 `localStorage` 與 Tauri Store 雙軌並存、逐 key 手工同步，兩個來源誰贏取決於執行時序。
2. **下載期間的持久化寫入成本失控**：實測 `avd_tasks` 佔 Store 的 76%（23 KB / 38 個任務），而 `watch(tasks, { deep: true })` 會在每一次 yt-dlp 進度回呼時觸發全樹序列化 + 同步 `localStorage.setItem` + Tauri Store 落地。進度事件約每秒 10 次，且成本隨**歷史任務總數**而非活躍任務數成長。

同時，專案**沒有任何前端測試設施**。後續要拆分其餘 7 個領域、收斂 45 處平台分支，若無安全網，每一步都是賭博。任務樹抽出後是純邏輯，是整個專案最適合作為測試起點的一塊。

## What Changes

### 建立單一儲存埠（`useStorage`）

- 以單一介面取代 `saveConfig` / `initStore` 的雙寫雙讀，底下掛兩個 adapter（`localStorage` / Tauri Store）。
- 消除啟動時的來源競態：只有一個真相來源，不再有「誰先寫誰後覆蓋」的問題。
- 移除目前硬編碼於兩處的布林 key 白名單。

### 建立任務樹儲存體（`useTaskStore`）

- 成為 `tasks` 的唯一擁有者，其餘領域改為透過它存取。
- **修正中斷任務清理**：還原與清理在同一個來源上完成，清理結果會被正確寫回。
- **持久化投影**：`progress`、`eta`、`speed`、`line`、`expanded` 為瞬時／檢視狀態，重啟後無意義，不納入持久化。下載期間任務樹的持久化投影不變，因此**下載過程零寫入**。
- **歷史保留上限**：終態葉任務上限 200 筆，依 `id` 由舊至新裁切，裁切後修剪空的 playlist 與 channel 群組。
- 同一份投影機制一併用於 TV 投放的推送內容，避免把單機的展開狀態同步到其他裝置。

### 建立測試基礎建設

- 導入 `vitest`，新增 `npm test` script。
- 為 `useTaskStore` 撰寫單元測試，涵蓋還原清理、投影欄位剔除、保留上限與空群組修剪、狀態轉換。

## Capabilities

### New Capabilities

- `config-persistence`: 跨平台的設定持久化 —— 單一真相來源、啟動還原無競態、平台差異收斂於單一儲存埠。
- `task-persistence`: 下載任務樹的持久化與還原語意 —— 中斷任務清理、瞬時欄位不落地、歷史保留上限與群組修剪。

### Modified Capabilities

（無。本變更不改變任何既有能力的對外行為。）

## Impact

- **重構範圍**：`src/App.vue` 約 394 行移出（3296 → 約 2900），新增 `src/composables/useStorage.ts` 與 `src/composables/useTaskStore.ts`。
- **行為修正**：Windows 端中斷任務可正確標記為失敗並重試；下載期間不再有持久化寫入。
- **新增相依**：`vitest`（devDependency）。
- **不在本次範圍**：其餘 7 個領域的抽離（App.vue 仍有約 2900 行）、`DownloadService.ts` 中 26 處平台分支的收斂。本變更僅建立這兩者所需的模式與安全網。
- **不影響**：下載引擎、頻道追蹤演算法、Android 原生層、建置與發布流程。
