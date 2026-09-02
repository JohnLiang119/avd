## 1. 修改 checkAllMonitoredChannels 函式

- [x] 1.1 在函式內新增 `let failedCount = 0` 變數，並在 catch 區塊中累加 `failedCount++`
- [x] 1.2 重寫函式結尾的 Toast 訊息邏輯，依據 `failedCount` 與 `newVideoCount` 區分五種情境

## 2. 驗證

- [x] 2.1 確認檔案以 UTF-8 with BOM 編碼儲存，且 `npm run build` 可通過編譯
