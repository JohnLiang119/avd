## Context

見 proposal.md。`checkAllMonitoredChannels` (App.vue L1466) 的 catch 區塊僅做 `console.warn`，不計數失敗，導致結尾的 Toast 訊息無法區分「成功但沒新片」與「全部失敗」。

## Goals / Non-Goals

**Goals:**
- 在 `checkAllMonitoredChannels` 中追蹤失敗頻道數量
- 依據成功/失敗組合，顯示對應的 Toast 訊息

**Non-Goals:**
- 不改動 RSS 抓取邏輯本身
- 不新增 fallback RSS 來源
- 不改動自動排程觸發條件

## Decisions

### 在現有 for 迴圈的 catch 中累加 failedCount

**選擇**：在 `checkAllMonitoredChannels` 函式頂層新增 `let failedCount = 0`，在 L1544 的 catch 區塊中加入 `failedCount++`。

**理由**：最小改動，不需要改變現有流程結構。`newVideoCount` 已經在同層級追蹤成功的新影片數，`failedCount` 對稱地追蹤失敗數。

**替代方案**：
- 為每個頻道維護獨立的錯誤狀態 → 過度設計，此階段只需要計數。

### Toast 訊息邏輯放在函式結尾統一處理

**選擇**：在函式結尾（目前 L1552-L1557 的位置），根據 `failedCount` 與 `newVideoCount` 的組合決定顯示什麼訊息。

**理由**：集中處理，邏輯清晰，也只影響手動觸發 (`isManual`) 的情境。

## Risks / Trade-offs

- [風險] 自動排程 (`isManual = false`) 時不顯示 Toast → 這是刻意的，不應在背景自動排程時彈出錯誤干擾使用者。
