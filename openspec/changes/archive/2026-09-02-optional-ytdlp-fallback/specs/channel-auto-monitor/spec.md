## MODIFIED Requirements

### Requirement: Periodic Check & New Video Matching
系統 MUST 支援每 60 分鐘自動或手動執行頻道輪詢，預設透過 YouTube 官方 RSS 比對影片發布時間 (`publishedTime > lastPublishedTime`) 判定新影片。

#### Scenario: Auto and manual checking
- **WHEN** 系統啟動且距離上次檢查超過 60 分鐘，或使用者點擊手動檢查
- **THEN** 系統預設呼叫官方 RSS 獲取最新影片，比對發布時間篩選出新影片，並精確更新頻道發布時間錨點

## ADDED Requirements

### Requirement: Optional Fallback Mechanism and Source Transparency
系統 MUST 將 yt-dlp flat-playlist 首頁備援機制預設為關閉狀態，並在頻道監控設定中提供開關供使用者自由切換。當檢查頻道與建立任務時，系統 MUST 明確標註資料來源通道（官方 RSS 或 yt-dlp 備援）。

#### Scenario: RSS failure with fallback disabled
- **WHEN** 官方 RSS 連線異常且使用者未開啟 yt-dlp 備援開關（預設狀態）
- **THEN** 系統不啟動 yt-dlp 子行程，直接回報官方 RSS 連線失敗提示，並提醒可於設定中開啟備援

#### Scenario: Fallback enabled when RSS fails
- **WHEN** 官方 RSS 連線異常且使用者已於設定中開啟 yt-dlp 備援開關
- **THEN** 系統自動切換至 yt-dlp 爬取頻道首頁，並在回傳資料與任務排隊狀態中明確標註來源為備援通道 (`fallback`)

#### Scenario: Task and notification transparency
- **WHEN** 新影片被加入下載佇列或完成頻道檢查
- **THEN** 系統在任務狀態文字（`line`）與通知提示中明確標記資料來源通道（如 `【自動追蹤 (RSS)】` 或 `【自動追蹤 (yt-dlp 備援)】`）
