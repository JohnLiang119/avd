## 1. 前置查證與測試基礎建設

- [x] 1.1 執行 Windows sidecar 孤兒化觀察，將結果記錄至 design.md 的 Open Questions
  - 改以原始碼查證取得決定性答案（比單次觀察更完整）：`tauri-plugin-shell` 2.3.5 在 `src/lib.rs:132-142` 註冊 `on_event(RunEvent::Exit)`，結束時逐一 `child.kill()`；未使用 Job Object 亦未設 `kill_on_drop`。
  - 結論：**正常關閉會 kill 子行程**（清理語意正確）；**強制終止不觸發該事件，子行程孤兒化續跑**（可能把已完成的檔案標為失敗）。Android 側因下載在行程內執行，無此問題。
  - 決策 3 維持不變。衍生的「還原時比對檔案是否已存在」需求已記錄於 design.md，不在本次範圍。
- [x] 1.2 建立還原相容性的驗證素材
  - **偏離原規劃**：原訂複製使用者真實的 `config.json`，實作時改為合成素材，理由有三：
    1. **隱私** —— 真實檔案含 `avd_drive_token`（Google Drive 憑證），不應納入版控。
    2. **覆蓋度** —— 真實的 38 筆任務全為扁平且皆處於終態，完全不含巢狀頻道群組與 `downloading` 狀態，測不到最關鍵的還原清理路徑。
    3. **決定性** —— 合成素材不會隨使用者的日常使用而漂移。
  - 產出 `src/composables/__tests__/fixtures/legacy-tasks.sample.json`：5 個頂層項目 / 7 個葉任務（success 2、downloading 2、pending 2、error 1），涵蓋扁平任務、巢狀頻道群組 → 播放清單 → 子任務三層結構、`expanded` 旗標，以及全部瞬時欄位（`progress`/`eta`/`speed`/`line`）。欄位形狀取自實際觀察到的既有儲存結構。
  - 真實資料的相容性驗證改以手動步驟保留於任務 6.x。
- [x] 1.3 安裝 `vitest` 並於 `package.json` 新增 `"test": "vitest run"` 與 `"test:watch": "vitest"` script
  - 已安裝 `vitest@^4.1.11` 為 devDependency，兩個 script 皆已加入。
- [x] 1.4 建立 `vitest.config.ts`，確認 `npm test` 可執行
  - 設定 `environment: 'node'`（本階段只測純邏輯，不需 jsdom 或 Tauri mock）、`include: ['src/**/__tests__/**/*.spec.ts']`。
  - `npm test` 可正確執行並套用設定。無測試檔時 vitest 以 exit 1 結束，這是其預設的防呆行為（避免 include 樣式失效時 CI 靜默通過），**刻意不設 `passWithNoTests`**；待第 5 節的測試落地後即轉為綠燈。
  - 編碼慣例：專案既有 `.ts` / `.vue` 原始碼皆無 BOM（含 `vite.config.ts`），`vitest.config.ts` 依此慣例處理；`.md` 與 `.ps1` 仍維持 UTF-8 with BOM。

## 2. 儲存埠 useStorage

- [x] 2.1 定義 `StorageAdapter` 介面，使其可被注入以利未來測試
  - `src/composables/useStorage.ts`：介面為 `name` / `init()` / `get(key)` / `set(key, value)`（原規劃的 `ready` 改為 `init`，語意更貼近「準備就緒」而非查詢狀態；就緒狀態改由 `Storage.isReady` 這個 ref 對外表示）。
  - 另定義 `LegacyFallback` 唯讀介面，供一次性遷移使用。
- [x] 2.2 實作 `LocalStorageAdapter`
  - 位於 `src/composables/storageAdapters.ts`。Android / Web 的權威來源。
- [x] 2.3 實作 `TauriStoreAdapter`（包裝 `LazyStore`）
  - `init()` 主動觸發一次 `get` 以便及早暴露載入失敗，而非等到第一次真正讀取。
- [x] 2.4 建立 `src/composables/useStorage.ts`：提供以「鍵名 + 預設值」宣告設定項的註冊方式，型別由預設值推導
  - `createStorage(adapter, legacy?)` 回傳 `defineSetting` / `hydrate` / `isReady`。`defineSetting(key, default, options?)` 回傳綁定的 `Ref`，還原完成後對它的變更自動持久化。
  - `coerce()` 依預設值的型別轉換原始值，同時容忍 localStorage 的字串格式與 Tauri Store 的原生格式，**取代了原本硬編碼於兩處的布林鍵名白名單**。
  - `LegacyFallback` 作為一次性唯讀遷移來源：權威來源無值時回頭讀 localStorage 一次，永不寫回。
