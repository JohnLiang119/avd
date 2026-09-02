## Context

目前 AVD 專案為 Vue 3 + TypeScript 前端，在 Android 端透過 Capacitor (Java 插件) 運行，在 Windows 端透過 Tauri 2 (Rust) 運行。最新發布產物（`AVD_*.apk` 與 `AVD_*.msi`）均透過 `release_avd.ps1` 自動上傳至 GitHub 倉庫 `JohnLiang119/avd` 的 Releases。

本設計將建立一個專屬的 `UpdateService` 模組，負責與 GitHub API 進行版本資訊查詢、下載檔案並調用各平台的原生安裝介面。

## Goals / Non-Goals

**Goals:**
* 在 `App.vue` 啟動 (`onMounted`) 時非同步執行靜默版本檢查，不卡頓 UI 渲染。
* 設計簡潔美觀的 Vant Dialog，展示更新版本與變更日誌，並提供即時下載進度條。
* 跨平台安裝支援：
  * **Android**：下載 APK 之後透過原生 Intent (FileProvider / ActionView) 叫起 Android Package Installer。
  * **Windows**：下載 MSI 後透過 Tauri Shell 啟動 `msiexec` 進行覆蓋安裝。
* 完備的離線與異常容錯：API 超時 (5s)、下載中斷處理、瀏覽器備用下載跳轉。

**Non-Goals:**
* 不實作複雜的差分升級 (Delta patch / Binary diff)，一律採用完整的 APK / MSI 進行標準升級。
* 不實作強制自動強制重啟（必須讓使用者點擊同意後才進行下載與安裝）。

## Decisions

### 1. 使用 GitHub Releases 公開 API 進行版本比對
* **決策**：直接向 `https://api.github.com/repos/JohnLiang119/avd/releases/latest` 發送 GET 請求。
* **原因**：倉庫為公開開源倉庫，無需任何 API Token；回傳格式包含標籤版本 (`tag_name`)、說明文字 (`body`) 以及直接下載連結 (`assets.browser_download_url`)。
* **替代方案**：在網站伺服器放置 `version.json`。但 GitHub Releases 已經由 `release_avd.ps1` 自動維護，直接使用 GitHub API 無需額外架設伺服器。

### 2. SemVer 版本比對演算法
* **決策**：解析版本字串（例如 `v1.0.1` $\rightarrow$ `[1, 0, 1]`），依序比對 Major、Minor、Patch 數值，只有當遠端版本嚴格大於本機 [package.json](file:///c:/JohnLiang/..Project/avd/package.json) 的 `version` 時才觸發更新。
* **原因**：確保輕量無額外套件依賴，且防止開發階段本機版號高於遠端時誤觸發更新。

### 3. 下載與安裝實現方式
* **Android**：
  * 透過 Capacitor 的 HTTP / File 下載機制或原生的檔案流下載至快取目錄。
  * 透過 Capacitor 原生插件（或調用 `YoutubeDlPlugin.installApk`）配置 `FileProvider` 觸發 `Intent(Intent.ACTION_VIEW)`，MIME 類型為 `application/vnd.android.package-archive`，自動喚起系統安裝介面。
* **Windows**：
  * 透過 Tauri 的 HTTP / fetch 或 Stream 下載至系統暫存目錄（`%TEMP%/AVD_update.msi`）。
  * 下載完畢後調用 Tauri Shell API 執行 `Start-Process msiexec.exe -ArgumentList "/i \`"$msiPath\`" /passive"`，並優雅退出舊版程式。

## Risks / Trade-offs

* **[Risk] GitHub API 速率限制 (Rate Limit)** → Mitigation: 未認證請求有每小時 60 次限制，但對於單一客戶端啟動時僅發送 1 次請求，完全足夠；若遭遇 403 限制則靜默忽略，不影響程式運作。
* **[Risk] Android 8.0+ 未知應用程式安裝權限** → Mitigation: 若手機未開啟 AVD 的「安裝未知應用程式」權限，系統叫起 Intent 時 Android 會自動引導使用者前往設定頁開啟，授權後即可一鍵安裝。
* **[Risk] 下載大型安裝包中途斷線** → Mitigation: 下載失敗時提示錯誤，並提供「重試」與「開啟 GitHub 下載網頁」備用選項。
