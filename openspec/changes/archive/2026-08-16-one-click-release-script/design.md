## Context

專案發布產物包括 Android APK (`AVD_${version}.apk`) 與 Windows MSI (`AVD_${version}_x64_zh-TW.msi`)。GitHub 倉庫為 `JohnLiang119/avd`。過去發布需要使用者手動執行 commit、手動確認 tag 與手動執行 gh 指令。

本設計將整體發布流程整合為單一 PowerShell 腳本 `c:\JohnLiang\..Project\release_avd.ps1`，讓使用者在編譯完成後只要點擊或執行此腳本，即可一鍵完成從 Git 提交到 GitHub Release 上線的所有繁瑣步驟。

## Goals / Non-Goals

**Goals:**
* 在 `c:\JohnLiang\..Project\` 目錄建立/強化 `release_avd.ps1`。
* 自動讀取 `package.json` 的版號（例如 `1.0.1`）。
* 自動檢查 Git 工作區狀態：若有未提交的變更，自動執行 `git add -A`、`git commit -m "release: v$version 發布"`、`git push origin main`。
* 自動驗證 `AVD_${version}.apk` 與 `AVD_${version}_*.msi`。
* 呼叫 GitHub CLI (`gh release create v$version ... --latest`) 建立發布並上傳 APK 與 MSI。
* 輸出清晰的繁體中文進度與 GitHub Release 網址。
* 儲存為 UTF-8 with BOM 編碼，避免在 Windows PowerShell 5.1 解析錯誤。

**Non-Goals:**
* 不在發布腳本內自動觸發耗時長的全平台編譯（編譯由 `all.ps1` 專責處理，避免發布時重複編譯耗時）。

## Decisions

### 1. 結合 Git 同步與 Release 發布為一體
* **決策**：在 `release_avd.ps1` 前置流程加入 Git 工作區檢查與自動 Push。
* **原因**：確保 GitHub 上的程式碼與 Release 標籤中的安裝包內容嚴格一致。

### 2. 嚴格檔案版本比對與模糊匹配相容
* **決策**：優先尋找精確符合目前版號的 `AVD_${version}.apk` 與 `AVD_${version}_*.msi`；若未找到才退回尋找 `android/app/build/outputs/` 與 `src-tauri/target/` 最新產物。

## Risks / Trade-offs

* **[Risk] GitHub CLI 未登入** → Mitigation: 腳本開頭即執行 `gh auth status` 檢查，若未登入則輸出顯著提示指引使用者執行 `gh auth login`。
