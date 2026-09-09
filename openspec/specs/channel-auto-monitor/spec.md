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

系統 MUST 支援每 60 分鐘自動或手動執行頻道輪詢，透過 YouTube 官方 RSS 並以影片實際發布時間判定新影片 (`publishedTime > lastPublishedTime`)。

新影片的判定 MUST（必須）同時滿足「發布時間晚於該頻道的時間錨點」與「尚未存在於下載佇列」兩個條件。頻道首次被追蹤時，系統 MUST（必須）僅初始化時間錨點而不建立任何下載任務。時間錨點 MUST NOT（不得）在缺少精確發布時間的情況下被推進至當下時間。

#### Scenario: Auto and manual checking

- **WHEN** 系統啟動且距離上次檢查超過 60 分鐘，或使用者點擊手動檢查
- **THEN** 系統解析 RSS 並比對影片實際發布時間篩選出新發布的影片，並將該頻道的 `lastPublishedTime` 與 `lastKnownVideoId` 更新為最新影片的數值

#### Scenario: First time channel subscription anchor

- **WHEN** 使用者剛新增追蹤頻道或頻道首次執行檢查（`lastPublishedTime` 與 `lastCheckTime` 皆無值）
- **THEN** 系統將該頻道目前最新影片的發布時間與 ID 設為起始基準錨點，不觸發歷史影片下載
- **AND** 若該最新影片不帶精確發布時間，系統不建立錨點，維持未初始化狀態待下次檢查

#### Scenario: 影片已存在於下載佇列

- **WHEN** 某支影片的發布時間晚於錨點，但佇列中已有相同影片 ID 的任務
- **THEN** 系統不重複建立任務
- **AND** 去重比對涵蓋扁平任務，以及頻道群組底下播放清單的巢狀子任務

#### Scenario: 取得精確發布時間時推進錨點

- **WHEN** 本次檢查有影片被實際處理，且其帶有精確發布時間
- **THEN** 系統將該頻道的時間錨點更新為已處理影片中最新者的發布時間

#### Scenario: 缺少精確發布時間時保留錨點

- **WHEN** 檢查取得的最新影片不帶精確發布時間（例如備援通道未回傳時間欄位）
- **THEN** 系統保留該頻道原有的時間錨點不變
- **AND** 不以當下時間推進錨點，避免基準被推至未來而導致後續永久漏片

#### Scenario: 新影片以優先順序加入佇列

- **WHEN** 篩選出一支或多支新影片
- **THEN** 系統為每支影片建立下載任務，任務標題包含頻道名稱前綴與發布時間，並依來源標記為 RSS 或 yt-dlp 備援
- **AND** 任務的子資料夾名稱以頻道名稱產生，且已移除檔案系統不接受的字元

#### Scenario: Display latest publish time on channel card

- **WHEN** 使用者檢視已追蹤頻道清單
- **THEN** 系統在各頻道卡片上展示該頻道最新影片之發布時間格式化資訊

#### Scenario: Task title with publish time on main queue

- **WHEN** 系統將任何影片建立、進行下載或完成為下載任務並於主畫面佇列呈現（包含使用者手動單一加入、自動追蹤或播放清單解析）
- **THEN** 系統產生的任務標題（抬頭）在排隊、下載中與完成後始終穩定包含該影片之發布時間格式化資訊 (YYYY/MM/DD HH:mm:ss)，不因進度更新或下載完成事件而遺失

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

### Requirement: 時間錨點的推進邊界

頻道的時間錨點（`lastPublishedTime`）MUST NOT（不得）推進超過本次檢查中未被實際處理的影片。因直播而被跳過、或因狀態查詢失敗而未能判定的影片，MUST（必須）保持在錨點之後，使其於後續檢查中重新被評估。

錨點 MUST（必須）推進至本次已處理完畢的影片中最新者的發布時間；若本次沒有任何影片被處理，錨點 MUST（必須）維持不變。

#### Scenario: 最新影片因直播而被跳過

- **WHEN** 檢查取得的最新影片是直播而被跳過，其後另有一支已成功加入佇列的一般影片
- **THEN** 錨點推進至該一般影片的發布時間，而非被跳過的直播的發布時間
- **AND** 下次檢查時該直播仍被視為待評估項目

#### Scenario: 被跳過的直播結束後轉為存檔影片

- **WHEN** 先前因直播而被跳過的影片已結束直播、可正常下載，且其發布時間未曾改變
- **THEN** 由於錨點未曾越過它，系統於後續檢查中仍能將其判定為新片並加入佇列

#### Scenario: 本次所有影片皆被跳過

- **WHEN** 本次檢查取得的影片全數因直播而被跳過
- **THEN** 錨點維持不變，不做任何推進