- [x] 2.5 確保還原完成前發生的寫入不會被還原流程覆蓋
  - 以 `dirtyBeforeHydrate` 標記：`isReady` 為 false 時的變更只記錄不落地，`hydrate` 略過這些鍵，還原結束後才寫入。
  - 已由 `useStorage.spec.ts` 的「還原期間的寫入不得被還原流程覆蓋」測試涵蓋（以可控 gate 模擬非同步還原）。
- [x] 2.6 儲存來源為空或 JSON 解析失敗時，以預設值啟動並記錄錯誤，不中斷初始化
  - `adapter.init()`、`adapter.get()`、`deserialize` 三處各自 try/catch，任一失敗皆退回預設值並記錄，`hydrate()` 始終正常結束且 `isReady` 轉為 true。
  - 已由兩個測試涵蓋：解析失敗、adapter 初始化失敗。

### 2.A 偏離 design 決策 5：補上 useStorage 的測試

- [x] 2.A.1 為 `useStorage` 撰寫單元測試
  - design 決策 5 原訂不測 `useStorage`，理由是「需要平台環境」。實作時將 `StorageAdapter` 設計為可注入，該前提已不成立。
  - 2.5 與 2.6 對應的是 `config-persistence` 的規格情境，其中「還原期間的寫入」屬競態，手動幾乎無法穩定重現 —— 以測試涵蓋是唯一可靠的驗證方式。
  - 產出 `src/composables/__tests__/useStorage.spec.ts`，9 個測試全數通過：`coerce` 的型別推導 3 項、持久化往返、還原期寫入競態、解析失敗降級、init 失敗降級、舊版來源遷移、投影未變不寫入。

## 3. 任務樹 useTaskStore

- [x] 3.1 將 `DownloadTask` / `PlaylistGroupTask` / `ChannelGroupTask` / `TaskItem` 型別定義移至 `src/composables/useTaskStore.ts`
  - 另新增 `TaskStatus` 具名型別，取代原本四處重複的字面聯集。
- [x] 3.2 建立 `useTaskStore`，以 `ref` 形式持有並回傳 `tasks`
  - `createTaskStore(storage)` 透過 `storage.defineSetting` 取得 `tasks` 這個 `Ref`，持久化與還原皆由 storage 層處理，store 本身不接觸平台 API。
- [x] 3.3 移入任務樹 CRUD
  - **偏離原規劃**：原訂整批搬移，實作時發現其中兩類含 UI 耦合，若整批搬入會把 vant 對話框與設定 ref 一起拖進純邏輯層：
    - `expandAll` / `collapseAll` 同時操作 `remoteTasks`（TV 模式的遠端清單），那不屬於本機任務樹。
    - `removePlaylistGroup` / `removeChannelGroup` 內嵌 `showDialog` 確認流程，並讀取 `confirmClearSingle` / `confirmClearAll`。
  - 改為：store 只提供純粹的 `setAllExpanded(bool)`、`removeTaskById`、`removePlaylistFromChannel`、`removeSubTask`、`pruneEmpty`；對話框包裝與 `remoteTasks` 的處理留在 `App.vue`，由它呼叫 store 的純函式。
  - 統計輔助函式（`isPlaylistCompleted`、`getPlaylistCompletedCount`、`getPlaylistProgress`、`getChannelCompletedCount`）為純函式，已完整移入。
- [x] 3.4 實作持久化投影函式：剔除 `progress`、`eta`、`speed`、`line`、`expanded`
  - `projectTasks()` 遞迴處理扁平任務與巢狀群組，同一份函式供持久化與 TV 推送共用。
- [x] 3.5 實作還原流程：單一來源讀取 → 中斷清理 → 保留上限裁切 → 空群組修剪
  - `restoreTasks()` 作為 `defineSetting` 的 `deserialize`，是唯一的還原路徑；不再有第二個來源可覆蓋其結果。
- [x] 3.6 實作巢狀群組的中斷清理：子任務與其所屬頻道群組皆標記為 `error`
  - **一併修正既有缺陷**：舊版對頻道群組執行 `t.status = 'error'` 是**無條件**的，導致全數成功的頻道群組在每次重啟後都顯示為失敗。改為條件式 —— 只在該群組底下確實有子任務被中斷時才標記，播放清單層同理。此為行為變更，已由專屬測試涵蓋。
- [x] 3.7 實作終態葉任務保留上限（200），依 `id` 由舊至新裁切，`pending` / `downloading` 不受裁切
  - `applyRetentionLimit(items, limit)` 回傳裁切後的樹與實際移除筆數；上限以參數注入以利測試。
- [x] 3.8 實作裁切後的空群組修剪
  - `pruneEmptyGroups()` 獨立為可測函式，並於裁切後自動套用。
