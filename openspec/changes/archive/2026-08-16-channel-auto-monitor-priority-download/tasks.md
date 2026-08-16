# 任務清單 (Tasks)

## 狀態標記說明
- [ ] 未開始
- [/] 進行中
- [x] 已完成

## 開發任務
- [x] 步驟 1：擴充 `src/services/DownloadService.ts` 服務層
  - [x] 實作 `fetchYouTubeRss(channelId)`：透過官方 XML Feed 解析頻道最新影片資訊
  - [x] 實作 `resolveYouTubeChannel(input)`：解析 Handle、網址與 Channel ID
- [x] 步驟 2：修改 `src/App.vue` 狀態與排程引擎
  - [x] 建立 `monitoredChannels` 與 `monitorConfig` 響應式狀態與持久化
  - [x] 實作每 1 小時週期排程器與 APP 啟動時間戳比對邏輯 (`checkMonitoredChannels`)
  - [x] 實作新片比對演算法，建立 MP4 下載任務並以 `tasks.unshift` 插入佇列最前方
- [x] 步驟 3：在 `src/App.vue` 建立 UI 互動管理介面
  - [x] 在頂部工具列新增「頻道追蹤」圖示按鈕 (`bullhorn-o`)
  - [x] 實作「頻道自動追蹤管理彈窗」（排程開關、上次檢查時間、手動立即檢查按鈕、手動加入頻道、已追蹤清單）
- [x] 步驟 4：驗證與建置測試
  - [x] 確保所有修改檔案儲存為 UTF-8 with BOM
  - [x] 執行 `npm run build` 驗證編譯成功
