## Purpose

提供 YouTube 頻道自動追蹤與優先排程下載機制，讓使用者能自動獲取追蹤頻道的最新影片。

### Requirement: Channel Subscription & Management
系統必須允許使用者手動輸入 YouTube 頻道網址或 Handle 解析出資訊，提供視覺化追蹤清單，並支援個別頻道狀態切換與刪除。

#### Scenario: User manages subscriptions
- **WHEN** 使用者輸入頻道網址或管理追蹤清單
- **THEN** 系統更新本地持久化儲存 (`localStorage`) 的追蹤狀態

### Requirement: Periodic Check & New Video Matching
系統必須支援每 60 分鐘自動或手動執行頻道輪詢，透過 YouTube 官方 RSS 判定新影片 (`published > lastCheckTime`)。

#### Scenario: Auto and manual checking
- **WHEN** 系統啟動且距離上次檢查超過 60 分鐘，或使用者點擊手動檢查
- **THEN** 系統解析 RSS 並比對發布時間篩選出新影片

### Requirement: Priority Insertion & Automatic Download
系統必須將偵測到的新影片建立為 MP4 高畫質任務並插入下載佇列最前面 (`tasks.unshift`)，若當前無任務則自動開始下載，並更新檢查時間。

#### Scenario: Auto download priority
- **WHEN** 偵測到新影片
- **THEN** 新任務插入佇列頂部並自動觸發下載流程
