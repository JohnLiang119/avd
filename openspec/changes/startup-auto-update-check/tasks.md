## 1. 核心更新服務模組 (UpdateService)

- [x] 1.1 建立 `src/services/UpdateService.ts`，封裝 GitHub Releases API (`JohnLiang119/avd`) 請求與 SemVer 版本比對演算法
- [x] 1.2 實作安裝包檔案下載器，支援下載百分比與傳輸大小即時回呼 (Progress Callback)
- [x] 1.3 實作跨平台安裝介面封裝（Android 叫起系統安裝器 / Windows 執行 msiexec）

## 2. 原生層安裝支援 (Android & Windows)

- [x] 2.1 在 Android 原生端 (`android/.../YoutubeDlPlugin.java`) 擴充 `installApk` 方法，配置 `FileProvider` 與 `ACTION_VIEW` Intent
- [x] 2.2 在 AndroidManifest.xml 確認宣告 `REQUEST_INSTALL_PACKAGES` 與 FileProvider 權限
- [x] 2.3 確保 Windows (Tauri) 環境下可直接調用 Shell 執行暫存目錄之 MSI 安裝檔

## 3. 前端 UI 與流程整合 (App.vue)

- [x] 3.1 在 `App.vue` 設計更新說明彈窗組件，支援 Markdown/純文字更新日誌展示、進度條切換與錯誤重試
- [x] 3.2 在 `App.vue` 的 `onMounted` 註冊非同步靜默檢查，設定 5 秒超時，無新版或斷網時靜默忽略
- [x] 3.3 在「設定」視窗加入「檢查新版本」手動檢查按鈕，並在手動觸發時提供 Toast 狀態回饋

## 4. 全平台編譯與驗證

- [x] 4.1 執行前端 build 與 TypeScript 檢查 (`npm run build`)，確保無編譯錯誤
- [x] 4.2 驗證靜默檢查、新版本提示、下載進度與跨平台安裝觸發流程
