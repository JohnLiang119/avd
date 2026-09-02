## Context

請參考 `proposal.md` 了解本變更的動機。目前的打包流程會將 Android 版本打包為一個包含四種不同 CPU 架構原生函式庫的 Universal APK；而在 Windows 端，則是直接將未壓縮的龐大執行檔與核心程式一起打包進 MSI 安裝檔中。

## Goals / Non-Goals

**Goals:**
- 將 Android APK 的下載體積從約 198 MB 縮減至各架構單獨約 50 MB。
- 將 Windows 安裝後佔用的硬碟空間縮減至少 50%，同時不犧牲任何離線功能。
- 在現有的自動化發佈腳本（`publish_all.ps1`）中整合這些瘦身流程。

**Non-Goals:**
- 我們「不會」移除任何核心功能或第三方依賴程式（ffmpeg、yt-dlp、rclone）。
- 我們「不會」改用執行時動態下載的方式（因為這會依賴首次啟動時的網路連線，並需要處理額外的網路錯誤情境）。

## Decisions

1. **選擇使用 Android ABI 架構分拆 (ABI Splits) 而非 Android App Bundle (.aab)**
   - *Rationale*: 因為本應用程式是透過 GitHub Releases 直接發佈，而非上架於 Google Play 商店，所以採用 `.aab` 格式無法發揮其效益。我們將修改 `android/app/build.gradle` 的設定，將 `universalApk` 設為 `false`，並開啟 ABI Splits，讓系統獨立產出對應各架構（`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`）的 APK 檔案。

2. **選擇在 Windows 端使用 UPX 壓縮執行檔而非動態下載**
   - *Rationale*: 若要採用動態下載，必須在首次啟動時設計下載進度介面並處理各種網路錯誤。UPX（Ultimate Packer for eXecutables）能在執行時於記憶體中透明地解壓縮執行檔，且啟動延遲微乎其微。使用 UPX 預計能將超過 160 MB 的執行檔體積縮減 50-70%。

3. **自動化流程更新 (Pipeline Automation)**
   - *Rationale*: 我們將更新 `publish_all.ps1` 腳本：
     1. 在呼叫 `tauri build` 打包前，先透過 `upx` 指令壓縮 `src-tauri/bin/` 內的 `.exe` 檔案。
     2. 收集並重新命名所有分拆的 APK 檔案（例如 `app-arm64-v8a-release.apk` 加上版本號），最後一併上傳至 GitHub Release。

## Risks / Trade-offs

- **風險 (UPX 被防毒軟體誤判)**：經過 UPX 壓縮的執行檔，有時會因為混淆特徵而被過度敏感的防毒軟體（例如 Windows Defender）誤判為惡意程式。
  - *Mitigation (緩解措施)*：我們將在本地端先測試壓縮後的 `ffmpeg.exe` 與 `yt-dlp.exe`。由於 `yt-dlp` 本身是透過 PyInstaller 打包的 Python 程式，若加上 UPX 很容易觸發誤判；若發生此情況，我們將只針對 `ffmpeg` 與 `rclone` 進行壓縮（這兩者合計已達 146 MB），藉此避開潛在的誤判問題。
- **風險 (多個 APK 容易讓用戶混淆)**：提供四個不同的 APK 可能會讓用戶不知道該下載哪一個。
  - *Mitigation (緩解措施)*：將在 Release Notes 中加上明確的建議，指引大多數現代 Android 手機用戶下載 `arm64-v8a` 版本。
