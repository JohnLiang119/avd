## Why

「立即檢查」與自動排程檢查頻道新片時，當 YouTube RSS 回傳 404 或其他錯誤，`checkAllMonitoredChannels` 的 catch 區塊僅做 `console.warn`，最終仍顯示「已檢查完成，目前沒有新影片」。使用者被誤導以為頻道沒有新片，實際上是連線完全失敗。需要讓錯誤回饋誠實反映真實狀態。

## What Changes

- 在 `checkAllMonitoredChannels` 中新增失敗頻道計數器 (`failedCount`)。
- 依據成功/失敗數量，區分三種 Toast 回饋訊息：
  - ✅ 全部成功、沒新片 → 「目前沒有新影片」
  - ⚠️ 部分失敗 → 「已檢查完成，N 部新影片。（M 個頻道無法連線）」
  - ❌ 全部失敗 → 「無法連線至 YouTube，請稍後再試」

## Capabilities

### New Capabilities
- `channel-check-feedback`: 頻道檢查結果的誠實回饋機制，區分成功/部分失敗/全部失敗三種狀態。

### Modified Capabilities
<!-- 無修改既有 spec -->

## Impact

- 影響檔案：`src/App.vue`（`checkAllMonitoredChannels` 函式）
- 純前端邏輯變更，不影響後端、API 或依賴。
