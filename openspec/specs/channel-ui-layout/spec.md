## Purpose

提供清晰且易於操作的雙行版面 YouTube 頻道追蹤卡片，確保在不同螢幕尺寸下皆有良好的視覺體驗。

### Requirement: Two-line Card Structure
系統必須在頻道卡片中採用雙行佈局：第一行展示頭像、頻道名稱、啟用開關與刪除按鈕；第二行展示最新影片標題與測試按鈕。

#### Scenario: Display two-line layout
- **WHEN** 使用者開啟頻道追蹤清單
- **THEN** 卡片正確分為上下兩行顯示對應的資訊與操作按鈕

### Requirement: Responsive & Visual Experience
系統必須確保在手機螢幕與桌面版彈窗中不產生版面破裂或橫向捲軸，且點擊測試按鈕時能正確觸發優先下載任務。

#### Scenario: Responsive testing
- **WHEN** 改變螢幕尺寸或點擊測試按鈕
- **THEN** 卡片版面保持完整無破損，測試按鈕正確發起下載流程
