## 1. 頂部按鈕顏色統一與版號升級

- [x] 1.1 移除頂部「頻道」按鈕在有追蹤時的 `btn-active` 藍色高亮，維持純灰風格
- [x] 1.2 將專案全平台版本升級至 `v1.0.31` (`package.json`, `tauri.conf.json`, `Cargo.toml`, `build.gradle`)

## 2. 頻道管理本地備份與還原實作

- [x] 2.1 實作本地頻道 JSON 匯出功能（下載 `avd_channels_backup.json`）
- [x] 2.2 實作本地頻道 JSON 匯入功能（支援檔案解析、覆蓋與去重合併）

## 3. 頻道管理雲端硬碟備份與還原實作

- [x] 3.1 實作頻道清單上傳備份至 Google Drive / Rclone 雲端硬碟
- [x] 3.2 實作從 Google Drive / Rclone 下載備份並還原頻道清單

## 4. 頻道管理彈窗 UI 整合與驗證

- [x] 4.1 在「頻道管理彈窗」頂部嵌入備份/還原控制卡片
- [x] 4.2 執行 `npm run build` 驗證編譯與功能測試