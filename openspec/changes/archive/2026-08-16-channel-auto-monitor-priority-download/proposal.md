# 變更提案：YouTube 頻道自動追蹤與優先下載 (Channel Auto-Monitor & Priority Download)

## 為什麼要做 (Why)
使用者常常需要定期追蹤喜愛的 YouTube 頻道並下載最新發布的影片。目前 AVD 只能手動輸入或貼上單支/清單影片連結，無法自動週期性檢查新影片。
透過此功能，使用者可以手動貼上 YouTube 頻道網址或 @handle 加入追蹤清單，APP 每一小時會自動比對新影片，並將新發布的影片自動插隊至下載清單最前方，實現全自動的影音同步典藏體驗。

## 做什麼 (What)
1. **排程檢查**：預設每 1 小時自動檢查已追蹤頻道是否有新影片（比對上次檢查時間戳與最新 Video ID）。
2. **頻道來源與管理**：
   - 支援手動輸入 YouTube 頻道網址/Handle（如 `@ChannelName` 或 `https://www.youtube.com/@ChannelName`）加入追蹤。
3. **新片偵測與優先下載**：
   - 透過 YouTube 官方極速 RSS Feed 解析頻道最新影片（免消耗 API 配額，快速輕量）。
   - 偵測到發布時間大於上次檢查時間的新影片時，自動建立高畫質 MP4 下載任務，並插隊到下載清單的最前方（Priority Front / `tasks.unshift`）自動開始下載。
4. **UI 管理介面**：
   - 在頂部工具列新增「頻道追蹤」圖示按鈕與彈窗，提供狀態總覽、手動立即檢查、加入頻道與開關管理。

## 影響範圍 (Scope)
- 前端：`src/App.vue` (UI 介面、狀態持久化、定時器排程、插隊佇列)
- 服務層：`src/services/DownloadService.ts` (YouTube RSS XML 解析、頻道網址解析)
