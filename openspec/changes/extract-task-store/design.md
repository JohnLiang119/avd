## Context

動機見 proposal.md - Why。以下為決定實作方式所需的現況測量。

**持久化雙軌的實際形狀**（`App.vue`）：

```
saveConfig (L806)                    initStore (L1075, onMounted 內 await)
  localStorage.setItem   ← 永遠寫      loadStoreItem × 14
  store.set + save       ← 需 isStoreInitialized      ├─ 有值 → 覆蓋 ref，回寫 localStorage
                                                      └─ 無值 → 讀 localStorage，回填 store
```

啟動時序造成的缺陷：

```
setup() 同步階段
  L2235  讀 localStorage → 解析
  L2239  downloading/pending → error        只改記憶體
  L2269  watch(tasks, deep) 註冊             ← 晚於上述變更，不會觸發寫回
                                                且此時 isStoreInitialized = false
onMounted
  initStore → loadStoreItem('avd_tasks') → 用未清理的 Store 資料整包覆蓋
```

結果：Windows 端清理失效；Android 端因 `initStore` 提前 return 而清理生效，但 `localStorage` 從未被寫乾淨。

**實測資料**（使用者機器上的 `%APPDATA%\com.mattpocock.avd\config.json`）：

| 項目 | 數值 |
| :--- | :--- |
| Store 總計 | 30,552 chars |
| `avd_tasks` | 23,206 chars（76%），38 個任務 |
| 任務狀態分布 | success 30、error 8（全為終態） |
| 已存欄位 | 含 `progress: 100`、`eta: "00:00"`、`speed: "10.50MiB/s"`、`line: "…"` |

**耦合現況**：`tasks.value` 有 40 處引用，橫跨 L993（TV 投放）至 L3003（Drive 上傳）；`processQueue()` 從 9 處被呼叫，分屬至少 4 個領域。8 個領域並非對等同儕，而是任務樹的客戶端。

**測試現況**：`package.json` 無任何測試相依或 script，`src/` 下無任何測試檔。

## Goals / Non-Goals

**Goals:**

- 讓任務樹與設定各自只有一個真相來源，消除還原時的來源競態。
- 讓下載期間的持久化寫入降為零。
- 建立可執行的測試基礎建設，並以任務樹作為第一批被覆蓋的邏輯。
- 確立後續 7 個領域抽離時可重複套用的 composable 形狀。

**Non-Goals:**

- 不抽離其餘 7 個領域（更新、TV 投放、頻道追蹤、佇列引擎、設定、WiFi/QR、Drive）。本次結束後 `App.vue` 仍約 2900 行。
- 不收斂 `DownloadService.ts` 的 26 處平台分支。那 26 處全屬下載／檔案／分享操作，與設定持久化無關，需另行設計 Platform port。
- 不引入狀態管理函式庫（Pinia 等）。
- 不改動下載引擎、頻道追蹤演算法、Android 原生層。
- 不追求測試覆蓋率數字，只覆蓋本次規格中可驗證的行為。

## Decisions

### 決策 1：以「持久化投影」取代 debounce

最初考慮對 `watch(tasks)` 加 debounce。改採投影的理由：debounce 500 ms 在下載期間仍每 0.5 秒序列化 23 KB；而 `progress`／`eta`／`speed`／`line` 重啟後必被重設（任務不是標成 `error` 就是已完成），本就不該落地。剔除後，下載期間投影不變 → 寫入次數為零，只在狀態轉換時付一次成本。

```
              下載中寫入頻率        每次成本
  現況        ~10 次/秒            23 KB 全樹
  debounce    2 次/秒              23 KB 全樹
  投影        0 次                 —
```

`expanded` 一併剔除：它是單機檢視狀態，且目前會隨 TV 投放的整樹 clone 傳到其他裝置。同一份投影函式同時用於持久化與推送。

**代價**：重啟後展開／收合狀態不再記憶，回到預設。評估為可接受 —— 現有預設即為展開，且已有「全部展開／收合」操作。

**替代方案**：另存 `expandedIds` 集合於裝置本機。否決原因是需維護與任務樹同生命週期的第二結構（任務刪除時要清理孤兒 id），為記住一個布林值不划算。

### 決策 2：歷史採「上限裁切」，不採「活躍／歷史分表」

分表能讓活躍那份極小，但：

- 投影落實後，寫入成本已不再與歷史大小相關（下載期間零寫入），分表優化的是「已經很便宜」的部分。
- 任務樹是巢狀的（channel → playlist → subTasks），同一個群組可能同時含活躍與終態子任務，分表需決定群組骨架放哪一邊並在讀取時合併 —— 這正是本變更要消滅的「雙來源合併」。

因此採終態葉任務上限 200、依 `id` 由舊至新裁切、裁後修剪空群組。專案已有修剪先例（`App.vue:2678` 的 `playlists.filter(pl => pl.subTasks.length > 0)`）。

上界：200 × 約 600 bytes ≈ 120 KB。

分表留待真正需要歷史功能（搜尋、統計、重複下載偵測）時再評估。

### 決策 3：中斷清理維持無條件標記為失敗

查證 Android 側：`YoutubeDL.execute()` 在 app 行程內執行、`activeDownloaders` 為實例 HashMap、`KeepAliveService.runningTasks` 為 static、服務為 `START_NOT_STICKY`、無任何續傳機制。**行程結束即下載結束**，故無條件標記為失敗在語意上正確。

