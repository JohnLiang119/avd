## Why

使用者在「頻道自動追蹤排程」中設定了多個 YouTube 頻道，當更換手機、重新安裝應用程式或在 Windows 與 Android 雙端切換時，缺乏便捷的資料備份與還原機制，導致需要逐一重新搜尋並貼上頻道網址。為了解決此痛點，本提案將在頻道管理中引入「本地檔案備份/還原」與「雲端硬碟 (Google Drive / Rclone) 同步備份/還原」雙軌機制，並順帶將頂部控制列按鈕樣式徹底優化為純灰統一色。

## What Changes

- **頻道管理彈窗新增備份與還原功能卡片**：
  - **本地檔案備份**：支援一鍵匯出 `avd_channels_backup.json` 檔案儲存至本地 Downloads 資料夾。
  - **本地檔案還原**：支援選取本地 JSON 檔案進行還原，並提供「覆蓋現有清單」或「智慧合併（去重加入）」選項。
  - **雲端硬碟備份**：支援將頻道備份檔一鍵上傳至已連結之 Google Drive / Rclone 雲端硬碟。
  - **雲端硬碟還原**：支援直接從雲端硬碟讀取最新頻道備份檔並進行一鍵還原。
- **頂部控制列「頻道」按鈕色彩純灰統一**：
  - 移除「頻道」按鈕在有追蹤項目時的藍色高亮，讓全部 8 顆頂部按鈕維持 100% 統一的極簡灰框灰字風格。
- **全平台版本升級至 `v1.0.31`**。

## Capabilities

### New Capabilities
- `channel-backup-restore`: 提供 YouTube 頻道追蹤清單的本地 JSON 匯出/匯入及 Google Drive / Rclone 雲端硬碟雙向備份與還原機制。

### Modified Capabilities
<!-- 無既有規格修改 -->

## Impact

- 影響檔案：
  - `src/App.vue`（頻道管理彈窗 UI、備份/還原邏輯、頂部按鈕樣式）
  - `src/services/DownloadService.ts`（雲端硬碟備份檔案讀寫與本地檔案處理）
  - `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `android/app/build.gradle`（版本升級至 1.0.31）
- 效益：大幅提升使用者跨裝置、跨平台轉移與資料保護體驗。