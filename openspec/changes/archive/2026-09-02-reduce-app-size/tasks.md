## 1. Android ABI Splits (架構分拆)

- [x] 1.1 修改 `android/app/build.gradle`，將 `universalApk` 設為 `false`，並在 `splits { abi { ... } }` 中啟用並列出所需架構 (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`)。
- [x] 1.2 測試 Android 打包流程，確認會產出多個架構特定的 APK，而非單一肥大 APK。

## 2. Windows 執行檔壓縮 (UPX)

- [x] 2.1 下載並確認開發環境中已安裝 UPX (Ultimate Packer for eXecutables)。
- [x] 2.2 在本機手動對 `src-tauri/bin/` 內的 `ffmpeg` 與 `rclone` 執行壓縮測試，並確認應用程式依然能正常執行核心功能 (如影音下載、轉檔)。
- [x] 2.3 （選項）若防毒軟體未阻擋，則嘗試對 `yt-dlp` 也進行壓縮測試；若遭誤判，則僅針對 `ffmpeg` 與 `rclone` 進行壓縮。

## 3. 發佈自動化腳本更新

- [x] 3.1 修改 `publish_all.ps1`，在執行 Tauri 打包 Windows MSI 前，先呼叫 `upx` 自動壓縮 `src-tauri/bin/*.exe`。
- [x] 3.2 修改 `publish_all.ps1` 或相關的 Android 打包步驟，確保自動收集所有產出的分拆 APK 檔案 (如 `app-arm64-v8a-release.apk`)。
- [x] 3.3 修改 `release_avd.ps1` 的上傳邏輯，將原本只上傳單一 `AVD_版本號.apk` 的動作，改為上傳所有收集到的分拆 APK 檔案。

## 4. 最終測試與確認

- [x] 4.1 執行完整的 `publish_all.ps1 -P`，驗證完整的建置、打包、壓縮、與 GitHub Release 發佈流程是否暢通無阻。
- [x] 4.2 確認 Release 頁面上的檔案大小是否如預期（Android 各 APK 約 50 MB，Windows 安裝檔解壓縮後體積也大幅下降）。
