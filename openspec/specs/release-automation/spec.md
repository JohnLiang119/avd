
## Purpose

提供一鍵式自動化版本發布腳本，將程式碼同步、標籤建立、二進制安裝包（APK / MSI）上傳至 GitHub Releases 等流程完全自動化。

### Requirement: 自動讀取版本號與驗證安裝包
發布腳本執行時，系統必須自動從專案配置中讀取版本號，並檢查相應版本的二進制安裝檔是否存在。

#### Scenario: 成功找到對應版本的安裝檔
- **WHEN** 使用者執行 `release_avd.ps1` 且目錄中存在當前版號的 APK 與 MSI 檔案
- **THEN** 系統解析安裝檔路徑並顯示檔案大小，準備進行上傳

#### Scenario: 安裝檔缺失提示
- **WHEN** 使用者執行發布腳本但目錄中未找到對應版號的安裝包
- **THEN** 系統顯示友善錯誤提示，引導使用者先執行編譯腳本

### Requirement: 自動檢查並同步 Git 程式碼
在發布 Release 之前，腳本必須確保本機的程式碼變更均已提交並推送到 GitHub 遠端倉庫。

#### Scenario: 存在未提交之程式碼變更
- **WHEN** 偵測到有 modified 或 untracked 檔案
- **THEN** 系統自動以版本號為前綴執行 `git add`、`git commit` 並 `git push origin main`

### Requirement: 自動建立 GitHub Release 並上傳二進制資產
系統必須透過 GitHub CLI 自動建立 Release，並將 APK 與 MSI 附件上傳。

#### Scenario: 遠端不存在該版本 Release
- **WHEN** 執行發布且遠端無同名 Tag
- **THEN** 系統呼叫 `gh release create <Tag>` 上傳 APK 與 MSI，並設定為最新發布

#### Scenario: 遠端已存在同名 Release
- **WHEN** 遠端已存在相同 Tag
- **THEN** 系統自動呼叫 `gh release upload --clobber` 覆蓋附件，確保資產更新
