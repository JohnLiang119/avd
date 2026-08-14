## Why

為了讓版本發布流程更簡單、更直覺，使用者需要在專案根目錄 (`c:\JohnLiang\..Project\`) 擁有一個真正「一鍵式」的自動化發布腳本。該腳本能自動檢測專案版號、檢查 Git 狀態、同步程式碼至遠端，並自動將編譯產物 (APK 與 MSI) 發布至 GitHub Releases (`JohnLiang119/avd`)，省去繁瑣的手動操作步驟。

## What Changes

* **新增一鍵發布腳本**：於 `c:\JohnLiang\..Project\` 新增/增強 `release_avd.ps1`，提供完整的一鍵發布流程：
  1. 自動讀取 [package.json](file:///c:/JohnLiang/..Project/avd/package.json) 當前版號 (如 `1.0.1`)。
  2. 自動檢查未提交的 Git 變更並自動 commit & push 至遠端 `main` 分支。
  3. 自動比對並抓取 `AVD_${version}.apk` 與 `AVD_${version}_*.msi` 安裝檔。
  4. 自動呼叫 GitHub CLI (`gh`) 建立最新 Release 標籤 (`v1.0.1`)、產生更新日誌並上傳安裝包。
  5. 採用 UTF-8 with BOM 編碼，確保在 Windows PowerShell 5.1 / 7+ 環境下繁體中文不亂碼、不報錯。

## Capabilities

### New Capabilities
- `release-automation`: 專案一鍵版本發布與 GitHub Releases 自動化交付能力。

### Modified Capabilities
<!-- 無既有 specs 修改 -->

## Impact

* **受影響檔案**：
  * `c:\JohnLiang\..Project\release_avd.ps1` (增強與優化為一鍵發布流程)
  * `c:\JohnLiang\..Project\README.md` (更新發布操作說明)
