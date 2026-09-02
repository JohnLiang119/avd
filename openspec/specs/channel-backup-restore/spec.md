# channel-backup-restore Specification

## Purpose
提供頻道追蹤清單的備份與還原能力，讓使用者能將訂閱設定匯出為本地 JSON 檔案保存，或一鍵同步至雲端硬碟（Google Drive / Rclone），並在換機、重裝或資料遺失時自本地檔案或雲端備份完整還原，還原時支援覆蓋與合併兩種模式並自動去除重複頻道。

## Requirements
### Requirement: Local Channel Backup and Restore
系統 SHALL 支援將頻道追蹤清單匯出為本地 JSON 檔案，並支援讀取本地 JSON 檔案還原頻道清單。

#### Scenario: 成功匯出本地 JSON 備份
- **WHEN** 使用者在頻道管理面板點擊「匯出本地備份」
- **THEN** 系統 MUST 將當前所有追蹤頻道資料打包為 `avd_channels_backup.json` 並下載/儲存至本機

#### Scenario: 成功匯入本地 JSON 備份
- **WHEN** 使用者選取合法的頻道備份 JSON 檔案並確認還原
- **THEN** 系統 MUST 依使用者選擇（覆蓋或合併）更新頻道清單，且自動去除重複的 Channel ID

### Requirement: Cloud Drive Backup and Restore
系統 SHALL 支援將頻道追蹤清單一鍵上傳至雲端硬碟 (Google Drive / Rclone)，並支援一鍵自雲端下載回復。

#### Scenario: 成功備份至雲端硬碟
- **WHEN** 使用者點擊「備份至雲端」且雲端已連結
- **THEN** 系統 MUST 將頻道備份檔案同步至使用者的雲端硬碟中，並顯示備份成功提示

#### Scenario: 成功從雲端硬碟還原
- **WHEN** 使用者點擊「從雲端還原」
- **THEN** 系統 MUST 讀取雲端最新備份檔並完成清單還原更新

