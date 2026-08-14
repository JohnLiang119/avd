## 1. 強化一鍵發布腳本 (release_avd.ps1)

- [x] 1.1 在 `c:\JohnLiang\..Project\release_avd.ps1` 實作自動讀取 `package.json` 版本號與前置 Git 同步檢查
- [x] 1.2 實作自動尋找與驗證對應版號的 `AVD_${version}.apk` 與 `AVD_${version}_*.msi` 安裝包
- [x] 1.3 整合 `gh release create / upload` 一鍵上傳發布並自動設定 `--latest`
- [x] 1.4 確保 `release_avd.ps1` 儲存為 UTF-8 with BOM 編碼，支援 Windows PowerShell 5.1 & 7+

## 2. 測試與驗證

- [x] 2.1 驗證 `release_avd.ps1` 在未登入、無安裝檔及正常發布等各種情境的防護與提示訊息
