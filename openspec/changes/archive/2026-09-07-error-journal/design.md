## Context

動機與現況統計見 `proposal.md`。本節補充實作所需的既有條件。

**既有資產**

- `storage.defineSetting<T>(key, default)`（`useStorage.ts`）提供持久化，兩平台差異已收斂於儲存埠。日誌直接掛上去即可，不需新機制。
- `useTaskStore.ts` 的 `applyRetentionLimit` 已示範環狀保留上限的作法與測試方式。
- 設定面板為 `van-dialog v-model:show="showSettingsModal"`（`App.vue:541`），可在其中新增一列入口。

**缺口**

- 專案目前**完全沒有剪貼簿能力** —— 全域搜尋 `clipboard` / `writeText` 只命中 `@tauri-apps/plugin-fs` 的檔案寫入。複製功能需從零加。

## Goals / Non-Goals

**Goals**

- 使用者能在事後拿到錯誤原文，並以一個動作交出來。
- 記錄這件事不能成為新的故障源 —— 寫日誌失敗絕不可讓原本的操作更糟。

**Non-Goals**

- 不做完整執行日誌、不做篩選搜尋、不上傳。
- 不改動下載任務既有的 `errorMsg` / `line` 機制。
- 不把 60 處成功／資訊類的 `showToast` 一併改寫。

## Decisions

### D1. `reportError(context, error)` 作為單一入口，同時記錄與提示

錯誤路徑改為呼叫一個函式，而非分別呼叫「記錄」與「提示」。理由：分開呼叫必然會漏 —— 17 處各自要記得寫兩行，日後新增的錯誤路徑更會忘。單一入口讓「提示了就一定有紀錄」成為結構保證而非紀律要求。

`context` 為簡短的操作描述（如 `解析播放清單`、`匯出頻道清單`），使日誌讀起來知道是哪個操作失敗，而不只有一串訊息。

### D2. 記錄失敗不得影響原操作

`reportError` 內部的日誌寫入 MUST 以 try/catch 包覆並吞掉例外，提示照常顯示。

理由：呼叫 `reportError` 的地方**本來就已經在錯誤處理路徑上**了。若寫日誌自己拋例外，會把一個「操作失敗但有提示」變成「例外往上冒、可能連提示都沒有」—— 診斷工具反而讓故障更難診斷。

### D3. 保留上限 50 筆，以純函式表達並測試

環狀緩衝的裁切邏輯抽為純函式 `appendErrorEntry(entries, entry, limit)`，置於 `src/composables/useErrorLog.ts`，可被 vitest 引用。

50 筆的理由：足以涵蓋一輪驗證或一次批次下載的失敗，又不至於讓持久化的資料量顯著增長（每筆約 100~300 字元，50 筆上限約 15 KB）。

**沿用 `parseScope.ts` / `fileNaming.ts` / `displayFormat.ts` 的模式**：純函式獨立成模組，不與有平台相依的模組混居。這已是本專案第四次因此受阻，此處直接照做。

### D4. 錯誤提示：延長至 5 秒並可點擊關閉

vant 的 `showToast` 預設 2 秒。錯誤改為 `duration: 5000` 搭配 `closeOnClick: true`。

**為何不改用需手動關閉的對話框**：錯誤提示出現在各種情境，其中不少是使用者已預期的（例如取消操作後的後續失敗）。強制每則都要按確認會很煩。「停留久一點 + 想關就關」是較合適的平衡，讀不完的部分由日誌承接。

### D5. 剪貼簿以 `navigator.clipboard` 為主，並必須處理失敗

兩平台的 WebView 皆支援 `navigator.clipboard.writeText`，但它在非安全內容或權限被拒時會拋例外。

**必須明確回報失敗**（規格已要求）：靜默失敗會讓使用者以為複製成功、貼出空白，比直接說失敗更糟。

不引入額外的剪貼簿套件 —— 為單一功能增加相依不划算；若日後實測發現某平台不可用，再評估。

### D6. 日誌內容以純文字複製，不用 JSON

複製出來的內容是給人讀、給對話貼的，不是給程式解析的。格式為每筆一段：

```
[2026/09/04 16:42:11] 解析播放清單
ERROR: [BiliBili] Unable to download webpage: HTTP Error 412: Precondition Failed
```

JSON 會讓貼出來的內容充滿引號與跳脫字元，反而難讀。

## Risks / Trade-offs

- **[Risk] 日誌寫入使持久化資料變大，拖慢既有的儲存流程** → Mitigation：50 筆上限；且錯誤本就不常發生，寫入頻率遠低於任務樹。
- **[Risk] 錯誤訊息中可能夾帶敏感資訊**（例如帶 token 的網址）→ 日誌僅存本機且不自動上傳，複製是使用者的主動行為。但需在檢視畫面提醒「複製前請確認內容」。此點列入任務。
- **[Risk] 改寫 17 處呼叫時漏改或改錯情境描述** → Mitigation：改完後全域搜尋 `showToast` 中含「失敗」「錯誤」「❌」的字樣，確認殘留者皆為刻意保留。
- **[Trade-off] 只記錯誤不記操作** → 有些故障需要前後文才能重現。接受此限制：完整執行日誌的成本與噪音都高得多，而目前的痛點明確是「錯誤看不到」。

## Migration Plan

新增一項持久化設定，預設為空陣列。舊版本升級後日誌為空，逐步累積，無遷移需求。回退即 `git revert`，遺留的設定項被忽略。

## Open Questions

- **Android WebView 的 `navigator.clipboard` 是否在此 App 的設定下可用。** 若不可用，退路是以 Capacitor 的分享機制或原生 plugin 補上。此點不影響其餘設計，任務中實測確認。