- [x] 3.9 首次觸發裁切時以 Toast 告知已自動清理的筆數
  - store 只回報 `trimmedOnRestore` 筆數（不接觸 UI），由 `App.vue` 的 `onMounted` 在 `hydrate()` 後顯示 Toast。
- [x] 3.10 將 `watch(tasks, { deep: true })` 改為監看投影結果，使下載期間的進度變動不觸發寫入
  - 於 `useStorage` 的 `persist()` 中比對投影的序列化簽章，相同即略過寫入。殘留成本為每次進度事件仍會序列化一次投影以供比對（純 CPU，無磁碟與 IPC），已消除同步 `localStorage.setItem`、Tauri IPC 與檔案落地三項主要開銷。
- [x] 3.11 確認還原邏輯可正確讀取含瞬時欄位的舊格式資料
  - 以 1.2 的合成素材驗證：5 個頂層項目 / 7 個葉任務全數還原、結構完整、中斷者正確轉為 error（success 2、error 5）。另涵蓋 JSON 字串形式（localStorage 格式）與解析失敗的降級路徑。
  - 使用者真實資料的驗證保留於第 6 節手動步驟。

## 4. App.vue 接線

- [x] 4.1 移除 `saveConfig` 與 `initStore`，改由 `useStorage` 提供
  - `saveConfig` 的 15 個呼叫點全數移除（設定項變更now由 useStorage 自動持久化），`isStoreInitialized` 守衛與 `getStoredBool` 白名單一併消失，`initStore`（64 行）整段移除。
  - 14 個設定項改以 `storage.defineSetting(key, default)` 宣告：`avd_tv_mode`、`avd_target_tv_ip`、`avd_mp3_mode`、`avd_wifi_ssid`、`avd_wifi_pwd`、`avd_monitored_channels`、`avd_monitor_config`、`avd_confirm_delete_all`、`avd_confirm_delete_single`、`avd_confirm_clear_all`、`avd_confirm_clear_single`、`avd_test_mode_enabled`、`avd_drive_token`、`avd_tasks`。
  - `monitoredChannels` 與 `monitorConfig` 以自訂 `deserialize` 保留原有的向下相容邏輯（`lastCheckTime` → `lastPublishedTime`、預設值合併）。
  - 首次啟動的 TV 自動偵測原依賴 `localStorage.getItem(...) === null`，改用新增的 `storage.wasRestored(key)`。
  - 範圍外：`yt_dlp_last_update_check` 仍直接使用 localStorage。它不在原 14 個 Store 鍵之列，兩平台皆以 localStorage 為唯一來源，不構成雙來源問題。
- [x] 4.2 以解構方式自 `useTaskStore` 取得同名 `tasks`
  - `const { tasks } = taskStore;` —— 既有的 `tasks.value` 引用點全數無需改動，響應性由 `Ref` 保持。
- [x] 4.3 移除 `App.vue` 中已搬移的型別定義、CRUD 函式與載入還原區塊
  - 移除：4 個型別定義、4 個統計輔助函式（改為自 store 匯入）、38 行的任務載入與 `watch(tasks, deep)` 區塊、`taskIdCounter`（改用 `taskStore.nextTaskId()`，9 處）。
  - `expandAll` / `collapseAll` 改為呼叫 `taskStore.setAllExpanded()`，`remoteTasks` 的處理仍留在 App.vue；群組移除的對話框包裝保留，內部改呼叫 store 的純函式。
  - **App.vue 3296 → 3085 行**（減少 211 行）。
- [x] 4.4 TV 投放推送改用同一份投影函式
  - `pushListToTv` 改為 `JSON.parse(JSON.stringify(projectTasks(tasks.value)))`，與持久化共用同一份投影，`expanded` 與瞬時進度皆不再推送至其他裝置。
- [x] 4.5 確認 `vue-tsc` 型別檢查通過（`npm run build`）
  - `vue-tsc --noEmit` 無錯誤，`npm run build` 成功產出。
  - 過程中修正兩處自己造成的問題：(1) `tsconfig.app.json` 未排除測試檔，導致要求 node 型別 —— 已加 `exclude: ["src/**/__tests__/**"]`；(2) **任務 1.3 修改 `package.json` 時誤以 `utf-8-sig` 寫入而加上 BOM，使 Vite 的 JSON loader 解析失敗、建置中斷** —— 已移除 BOM。教訓：專案的 BOM 規範適用於 `.md` / `.ps1`，**不適用於 JSON**（BOM 會使 JSON 解析器失敗），亦不適用於 `.ts` / `.vue`。

## 5. 單元測試（useTaskStore）

- [x] 5.1 測試中斷清理：`downloading` 與 `pending` 皆轉為 `error` 並帶中斷原因
- [x] 5.2 測試巢狀清理：頻道群組下的子任務中斷時，子任務與群組皆為 `error`
  - 另新增一項：全數成功的群組**不應**被標記為 error（涵蓋 3.6 修正的缺陷）。
