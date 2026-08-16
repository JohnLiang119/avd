## MODIFIED Requirements

### Requirement: Channel Subscription & Management
系統必須允許使用者手動輸入 YouTube 頻道網址或 Handle 解析出資訊，提供視覺化追蹤清單，並支援個別頻道狀態切換與刪除。當使用者在主畫面上方的網址列直接輸入頻道網址時，系統也必須檢查該頻道是否在追蹤清單內，若不在則必須主動詢問使用者是否要加入追蹤。

#### Scenario: User manages subscriptions
- **WHEN** 使用者在專屬追蹤清單介面輸入頻道網址或管理追蹤清單
- **THEN** 系統更新本地持久化儲存 (`localStorage`) 的追蹤狀態

#### Scenario: User pastes a channel URL in the main input field and confirms tracking
- **WHEN** 使用者在主畫面輸入頻道網址或 Handle，且該頻道不在追蹤清單內，並在提示視窗中選擇「加入追蹤並下載」
- **THEN** 系統將該頻道加入追蹤清單 (`localStorage`)，並繼續執行該頻道的單次下載任務

#### Scenario: User pastes a channel URL in the main input field and declines tracking
- **WHEN** 使用者在主畫面輸入頻道網址或 Handle，且該頻道不在追蹤清單內，並在提示視窗中選擇「僅下載」
- **THEN** 系統不修改追蹤清單，直接執行該頻道的單次下載任務
