# yt-dlp-auto-update Specification

## Purpose
每日自動更新後端的 `yt-dlp` 執行檔，以防止因為 YouTube 更改防護機制而導致的影片下載失敗問題。
## Requirements
### Requirement: 每日自動更新
系統 MUST 檢查今日是否已經更新過 `yt-dlp`。如果尚未更新，系統 MUST 在允許影片下載前，於背景執行更新指令，並記錄更新的日期。

#### Scenario: 每日首次下載
- **WHEN** 使用者觸發影片下載，且系統今日尚未更新過 `yt-dlp` 時
- **THEN** 系統會在背景將 `yt-dlp` 更新至 nightly 版本，待更新完成後再繼續執行原先的下載任務。

### Requirement: 手動更新
系統 MUST 在設定頁面提供使用者介面，讓使用者能手動觸發 `yt-dlp` 的更新，並能查看當前版本號。

#### Scenario: 使用者點擊手動更新
- **WHEN** 使用者在設定頁面點擊「更新 yt-dlp」按鈕時
- **THEN** 系統會執行更新指令，並在成功後，於固定的設定欄位中同步更新並顯示新的「版本號碼」與「最後更新日期」。

