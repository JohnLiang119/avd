## ADDED Requirements

### Requirement: 歷史安裝包保留策略

發布腳本在成功將安裝包上傳至 GitHub Releases 後 MUST 清理專案根目錄中舊版本的本機安裝包，僅保留當前發布版本的 MSI 與 APK，避免根目錄無限累積歷史安裝檔。

#### Scenario: 發布成功後清理舊安裝包

- **WHEN** `release_avd.ps1` 成功建立或更新 GitHub Release 並完成資產上傳
- **THEN** 系統刪除專案根目錄中版本號低於當前版本的 `AVD_*_x64_zh-TW.msi` 與 `AVD_*.apk`
- **AND** 主控台顯示被清理的檔案數量與釋出的磁碟空間

#### Scenario: 上傳失敗時不清理

- **WHEN** GitHub Release 建立或資產上傳過程發生錯誤
- **THEN** 系統 MUST NOT 刪除任何本機安裝包，以保留重試發布所需的檔案

#### Scenario: 使用者要求保留歷史安裝包

- **WHEN** 使用者以保留參數執行 `release_avd.ps1`
- **THEN** 系統跳過舊安裝包清理步驟，並在主控台說明已略過清理
