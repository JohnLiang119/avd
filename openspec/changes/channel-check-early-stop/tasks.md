## 1. 提早停止判斷與訊息文案

- [x] 1.1 在 `src/services/rateLimit.ts` 新增一個依「提早停止時尚有幾個頻道未檢查」回傳文案的純函式（例如 `describeEarlyStop(skippedCount: number): string`，緊鄰既有 `describeChannelRssFailure`），文字需明確區分「提早結束、尚有 N 個未檢查」與「已檢查但失敗」；撰寫單元測試涵蓋 `skippedCount` 為 1 與多個的文案
- [x] 1.2 修改 `src/App.vue` 的 `checkAllMonitoredChannels`（約 1638-1701 行的 `for...of` 迴圈）：在 `catch` 區塊內，`classifyChannelRssError(err)` 結果為 `'network'` 時，記錄 `stoppedEarly = true` 與此刻尚未檢查的頻道數，並 `break` 跳出迴圈；伺服器層／內容層錯誤維持現行行為（記錄失敗、繼續下一頻道），不觸發此分支
- [x] 1.3 修改迴圈結束後的總結提示邏輯（約 1706-1740 行）：新增獨立分支，`stoppedEarly` 為真時優先於既有四分支，呼叫 1.1 的文案函式組出總結 Toast，並在 `errorLog` 補一筆對應的總結紀錄（`context` 使用類似「頻道檢查（提早結束）」的字樣）
- [x] 1.4 執行 `npx vue-tsc --noEmit` 確認型別正確，並人工核對已處理過的頻道（`break` 之前）之時間錨點推進與新影片下載邏輯不受影響

## 2. 測試

- [x] 2.1 為 1.1 新增的文案函式撰寫單元測試（比照 `rateLimit.spec.ts` 既有風格）
- [x] 2.2 確認 `channel-check-network-resilience` 既有的 `classifyChannelRssError`／`fetchYouTubeRss` 相關測試（`DownloadService.spec.ts`、`rateLimit.spec.ts`）在本次變更後仍全數通過，未被意外影響

## 3. 整合驗證

- [x] 3.1 執行 `npm run build`、`npm test`、`npx vue-tsc --noEmit` 全數通過
- [ ] 3.2 人工核對：啟用多個追蹤頻道，手動觸發「檢查頻道」時中途斷開網路，確認第一個出現裝置網路層錯誤（`NETWORK_ERROR`）的頻道之後，其餘頻道不再被檢查（可觀察 console 或計時），且總結提示與 `errorLog` 皆標註「本輪已提早結束，尚有 N 個頻道未檢查」而非「已檢查但失敗」
- [ ] 3.3 人工核對：網路正常、但頻道 RSS 回應 404/500（伺服器層）時，確認不會觸發提早停止，所有已啟用頻道仍逐一檢查完畢，行為與 `channel-check-network-resilience` 上線後現況一致
- [ ] 3.4 人工核對：提早停止後，被跳過的頻道之「最新影片發布時間」（頻道卡片顯示）與時間錨點維持提早停止前的既有數值，未被錯誤更新

## 4. 版本進版

- [ ] 4.1 全面同步 avd 專案版號（`package.json`、`package-lock.json` 兩處、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`android/app/build.gradle` 的 `versionName` 與 `versionCode`）
- [ ] 4.2 確認第 3 節全部驗證通過後，建立獨立於功能修正的進版 commit