- [x] 5.3 測試清理結果持久：連續兩次還原後狀態仍為 `error`，不回到 `downloading`
  - 以「還原 → 投影 → 序列化往返 → 再還原」模擬兩次啟動。
- [x] 5.4 測試投影剔除：投影結果不含 `progress`、`eta`、`speed`、`line`、`expanded`
  - 扁平任務與巢狀群組各一項，並驗證識別與領域欄位被保留。
- [x] 5.5 測試下載期間零寫入：僅變動進度數值時投影不變；狀態轉換時投影改變
  - 另於 `useStorage.spec.ts` 以 adapter 寫入次數直接驗證「投影未變則不觸發寫入」。
- [x] 5.6 測試保留上限：超出時由舊至新裁切至上限
  - 以注入的小上限測試，另涵蓋未超限不裁切、巢狀群組內子任務同樣受裁切。
- [x] 5.7 測試活躍任務不受裁切：`pending` 與 `downloading` 在超限情境下全數保留
- [x] 5.8 測試空群組修剪：裁切後無子任務的 playlist 與 channel 被移除
  - 三項：直接修剪空群組、裁切後產生的空群組、仍有子任務的群組被保留。
- [x] 5.9 測試舊格式相容：以 1.2 的素材還原，任務數量與狀態正確
  - 四項：結構與數量、中斷清理結果、JSON 字串形式、解析失敗降級。

## 6. 驗證與收尾

- [ ] 6.1 手動驗證五條 UI 路徑的響應性：新增任務、進度更新、群組展開、刪除任務、清除紀錄
- [ ] 6.2 Windows 端驗證中斷清理：下載中強制關閉 app → 重啟後任務為 `error` 且可重試 → 再次關閉重啟後仍為 `error`
- [ ] 6.3 Android 端驗證同一情境行為一致
- [x] 6.4 量測改善幅度
  - **下載期間寫入次數 = 0**：由 `useStorage.spec.ts` 的「投影未變則不觸發寫入」以 adapter 寫入計數直接驗證，並由 `useTaskStore.spec.ts` 驗證僅變動 `progress`/`speed`/`eta`/`line` 時投影完全不變。
  - **體積縮減**：以測試素材量測，投影使 `avd_tasks` 由 2425 → 1889 chars（-22.1%）。使用者真實資料的實測併入 6.2 的手動驗證。
  - 殘留成本：每次進度事件仍會序列化一次投影以供比對（純 CPU），已消除同步 `localStorage.setItem`、Tauri IPC 與檔案落地三項主要開銷。
- [x] 6.5 確認 `npm test` 全數通過、`npm run build` 成功
  - `npm test`：2 個測試檔、**28 個測試全數通過**。`npm run build`：`vue-tsc` 無錯誤、Vite 建置成功。
- [x] 6.6 記錄收尾數據，明確標示本次未涵蓋的範圍

  **本次達成**

  | 指標 | 變更前 | 變更後 |
  | :--- | ---: | ---: |
  | `App.vue` 行數 | 3296 | **3085**（-211） |
  | 新增 composables | 0 | 594 行（`useStorage` 205 / `storageAdapters` 58 / `useTaskStore` 331） |
  | 前端測試 | **0** | 373 行 / **28 個測試** |
  | `isTauri()` 分支總數 | 45 | **41**（App.vue 15→13、DownloadService 26→25、UpdateService 4→3） |
  | 設定的真相來源 | 2（localStorage + Tauri Store） | **1** |
  | 下載期間持久化寫入 | 約 10 次/秒 × 23 KB | **0** |

  **已修正的缺陷**

  1. Windows 端中斷任務清理被 Store 還原覆蓋 → 單一來源後不再發生。
  2. 頻道群組於還原時被**無條件**標記為 error，使全數成功的群組顯示為失敗 → 改為條件式。

  **本次未涵蓋（明確不是「優化完成」）**

  - `App.vue` 仍有 **3085 行**，其餘 7 個領域尚未抽離：自動更新、TV 投放、頻道追蹤、下載佇列引擎、設定面板、WiFi/QR、Google Drive 上傳。
  - **41 處 `isTauri()` 平台分支仍在**，其中 25 處集中於 `DownloadService.ts` 的下載／檔案／分享操作，需另行設計 Platform port（本次只建立了設定持久化的 port/adapter 樣板）。
  - 測試僅覆蓋 `useStorage` 與 `useTaskStore` 的純邏輯；元件層與下載引擎無測試。
  - 衍生需求（記錄於 design.md）：Windows 強制終止時 sidecar 會孤兒化續跑，還原時應比對檔案是否已存在。
