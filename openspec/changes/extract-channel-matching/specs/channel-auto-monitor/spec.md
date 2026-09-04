## MODIFIED Requirements

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