`AndroidManifest` 的 `configChanges` 已涵蓋 `orientation|screenSize|…`，Activity 不因旋轉重建，唯一誤殺窗口是「行程存活但 WebView 重載」，極窄。

**未解的風險見 Open Questions**：Windows 端 sidecar 子行程於 app 關閉後是否孤兒化續跑，尚未查證。

### 決策 4：儲存埠只做 key-value，不做結構化 schema

`useStorage` 提供 `get`/`set`/`ready` 三個操作，型別由呼叫端以泛型宣告。不引入 schema 驗證或 migration 框架。

理由：現有 14 個 key 皆為單純值或 JSON 物件；引入 schema 層會擴大本次範圍，且在只有一個消費者（`useTaskStore`）時無法驗證抽象是否合適。既有的鍵名布林白名單改以「宣告時附預設值，型別由預設值推導」取代。

### 決策 5：測試只覆蓋 `useTaskStore` 的純邏輯

`useStorage` 需要平台環境，`App.vue` 需要元件掛載環境，兩者都需要更重的測試設施（jsdom、mock Tauri API）。本次只導入 `vitest` 並測試 `useTaskStore` 中不依賴平台的部分：還原清理、投影剔除、上限裁切與空群組修剪、狀態轉換。

`useStorage` 以可注入的 adapter 介面設計，使其未來可被測試，但本次不撰寫其測試。

## Risks / Trade-offs

**[抽出 `useTaskStore` 需改動 40 處 `tasks.value` 引用，可能遺漏或誤改]** → 分兩步：先建立 composable 並讓 `App.vue` 以解構方式取得同名 `tasks`，使多數引用點無需改動；確認建置與手動驗證通過後，再逐步收攏直接存取。每一步都保持可執行。

**[Vue 響應式在 composable 邊界的行為差異]** → `tasks` 以 `ref` 形式由 composable 回傳，不使用 `reactive` 解構（會失去響應性）。抽出後必須實測：新增任務、進度更新、群組展開、刪除、清除紀錄五條路徑的 UI 更新。

**[投影剔除 `expanded` 後展開狀態不再記憶]** → 屬預期的行為變更，已在 proposal 說明。若使用者反映不便，後續以 `expandedIds` 補回。

**[保留上限 200 會靜默刪除使用者的舊紀錄]** → 首次裁切時以 Toast 告知清理筆數（已寫入規格情境）。裁切只移除清單紀錄，不刪除已下載的實體檔案 —— 此語意與既有的「清除紀錄」一致。

**[無測試的情況下改動持久化，可能造成使用者資料遺失]** → 新的還原流程必須能讀取舊格式（含瞬時欄位的既有資料）。實作時先在複本上驗證：以使用者現有的 38 筆 `config.json` 作為測試資料，確認還原結果正確且不遺失任務。

**[本次結束後 App.vue 仍約 2900 行，可能被誤認為「優化已完成」]** → proposal 的 Impact 已明列不在範圍內的項目；tasks.md 收尾項要求記錄實際行數與剩餘領域清單。

## Migration Plan

無資料格式的破壞性變更：新的還原邏輯需相容既有的 `avd_tasks` 內容（多餘的瞬時欄位讀取時忽略即可）。首次寫入後，儲存內容自然收斂為投影格式。

無需使用者操作、無需版本旗標。回退方式為 `git revert`，回退後既有儲存內容仍可被舊程式碼讀取（投影格式是舊格式的子集，缺少的瞬時欄位會取得預設值）。

## Open Questions

- ~~**Windows 端 sidecar 是否於 app 關閉後孤兒化續跑？**~~ **已於任務 1.1 查證，結論如下。**

  `tauri-plugin-shell` 2.3.5 於 `src/lib.rs` 註冊 `on_event(RunEvent::Exit)`，結束時會走訪其子行程登記表並逐一 `child.kill()`。該 crate 未使用 Windows Job Object，亦未設定 `kill_on_drop`，因此子行程的存活完全取決於該事件是否被觸發：

  | app 結束方式 | `RunEvent::Exit` | yt-dlp 子行程 | 清理語意 |
  | :--- | :--- | :--- | :--- |
  | 正常關閉（視窗 X） | 觸發 | 被 kill | 正確 |
  | 強制終止（工作管理員 / 崩潰 / 斷電） | 不觸發 | 孤兒化續跑 | 可能誤判 |

  Android 側不存在此問題：下載於 app 行程內執行，行程消滅即下載消滅，無孤兒化的可能。

  **對本變更的影響**：清理語意維持不變（決策 3 成立）。誤判窗口僅存在於 Windows 的強制終止情境，且後果輕微 —— 已下載完成的檔案被顯示為失敗，使用者可能重下一次。

  **衍生的後續需求（不在本次範圍）**：還原時比對 `path` 指向的檔案是否已存在且大小與 `fileSizeBytes` 相符，若相符則標記為 `success` 而非 `error`。此需求需要檔案系統存取，屬平台相依邏輯，適合與 `DownloadService` 的 Platform port 一併處理。
- **保留上限 200 是否合適？** 目前使用者累積 38 筆，短期不會觸發。數值可於實作時調整，不影響規格中的行為定義。
