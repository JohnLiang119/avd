## 1. 資料模型與狀態型別更新

- [x] 1.1 更新 `src/App.vue` 中的 `MonitoredChannel` 介面，新增 `lastPublishedTime` 欄位並維持 `lastCheckTime` 向下相容
- [x] 1.2 更新手動新增頻道 (`addManualChannel`) 邏輯，在初次加入時將基準時點設定為最新影片的實際 `publishedTime`

## 2. 核心比對與時點更新機制重構

- [x] 2.1 重構 `checkAllMonitoredChannels` 中的新影片過濾邏輯，改以 `lastPublishedTime` 嚴格大於上次發布時間進行判定
- [x] 2.2 更新檢查完成後的時點寫入邏輯，將最新影片之實際發布時間寫入 `channel.lastPublishedTime`
- [x] 2.3 在頻道卡片 UI 介面（頻道名稱後方或最新影片欄位）加入格式化之最新發布時間展示 (YYYY/MM/DD HH:mm:ss)
- [x] 2.4 在建立影片下載任務時（包含使用者手動單一輸入加入、自動追蹤、模擬測試或播放清單解析），於主畫面任務標題（抬頭）後方自動附帶發布時間標記 (YYYY/MM/DD HH:mm:ss)

## 3. 備份還原與邊界相容性驗證

- [x] 3.1 檢查並更新備份匯出/還原 (`exportChannelsJson` / `confirmRestoreChannels`) 中的時間欄位相容處理
- [x] 3.2 驗證既有舊資料（僅有 `lastCheckTime`）的平滑過渡與測試模擬功能 (`simulateNewVideo`)
