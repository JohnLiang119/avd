## Why

目前，Android APK 的體積異常巨大（約 198 MB），因為我們將四種不同 CPU 架構（`x86`、`x86_64`、`armeabi-v7a`、`arm64-v8a`）的原生函式庫（`libffmpeg.zip.so`、`libpython.zip.so`）全都塞進了同一個「Universal APK」中。
而 Windows MSI 安裝檔雖然壓縮後僅有 75 MB，但因為內部包含了未壓縮的巨大執行檔（`ffmpeg.exe`、`rclone.exe`、`yt-dlp.exe`），導致安裝後佔用超過 160 MB 的硬碟空間。
縮減這些應用程式體積將大幅提升下載速度、節省用戶裝置儲存空間，並讓未來的更新更加高效。

## What Changes

- **Android ABI 架構分拆 (ABI Splits)**：修改 Android 的 `build.gradle` 設定，將原本單一的 Universal APK 改為分別針對不同架構產生獨立的 APK 檔案。
- **Windows 執行檔壓縮**：在打包階段，針對 Windows 版的第三方依賴程式（`ffmpeg.exe`、`rclone.exe`、`yt-dlp.exe`）使用 UPX 進行高比例壓縮。這能大幅降低用戶磁碟的佔用空間，且不需在首次啟動時依賴網路下載。

## Capabilities

### New Capabilities
None

### Modified Capabilities
None

## Impact

- **發佈流程 (Build Pipeline)**：需要更新自動化發佈腳本（`publish_all.ps1`），讓它能上傳多個依架構分拆的 APK，並且在呼叫 Tauri 打包前自動執行 UPX 壓縮步驟。
- **儲存空間 (Disk Usage)**：Android APK 的單一下載體積將從 ~198 MB 暴跌至單一架構的 ~50 MB。Windows 的安裝後佔用體積也將縮減一半以上。
