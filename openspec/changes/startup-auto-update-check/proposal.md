## Why

目前 AVD 已經開源並上傳至 GitHub，透過自動化 Release 腳本持續發布新版 Android APK 與 Windows MSI 安裝包。然而，已安裝舊版應用的使用者若無法及時獲知新版發布，將無法享受到最新的功能修復與效能改進。

本變更旨在建立「啟動時自動檢查版本」與「應用內線上更新」機制：在 App 開啟時於背景靜默向 GitHub Releases 查詢最新版本，僅在檢測到新版本時跳出包含更新說明的提示視窗；若無新版則保持安靜不打擾使用者。使用者確認後可直接在應用內下載更新檔並叫起系統安裝，實現無縫的跨平台自動更新體驗。

## What Changes

* **背景靜默版本檢查**：App 啟動 (`onMounted`) 時自動於背景向 GitHub Releases API (`JohnLiang119/avd`) 檢查是否有高於目前版本號（SemVer 比對）的最新發布，並設定 5 秒超時；在無網路或無新版時靜默不打擾。
* **更新通知彈窗 (Update Modal)**：檢測到新版本時彈出對話框，展示最新版本號與 GitHub Release 說明的更新日誌，並提供「稍後再說」與「立即更新」選項。
* **應用內下載與進度反饋**：點擊「立即更新」後，在彈窗內展示下載進度條與下載大小（例如 `14.2 MB / 20.5 MB`）。
* **跨平台自動喚起安裝**：
  * **Android**：下載 APK 完成後自動透過 Intent / 檔案檢視器喚起 Android 原生系統應用程式安裝器。
  * **Windows**：下載 MSI 完成後透過 Tauri Shell 啟動安裝程序完成升級。
* **設定頁手動檢查功能**：在「設定」視窗中提供「檢查新版本」按鈕，方便使用者隨時手動檢查。

## Capabilities

### New Capabilities
- `auto-update`: 涵蓋 GitHub Releases 遠端版本檢查、版本比對邏輯、更新說明彈窗、下載進度回饋以及 Android / Windows 跨平台自動喚起安裝流程。

### Modified Capabilities
<!-- 無既有 specs 修改 -->

## Impact

* **受影響檔案**：
  * `src/App.vue`：啟動檢查邏輯、更新確認彈窗 UI 與下載進度條、設定頁「檢查更新」按鈕。
  * `src/services/UpdateService.ts` (新建)：專責封裝 GitHub Releases API 請求、版本號比較、APK / MSI 檔案下載與跨平台安裝呼叫。
  * `src/services/DownloadService.ts` / `src-tauri` / Android 原生層：支援下載至快取與觸發安裝檔案。
* **依賴與系統**：
  * 呼叫公開之 GitHub API，無需 API Token。
  * 支援離線與弱網保護，不阻礙既有本地離線功能。
