# 規格：YouTube 頻道自動追蹤與優先排程 (Capability: channel-auto-monitor)

## 需求與行為規格 (Requirements & Behaviors)

### 1. 頻道訂閱與管理
- **系統必須 (SHALL)** 允許使用者手動輸入 YouTube 頻道網址或 Handle（例如 `@ChannelName`），並解析出 `channelId`、`title` 與 `thumbnail`。
- **系統必須 (SHALL)** 提供視覺化追蹤清單，儲存至本地持久化儲存 (`localStorage`)。
- **系統必須 (SHALL)** 允許使用者隨時個別啟用/停用或刪除已追蹤的頻道。

### 2. 定期檢查與新片比對
- **系統必須 (SHALL)** 支援每 60 分鐘自動執行一次頻道輪詢檢查。
- **系統必須 (SHALL)** 在 APP 啟動時檢查自上次全域檢查時間是否已超過 60 分鐘，若已超過則立即發起檢查。
- **系統必須 (SHALL)** 提供手動「立即檢查」按鈕，供使用者隨時手動觸發。
- **系統必須 (SHALL)** 透過 YouTube 官方 RSS Feed (`https://www.youtube.com/feeds/videos.xml?channel_id=...`) 解析頻道最新影片。
- **系統必須 (SHALL)** 判定影片發布時間大於頻道上次檢查時間 (`published > lastCheckTime`) 且非重複任務者為新影片。

### 3. 優先插隊與自動下載
- **系統必須 (SHALL)** 將偵測到的新影片自動建立為 MP4 高畫質下載任務。
- **系統必須 (SHALL)** 將新任務插入到下載佇列最前面（`tasks.unshift`），確保享有最高優先權。
- **系統必須 (SHALL)** 在當前無進行中任務時，自動調用 `startNextDownload()` 開始下載。
- **系統必須 (SHALL)** 在新片成功排入下載後，更新該頻道的 `lastCheckTime` 與 `lastKnownVideoId`。
