## Purpose

提供 YouTube 頻道自動追蹤與優先排程下載機制：使用者可訂閱並管理頻道清單，系統定期透過官方 RSS 輪詢比對新影片（免消耗 API 配額），偵測到新片時自動建立下載任務並插入佇列最前端優先執行，讓使用者無須手動查看即可獲取追蹤頻道的最新影片。
## Requirements
### Requirement: Channel Subscription & Management
系統 MUST（必須）允許使用者手動輸入 YouTube 頻道網址或 Handle 解析出資訊，提供視覺化追蹤清單，並支援個別頻道狀態切換與刪除。當使用者在主畫面上方的網址列直接輸入頻道網址時，系統也 MUST（必須）檢查該頻道是否在追蹤清單內，若不在則 MUST（必須）主動詢問使用者是否要加入追蹤。

#### Scenario: User manages subscriptions
- **WHEN** 使用者在專屬追蹤清單介面輸入頻道網址或管理追蹤清單
- **THEN** 系統更新本地持久化儲存 (`localStorage`) 的追蹤狀態

#### Scenario: User pastes a channel URL in the main input field and confirms tracking
- **WHEN** 使用者在主畫面輸入頻道網址或 Handle，且該頻道不在追蹤清單內，並在提示視窗中選擇「加入追蹤並下載」
- **THEN** 系統將該頻道加入追蹤清單 (`localStorage`)，並繼續執行該頻道的單次下載任務

#### Scenario: User pastes a channel URL in the main input field and declines tracking
- **WHEN** 使用者在主畫面輸入頻道網址或 Handle，且該頻道不在追蹤清單內，並在提示視窗中選擇「僅下載」
- **THEN** 系統不修改追蹤清單，直接執行該頻道的單次下載任務

### Requirement: Periodic Check & New Video Matching
系統 MUST 支援每 60 分鐘自動或手動執行頻道輪詢，預設透過 YouTube 官方 RSS 比對影片發布時間 (`publishedTime > lastPublishedTime`) 判定新影片。

#### Scenario: Auto and manual checking
- **WHEN** 系統啟動且距離上次檢查超過 60 分鐘，或使用者點擊手動檢查
- **THEN** 系統預設呼叫官方 RSS 獲取最新影片，比對發布時間篩選出新影片，並精確更新頻道發布時間錨點

### Requirement: Priority Insertion & Automatic Download
系統MUST（必須）將偵測到的新影片建立為 MP4 高畫質任務並插入下載佇列最前面 (`tasks.unshift`)，若當前無任務則自動開始下載，並更新檢查時間。

#### Scenario: Auto download priority
- **WHEN** 偵測到新影片
- **THEN** 新任務插入佇列頂部並自動觸發下載流程

### Requirement: 輸入頻道網址時的追蹤與掃描兩段確認

當使用者於主畫面網址列輸入頻道網址時，系統 MUST（必須）先依該頻道是否已在追蹤清單中決定是否詢問加入追蹤，再一律詢問是否掃描該頻道的歷史影片明細。使用者於掃描確認中選擇略過時，系統 MUST（必須）中止後續的播放清單解析流程。

#### Scenario: 輸入尚未追蹤的頻道網址

- **WHEN** 使用者輸入頻道網址，系統解析出頻道資訊且該頻道不在追蹤清單中
- **THEN** 系統顯示標題為「發現新頻道」的確認對話框，訊息中帶入該頻道名稱並說明加入後將每小時自動檢查並下載新影片，提供「加入追蹤」與「不加入」兩個選項
- **AND** 使用者選擇「加入追蹤」時，系統將該頻道加入追蹤清單
- **AND** 無論使用者是否加入追蹤，系統接續顯示掃描歷史明細的確認對話框

#### Scenario: 輸入已在追蹤清單中的頻道網址

- **WHEN** 使用者輸入頻道網址，且該頻道已存在於追蹤清單中
- **THEN** 系統 MUST（必須）略過加入追蹤的詢問，直接顯示掃描歷史明細的確認對話框

#### Scenario: 確認掃描歷史影片明細

- **WHEN** 掃描確認對話框顯示，使用者選擇「掃描並選擇下載」
- **THEN** 系統繼續執行既有的播放清單解析流程，展開該頻道的歷史影片供勾選下載

#### Scenario: 略過掃描歷史影片明細

- **WHEN** 掃描確認對話框顯示，使用者選擇「略過」
- **THEN** 系統中止後續處理，不進行播放清單解析，也不建立任何下載任務

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

