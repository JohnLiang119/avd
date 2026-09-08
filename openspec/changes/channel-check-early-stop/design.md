## Context

見 proposal.md - Why。補充程式碼現況：

- `checkAllMonitoredChannels`（`src/App.vue` 約 1620-1720 行）以 `for...of` 逐一迭代 `enabledChannels`，每個頻道各自 `try/catch`；失敗時累加 `failedCount`、把錯誤層級推入 `failedLevels`、寫入 `errorLog`，然後繼續下一個頻道。
- `channel-check-network-resilience`（已實作、尚未進入手動實機驗證與進版）已讓 `fetchYouTubeRss` 在網路層／伺服器層錯誤時於呼叫端內部重試 3 次（2s→4s→8s）才拋錯，並提供 `classifyChannelRssError`（`src/services/rateLimit.ts`）把錯誤訊息分類為 `network`／`server`／`content` 三種層級。本次變更直接沿用這個分類函式，不重造。
- 迴圈結束後的總結提示邏輯（約 1706-1720 行起）用 `failedCount >= enabledChannels.length` 判斷「是否全部失敗」；提早停止後這個條件不會成立（因為只跑了部分頻道），需要新增獨立分支。

## Goals / Non-Goals

**Goals:**
- 一偵測到裝置網路層錯誤（`network` 層級），立即結束本輪迴圈，不再檢查剩餘頻道。
- 總結提示與錯誤日誌清楚區分「提早停止、尚有 N 個未檢查」與「已檢查但失敗」，避免使用者誤判。
- 被跳過的頻道本輪不觸碰時間錨點，維持既有「檢查失敗不推進錨點」的資料完整性保證。

**Non-Goals:**
- 不新增跨輪次的頻道健康度追蹤（連續失敗計數、自動停用頻道等）——與 `channel-check-network-resilience` 的 Non-Goals 立場一致，範圍只限「這一輪要不要繼續跑完」。
- 不變更 `useNetworkStatus`／主畫面網路狀態元件（`show-network-status`）——兩者是獨立機制，本次不做互相連動，避免耦合兩個各自獨立驗收的功能。
- 不處理伺服器層（404/500）或內容層錯誤的提早停止——維持它們現行的逐頻道退避重試與繼續檢查行為，理由見 Decisions。
- 不變更 `fetchChannelRssWithRetry` 內部的重試機制本身；本次只在其之上的呼叫端（`checkAllMonitoredChannels`）新增迴圈層級的提早停止判斷。

## Decisions

### 1. 觸發條件：只要出現一次 `network` 層級錯誤就立即停止，不設連續失敗次數門檻

**決策**：`classifyChannelRssError` 回傳 `network` 時（裝置端網路層，如 DNS 失敗、連線逾時、連線被拒——已通過 `fetchChannelRssWithRetry` 的 3 次重試仍失敗），視為「這台裝置現在確定連不上網」的明確訊號，立即 `break` 跳出檢查迴圈，不再嘗試剩餘頻道。

**理由**：`network` 層級的錯誤語意本身就是「尚未連上伺服器」，不像 `server` 層級（404/500）可能只是單一頻道或短暫狀況——`channel-check-network-resilience` design.md 的實測已證實同一頻道的 404/500 會時好時壞，但裝置端網路層錯誤（連線都建立不起來）沒有這種「單一頻道」的解讀空間。2026-09-08 的實測日誌中，第一筆失敗即為 `NETWORK_ERROR`，若當時就停止，可省下後續 10 個頻道各自重試耗盡的時間（每個最壞 14 秒）。

**替代方案考慮**：改用「連續 N 次（不分層級）失敗才停止」的門檻機制。
**否決理由**：使用者已在决策前的討論中明確選擇「一偵測到 `NETWORK_ERROR` 就立即停」，理由是邏輯單純、直接對應既有 Open Question 的原始提問；已知的取捨是：若未來出現「純 `server` 層級（無 `network` 層級）的連續大量失敗」（例如整個出口 IP 被 YouTube 針對 RSS feeds 端點封鎖但裝置本身連線正常，2026-09-08 的手動 curl 測試已證實這種情境存在），本次機制不會觸發提早停止，仍會逐頻道跑完重試——此取捨記錄於 Risks / Trade-offs，留待未來有更多實據再議是否擴大觸發條件。

### 2. 迴圈層級以 `break` 實作，不改動 `fetchYouTubeRss`／重試邏輯本身

**決策**：在 `checkAllMonitoredChannels` 的 `catch` 區塊內，`classifyChannelRssError(err)` 結果為 `network` 時，記錄本輪為「提早停止」狀態（例如一個 `stoppedEarly` 旗標與此時尚未檢查的頻道數），並 `break` 跳出 `for...of`。既有的「記錄該筆失敗到 `errorLog`、累加 `failedCount`」邏輯維持不變，只是在其後多加一個 `break`。

**理由**：改動面最小，`fetchChannelRssWithRetry`、`classifyChannelRssError` 等既有邊界與純函式完全不動；提早停止純粹是呼叫端（迴圈)的控制流程調整。

### 3. 總結提示新增獨立分支，優先於既有的「全部/部分失敗」判斷

**決策**：迴圈結束後，若 `stoppedEarly` 為真，總結提示與（如需要）額外一筆 `errorLog` 紀錄優先顯示「本輪已提早結束，尚有 N 個頻道未檢查（裝置網路層錯誤）」，不進入現行「全部失敗／部分失敗有新片／部分失敗無新片／全部成功」四分支判斷（那組判斷假設迴圈已跑完所有 `enabledChannels`，提早停止時此假設不成立）。既有四分支邏輯本身不變，只是新增一個更早判斷的分支。

**理由**：維持既有分支邏輯的正確性——若硬套現有判斷，`failedCount`（只計入實際跑過的頻道）會小於 `enabledChannels.length`，導致誤入「部分失敗」分支，但實際上是「大部分根本沒檢查」，措辭會誤導使用者。

## Risks / Trade-offs

- **[Risk]** 只用 `network` 層級觸發，涵蓋不了「裝置連線正常，但伺服器端（如 YouTube RSS feeds 後端）針對本機出口 IP 封鎖，導致連續大量 `server` 層級 404」的情境——2026-09-08 已用 `curl` 實測證實此情境確實會發生（`www.youtube.com/` 首頁 200 正常，但 `feeds/videos.xml` 對任何頻道皆回真實 404）。
  → **Mitigation**：本次刻意先解決使用者已確認、範圍明確的 `network` 觸發情境；`server` 層級的提早停止門檻涉及更複雜的權衡（如何避免誤判單一頻道真的被刪除／改名為「全域異常」），留待未來有更多實據時另案處理，不在本次擴大範圍。
- **[Risk]** 提早停止後，被跳過的頻道要等到下一次排程（預設 60 分鐘後）或使用者手動觸發才會被檢查，若裝置網路很快恢復，這些頻道會比现狀（逐一跑完重試、恢復後仍會嘗試到它們）更晚被檢查到。
  → **Mitigation**：這是提早停止機制的本質取捨——省下的重試時間遠大於多等一輪的延遲；且使用者隨時可手動觸發「檢查頻道」重跑整輪，不需要等下一次排程。

## Migration Plan

無資料遷移，純行為變更。依專案既有版本進版規範（`CLAUDE.md`）：完成後同步更新 Windows 與 Android 雙端版號，並在完整建置與測試通過後進版。不涉及使用者資料格式或既有設定欄位的改變。
