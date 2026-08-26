## MODIFIED Requirements

### Requirement: Periodic Check & New Video Matching
系統 MUST 支援每 60 分鐘自動或手動執行頻道輪詢，透過 YouTube 官方 RSS 並以影片實際發布時間判定新影片 (`publishedTime > lastPublishedTime`)。

#### Scenario: Auto and manual checking with publish time
- **WHEN** 系統啟動且距離上次檢查超過 60 分鐘，或使用者點擊手動檢查
- **THEN** 系統解析 RSS 並比對影片實際發布時間篩選出新發布的影片，並將該頻道的 `lastPublishedTime` 與 `lastKnownVideoId` 更新為最新影片的數值

#### Scenario: First time channel subscription anchor
- **WHEN** 使用者剛新增追蹤頻道或頻道首次執行檢查
- **THEN** 系統將該頻道目前最新影片的發布時間與 ID 設為起始基準錨點，不觸發歷史影片下載

#### Scenario: Display latest publish time on channel card
- **WHEN** 使用者檢視已追蹤頻道清單
- **THEN** 系統在各頻道卡片上展示該頻道最新影片之發布時間格式化資訊

#### Scenario: Task title with publish time on main queue
- **WHEN** 系統將任何影片建立或完成為下載任務並加入主畫面佇列（包含使用者手動單一加入、自動追蹤或播放清單解析）
- **THEN** 系統產生的任務標題（抬頭）後方自動包含該影片之發布時間格式化資訊 (YYYY/MM/DD HH:mm:ss)
